use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::ErrorKind,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result as AnyResult};
use chrono::{DateTime, TimeZone, Utc};
use futures_core::Stream;
use prost_types::{
    value::Kind as ProtoKind, ListValue as ProtoListValue, Struct as ProtoStruct,
    Timestamp as ProtoTimestamp, Value as ProtoValue,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    fs,
    sync::{broadcast, Mutex, RwLock},
    time as tokio_time,
};
use tokio_stream::{
    wrappers::errors::BroadcastStreamRecvError, wrappers::BroadcastStream, StreamExt,
};
use tonic::{async_trait, Request, Response, Status};
use tracing::Instrument;
use uuid::Uuid;

pub mod proto {
    tonic::include_proto!("minoots.timer.v1");
}

pub use proto::horology_kernel_server::HorologyKernelServer;

#[derive(Clone, Debug)]
pub struct SchedulerConfig {
    pub max_duration_ms: Option<u64>,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_duration_ms: Some(1000 * 60 * 60 * 24 * 30), // 30 days
        }
    }
}

#[derive(Debug, Error)]
pub enum KernelError {
    #[error("duration must be greater than zero")]
    InvalidDuration,
    #[error("fire_at must be in the future")]
    InvalidFireTime,
    #[error("timer id already exists")]
    DuplicateTimer,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Scheduled,
    Armed,
    Fired,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub backoff_initial_ms: u64,
    pub backoff_multiplier: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Escalation {
    pub after_attempts: u32,
    pub escalates_to: Option<Box<TimerAction>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerAction {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
    pub escalation: Option<Box<Escalation>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerActionBundle {
    pub actions: Vec<TimerAction>,
    pub concurrency: Option<u32>,
    pub retry_policy: Option<RetryPolicy>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentBinding {
    pub adapter: String,
    pub target: String,
    #[serde(default)]
    pub payload_template: serde_json::Value,
    pub acknowledgement_timeout_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSpec {
    pub id: Option<Uuid>,
    pub tenant_id: String,
    pub requested_by: String,
    pub name: Option<String>,
    pub duration_ms: u64,
    pub fire_at: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
    pub labels: HashMap<String, String>,
    pub action_bundle: Option<TimerActionBundle>,
    pub agent_binding: Option<AgentBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerInstance {
    pub id: Uuid,
    pub tenant_id: String,
    pub requested_by: String,
    pub name: String,
    pub duration_ms: u64,
    pub created_at: DateTime<Utc>,
    pub fire_at: DateTime<Utc>,
    pub status: TimerStatus,
    pub metadata: Option<serde_json::Value>,
    pub labels: HashMap<String, String>,
    pub action_bundle: Option<TimerActionBundle>,
    pub agent_binding: Option<AgentBinding>,
    pub fired_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancel_reason: Option<String>,
    pub cancelled_by: Option<String>,
}

impl TimerInstance {
    fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            TimerStatus::Fired | TimerStatus::Cancelled | TimerStatus::Failed
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum TimerEvent {
    Scheduled(TimerInstance),
    Fired(TimerInstance),
    Cancelled {
        timer: TimerInstance,
        reason: Option<String>,
    },
    Failed {
        timer: TimerInstance,
        reason: Option<String>,
    },
}

#[derive(Clone)]
struct KernelState {
    timers: Arc<RwLock<HashMap<Uuid, TimerInstance>>>,
    event_tx: broadcast::Sender<TimerEvent>,
    config: SchedulerConfig,
    persistence: Option<PersistenceLayer>,
}

#[derive(Clone)]
struct PersistenceLayer {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

#[derive(Clone)]
pub struct HorologyKernel {
    state: KernelState,
}

impl HorologyKernel {
    pub fn new(config: SchedulerConfig) -> Self {
        let (event_tx, _rx) = broadcast::channel(1024);
        Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                persistence: None,
            },
        }
    }

    pub async fn with_persistence<P: Into<PathBuf>>(config: SchedulerConfig, path: P) -> AnyResult<Self> {
        let (event_tx, _rx) = broadcast::channel(1024);
        let persistence = PersistenceLayer::new(path.into());
        let kernel = Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                persistence: Some(persistence.clone()),
            },
        };

        let restored = persistence
            .load()
            .await
            .context("failed to load persisted timers")?;

        {
            let mut timers = kernel.state.timers.write().await;
            for timer in restored {
                timers.insert(timer.id, timer);
            }
        }

        let pending = {
            let timers = kernel.state.timers.read().await;
            timers.values().cloned().collect::<Vec<_>>()
        };

        for timer in pending {
            if timer.is_terminal() {
                continue;
            }
            kernel.spawn_fire_task(timer);
        }

        Ok(kernel)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TimerEvent> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        if spec.duration_ms == 0 {
            return Err(KernelError::InvalidDuration);
        }
        if let Some(max) = self.state.config.max_duration_ms {
            if spec.duration_ms > max {
                return Err(KernelError::InvalidDuration);
            }
        }

        let now = Utc::now();
        let delay = if let Some(ts) = spec.fire_at {
            if ts <= now {
                return Err(KernelError::InvalidFireTime);
            }
            (ts - now)
                .to_std()
                .map_err(|_| KernelError::InvalidFireTime)?
        } else {
            Duration::from_millis(spec.duration_ms)
        };

        let chrono_delay =
            chrono::Duration::from_std(delay).map_err(|_| KernelError::InvalidFireTime)?;
        let fire_at = spec.fire_at.unwrap_or_else(|| now + chrono_delay);
        let timer_id = spec.id.unwrap_or_else(Uuid::new_v4);

        let timer = TimerInstance {
            id: timer_id,
            tenant_id: spec.tenant_id.clone(),
            requested_by: spec.requested_by.clone(),
            name: spec
                .name
                .unwrap_or_else(|| format!("timer-{}", now.timestamp_millis())),
            duration_ms: delay.as_millis() as u64,
            created_at: now,
            fire_at,
            status: TimerStatus::Scheduled,
            metadata: spec.metadata.clone(),
            labels: spec.labels.clone(),
            action_bundle: spec.action_bundle.clone(),
            agent_binding: spec.agent_binding.clone(),
            fired_at: None,
            cancelled_at: None,
            cancel_reason: None,
            cancelled_by: None,
        };

        {
            let mut timers = self.state.timers.write().await;
            if timers.contains_key(&timer.id) {
                return Err(KernelError::DuplicateTimer);
            }
            timers.insert(timer.id, timer.clone());
        }

        let _ = self
            .state
            .event_tx
            .send(TimerEvent::Scheduled(timer.clone()));

        self.spawn_fire_task(timer.clone());

        self.persist_state().await;

        Ok(timer)
    }

    pub async fn cancel(
        &self,
        tenant_id: &str,
        timer_id: Uuid,
        reason: Option<String>,
        cancelled_by: Option<String>,
    ) -> Option<TimerInstance> {
        let mut timers = self.state.timers.write().await;
        let entry = timers.get_mut(&timer_id)?;
        if entry.tenant_id != tenant_id {
            return None;
        }

        if entry.is_terminal() {
            return Some(entry.clone());
        }

        entry.status = TimerStatus::Cancelled;
        entry.cancelled_at = Some(Utc::now());
        entry.cancel_reason = reason.clone();
        entry.cancelled_by = cancelled_by;
        let snapshot = entry.clone();
        drop(timers);

        let _ = self.state.event_tx.send(TimerEvent::Cancelled {
            timer: snapshot.clone(),
            reason,
        });
        self.persist_state().await;
        Some(snapshot)
    }

    pub async fn get(&self, tenant_id: &str, timer_id: Uuid) -> Option<TimerInstance> {
        let timers = self.state.timers.read().await;
        timers
            .get(&timer_id)
            .filter(|t| t.tenant_id == tenant_id)
            .cloned()
    }

    pub async fn list(&self, tenant_id: &str) -> Vec<TimerInstance> {
        let timers = self.state.timers.read().await;
        let mut timers: Vec<_> = timers
            .values()
            .filter(|t| t.tenant_id == tenant_id)
            .cloned()
            .collect();
        timers.sort_by_key(|t| t.fire_at);
        timers
    }

    fn spawn_fire_task(&self, timer: TimerInstance) {
        let state = self.state.clone();
        let kernel = self.clone();
        let span = tracing::info_span!("timer_fire_task", timer_id = %timer.id, tenant_id = %timer.tenant_id);
        tokio::spawn(
            async move {
                let delay = remaining_duration(&timer);
                if !delay.is_zero() {
                    tokio_time::sleep(delay).await;
                }

                let mut timers = state.timers.write().await;
                let entry = match timers.get_mut(&timer.id) {
                    Some(entry) => entry,
                    None => return,
                };

                if entry.is_terminal() {
                    return;
                }

                entry.status = TimerStatus::Fired;
                entry.fired_at = Some(Utc::now());
                let snapshot = entry.clone();
                drop(timers);

                let _ = state.event_tx.send(TimerEvent::Fired(snapshot));
                kernel.persist_state().await;
            }
            .instrument(span),
        );
    }

    async fn persist_state(&self) {
        if let Some(persistence) = &self.state.persistence {
            let snapshot = {
                let timers = self.state.timers.read().await;
                timers.values().cloned().collect::<Vec<_>>()
            };
            if let Err(err) = persistence.save(snapshot).await {
                tracing::warn!(?err, "failed to persist timer state");
            }
        }
    }
}

#[derive(Clone)]
pub struct GrpcKernelService {
    kernel: HorologyKernel,
}

impl GrpcKernelService {
    pub fn new(kernel: HorologyKernel) -> Self {
        Self { kernel }
    }
}

#[async_trait]
impl proto::horology_kernel_server::HorologyKernel for GrpcKernelService {
    type StreamTimerEventsStream =
        Pin<Box<dyn Stream<Item = Result<proto::TimerEvent, Status>> + Send + 'static>>;

    async fn schedule_timer(
        &self,
        request: Request<proto::TimerScheduleRequest>,
    ) -> Result<Response<proto::TimerScheduleResponse>, Status> {
        let req = request.into_inner();
        let spec = timer_spec_from_proto(req)?;
        let timer = self
            .kernel
            .schedule(spec)
            .await
            .map_err(kernel_error_to_status)?;
        Ok(Response::new(proto::TimerScheduleResponse {
            timer: Some(timer_to_proto(&timer)),
        }))
    }

    async fn cancel_timer(
        &self,
        request: Request<proto::TimerCancelRequest>,
    ) -> Result<Response<proto::Timer>, Status> {
        let proto::TimerCancelRequest {
            tenant_id,
            timer_id,
            reason,
            cancelled_by,
        } = request.into_inner();

        let timer_id = parse_uuid(&timer_id)?;
        let reason = if reason.is_empty() {
            None
        } else {
            Some(reason)
        };
        let cancelled_by = if cancelled_by.is_empty() {
            None
        } else {
            Some(cancelled_by)
        };

        let cancelled = self
            .kernel
            .cancel(&tenant_id, timer_id, reason, cancelled_by)
            .await;
        match cancelled {
            Some(timer) => Ok(Response::new(timer_to_proto(&timer))),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn get_timer(
        &self,
        request: Request<proto::TimerGetRequest>,
    ) -> Result<Response<proto::Timer>, Status> {
        let req = request.into_inner();
        let timer_id = parse_uuid(&req.timer_id)?;
        let timer = self.kernel.get(&req.tenant_id, timer_id).await;
        match timer {
            Some(timer) => Ok(Response::new(timer_to_proto(&timer))),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn list_timers(
        &self,
        request: Request<proto::TimerListRequest>,
    ) -> Result<Response<proto::TimerListResponse>, Status> {
        let req = request.into_inner();
        let timers = self.kernel.list(&req.tenant_id).await;
        let response = proto::TimerListResponse {
            timers: timers.iter().map(timer_to_proto).collect(),
            next_page_token: String::new(),
        };
        Ok(Response::new(response))
    }

    async fn stream_timer_events(
        &self,
        request: Request<proto::TimerEventStreamRequest>,
    ) -> Result<Response<Self::StreamTimerEventsStream>, Status> {
        let req = request.into_inner();
        let receiver = self.kernel.subscribe();
        let tenant_id = req.tenant_id.clone();
        let topic_filter: Arc<HashSet<String>> = Arc::new(req.topics.into_iter().collect());

        let stream = BroadcastStream::new(receiver).filter_map({
            let tenant_id = tenant_id.clone();
            let topic_filter = Arc::clone(&topic_filter);
            move |result| {
                let topic_filter = Arc::clone(&topic_filter);
                let tenant_id = tenant_id.clone();
                match result {
                    Ok(event) => {
                        let topic = event_topic(&event).to_string();
                        if !topic_filter.is_empty() && !topic_filter.contains(&topic) {
                            return None;
                        }
                        if event_tenant_id(&event) != tenant_id {
                            return None;
                        }
                        Some(timer_event_to_proto(event).map_err(|e| {
                            Status::internal(format!("failed to encode timer event: {e}"))
                        }))
                    }
                    Err(BroadcastStreamRecvError::Lagged(_)) => None,
                }
            }
        });

        Ok(Response::new(Box::pin(stream)))
    }
}

fn kernel_error_to_status(err: KernelError) -> Status {
    match err {
        KernelError::InvalidDuration | KernelError::InvalidFireTime => {
            Status::invalid_argument(err.to_string())
        }
        KernelError::DuplicateTimer => Status::already_exists(err.to_string()),
    }
}

fn timer_spec_from_proto(req: proto::TimerScheduleRequest) -> Result<TimerSpec, Status> {
    let fire_at = match req.fire_time {
        Some(ts) => Some(timestamp_to_datetime(&ts)?),
        None => None,
    };

    let duration_ms = if req.duration_ms > 0 {
        req.duration_ms
    } else if let Some(ref fire_at) = fire_at {
        let now = Utc::now();
        let diff = fire_at.signed_duration_since(now).num_milliseconds();
        if diff <= 0 {
            return Err(Status::invalid_argument("fire_time must be in the future"));
        }
        diff as u64
    } else {
        return Err(Status::invalid_argument(
            "duration_ms or fire_time must be provided",
        ));
    };

    let metadata = req.metadata.map(struct_to_json);
    let action_bundle = match req.action_bundle {
        Some(bundle) => Some(timer_action_bundle_from_proto(bundle)?),
        None => None,
    };
    let agent_binding = match req.agent_binding {
        Some(binding) => Some(agent_binding_from_proto(binding)?),
        None => None,
    };

    let id = if req.client_timer_id.is_empty() {
        None
    } else {
        Some(parse_uuid(&req.client_timer_id)?)
    };

    Ok(TimerSpec {
        id,
        tenant_id: req.tenant_id,
        requested_by: req.requested_by,
        name: if req.name.is_empty() {
            None
        } else {
            Some(req.name)
        },
        duration_ms,
        fire_at,
        metadata,
        labels: req.labels,
        action_bundle,
        agent_binding,
    })
}

fn parse_uuid(value: &str) -> Result<Uuid, Status> {
    Uuid::parse_str(value).map_err(|_| Status::invalid_argument("invalid uuid"))
}

fn timestamp_to_datetime(ts: &ProtoTimestamp) -> Result<DateTime<Utc>, Status> {
    Utc.timestamp_opt(ts.seconds, ts.nanos as u32)
        .single()
        .ok_or_else(|| Status::invalid_argument("invalid timestamp"))
}

fn datetime_to_timestamp(dt: &DateTime<Utc>) -> ProtoTimestamp {
    ProtoTimestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

fn timer_to_proto(timer: &TimerInstance) -> proto::Timer {
    proto::Timer {
        id: timer.id.to_string(),
        tenant_id: timer.tenant_id.clone(),
        name: timer.name.clone(),
        requested_by: timer.requested_by.clone(),
        status: timer_status_to_proto(&timer.status) as i32,
        created_at: Some(datetime_to_timestamp(&timer.created_at)),
        fire_at: Some(datetime_to_timestamp(&timer.fire_at)),
        fired_at: timer.fired_at.as_ref().map(datetime_to_timestamp),
        cancelled_at: timer.cancelled_at.as_ref().map(datetime_to_timestamp),
        cancel_reason: timer.cancel_reason.clone().unwrap_or_default(),
        cancelled_by: timer.cancelled_by.clone().unwrap_or_default(),
        duration_ms: timer.duration_ms,
        metadata: timer.metadata.as_ref().map(json_to_struct),
        labels: timer.labels.clone(),
        action_bundle: timer
            .action_bundle
            .as_ref()
            .map(timer_action_bundle_to_proto),
        agent_binding: timer.agent_binding.as_ref().map(agent_binding_to_proto),
    }
}

fn timer_status_to_proto(status: &TimerStatus) -> proto::TimerStatus {
    match status {
        TimerStatus::Scheduled => proto::TimerStatus::Scheduled,
        TimerStatus::Armed => proto::TimerStatus::Armed,
        TimerStatus::Fired => proto::TimerStatus::Fired,
        TimerStatus::Cancelled => proto::TimerStatus::Cancelled,
        TimerStatus::Failed => proto::TimerStatus::Failed,
    }
}

fn timer_action_bundle_to_proto(bundle: &TimerActionBundle) -> proto::TimerActionBundle {
    proto::TimerActionBundle {
        actions: bundle.actions.iter().map(timer_action_to_proto).collect(),
        concurrency: bundle.concurrency.unwrap_or_default(),
        retry_policy: bundle
            .retry_policy
            .as_ref()
            .map(|policy| proto::RetryPolicy {
                max_attempts: policy.max_attempts,
                backoff_initial_ms: policy.backoff_initial_ms,
                backoff_multiplier: policy.backoff_multiplier,
            }),
    }
}

fn timer_action_to_proto(action: &TimerAction) -> proto::TimerAction {
    proto::TimerAction {
        id: action.id.clone(),
        kind: action.kind.clone(),
        parameters: Some(json_to_struct(&action.parameters)),
        escalation: action.escalation.as_ref().map(|esc| {
            Box::new(proto::Escalation {
                after_attempts: esc.after_attempts,
                escalates_to: esc
                    .escalates_to
                    .as_ref()
                    .map(|next| Box::new(timer_action_to_proto(next.as_ref()))),
            })
        }),
    }
}

fn timer_action_bundle_from_proto(
    bundle: proto::TimerActionBundle,
) -> Result<TimerActionBundle, Status> {
    let actions = bundle
        .actions
        .into_iter()
        .map(timer_action_from_proto)
        .collect::<Result<Vec<_>, _>>()?;
    let retry_policy = bundle.retry_policy.map(|policy| RetryPolicy {
        max_attempts: policy.max_attempts,
        backoff_initial_ms: policy.backoff_initial_ms,
        backoff_multiplier: policy.backoff_multiplier,
    });
    Ok(TimerActionBundle {
        actions,
        concurrency: if bundle.concurrency == 0 {
            None
        } else {
            Some(bundle.concurrency)
        },
        retry_policy,
    })
}

fn timer_action_from_proto(action: proto::TimerAction) -> Result<TimerAction, Status> {
    let escalation = match action.escalation {
        Some(esc) => Some(Box::new(Escalation {
            after_attempts: esc.after_attempts,
            escalates_to: if let Some(next) = esc.escalates_to {
                Some(Box::new(timer_action_from_proto(*next)?))
            } else {
                None
            },
        })),
        None => None,
    };

    Ok(TimerAction {
        id: action.id,
        kind: action.kind,
        parameters: action
            .parameters
            .map(struct_to_json)
            .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new())),
        escalation,
    })
}

fn agent_binding_to_proto(binding: &AgentBinding) -> proto::AgentCommandBinding {
    proto::AgentCommandBinding {
        adapter: binding.adapter.clone(),
        target: binding.target.clone(),
        payload_template: Some(json_to_struct(&binding.payload_template)),
        acknowledgement_timeout_ms: binding.acknowledgement_timeout_ms,
    }
}

fn agent_binding_from_proto(binding: proto::AgentCommandBinding) -> Result<AgentBinding, Status> {
    Ok(AgentBinding {
        adapter: binding.adapter,
        target: binding.target,
        payload_template: binding
            .payload_template
            .map(struct_to_json)
            .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new())),
        acknowledgement_timeout_ms: binding.acknowledgement_timeout_ms,
    })
}

fn json_to_struct(value: &serde_json::Value) -> ProtoStruct {
    match value {
        serde_json::Value::Object(map) => ProtoStruct {
            fields: map
                .iter()
                .map(|(key, value)| (key.clone(), json_to_value(value)))
                .collect::<BTreeMap<_, _>>(),
        },
        _ => ProtoStruct {
            fields: {
                let mut fields = BTreeMap::new();
                fields.insert("value".to_string(), json_to_value(value));
                fields
            },
        },
    }
}

fn json_to_value(value: &serde_json::Value) -> ProtoValue {
    match value {
        serde_json::Value::Null => ProtoValue {
            kind: Some(ProtoKind::NullValue(0)),
        },
        serde_json::Value::Bool(b) => ProtoValue {
            kind: Some(ProtoKind::BoolValue(*b)),
        },
        serde_json::Value::Number(num) => ProtoValue {
            kind: Some(ProtoKind::NumberValue(num.as_f64().unwrap_or(0.0))),
        },
        serde_json::Value::String(s) => ProtoValue {
            kind: Some(ProtoKind::StringValue(s.clone())),
        },
        serde_json::Value::Array(values) => ProtoValue {
            kind: Some(ProtoKind::ListValue(ProtoListValue {
                values: values.iter().map(json_to_value).collect(),
            })),
        },
        serde_json::Value::Object(_map) => ProtoValue {
            kind: Some(ProtoKind::StructValue(json_to_struct(value))),
        },
    }
}

fn struct_to_json(value: ProtoStruct) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (key, value) in value.fields {
        map.insert(key, value_to_json(value));
    }
    serde_json::Value::Object(map)
}

fn value_to_json(value: ProtoValue) -> serde_json::Value {
    match value.kind {
        Some(ProtoKind::NullValue(_)) | None => serde_json::Value::Null,
        Some(ProtoKind::NumberValue(v)) => serde_json::json!(v),
        Some(ProtoKind::StringValue(v)) => serde_json::Value::String(v),
        Some(ProtoKind::BoolValue(v)) => serde_json::Value::Bool(v),
        Some(ProtoKind::StructValue(struct_value)) => struct_to_json(struct_value),
        Some(ProtoKind::ListValue(list)) => {
            let values = list
                .values
                .into_iter()
                .map(value_to_json)
                .collect::<Vec<_>>();
            serde_json::Value::Array(values)
        }
    }
}

fn timer_event_to_proto(event: TimerEvent) -> Result<proto::TimerEvent, String> {
    use proto::timer_event::Event as ProtoEvent;

    let proto_event = match event {
        TimerEvent::Scheduled(timer) => ProtoEvent::Scheduled(proto::TimerScheduled {
            timer: Some(timer_to_proto(&timer)),
        }),
        TimerEvent::Fired(timer) => ProtoEvent::Fired(proto::TimerFired {
            timer: Some(timer_to_proto(&timer)),
            result: None,
        }),
        TimerEvent::Cancelled { timer, reason } => ProtoEvent::Cancelled(proto::TimerCancelled {
            timer: Some(timer_to_proto(&timer)),
            reason: reason.unwrap_or_default(),
        }),
        TimerEvent::Failed { timer, reason } => ProtoEvent::Failed(proto::TimerFailed {
            timer: Some(timer_to_proto(&timer)),
            error: Some(proto::ExecutionError {
                message: reason.unwrap_or_default(),
                code: String::new(),
                metadata: None,
            }),
        }),
    };

    Ok(proto::TimerEvent {
        event: Some(proto_event),
    })
}

fn event_topic(event: &TimerEvent) -> &'static str {
    match event {
        TimerEvent::Scheduled(_) => "timer.scheduled",
        TimerEvent::Fired(_) => "timer.fired",
        TimerEvent::Cancelled { .. } => "timer.cancelled",
        TimerEvent::Failed { .. } => "timer.failed",
    }
}

fn event_tenant_id(event: &TimerEvent) -> String {
    match event {
        TimerEvent::Scheduled(timer)
        | TimerEvent::Fired(timer)
        | TimerEvent::Cancelled { timer, .. }
        | TimerEvent::Failed { timer, .. } => timer.tenant_id.clone(),
    }
}

fn remaining_duration(timer: &TimerInstance) -> Duration {
    let now = Utc::now();
    if timer.fire_at <= now {
        return Duration::from_millis(0);
    }
    (timer.fire_at - now)
        .to_std()
        .unwrap_or_else(|_| Duration::from_millis(0))
}

#[derive(Serialize, Deserialize)]
struct PersistedTimers {
    timers: Vec<TimerInstance>,
}

impl PersistenceLayer {
    fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    async fn load(&self) -> AnyResult<Vec<TimerInstance>> {
        match fs::read(&*self.path).await {
            Ok(bytes) => {
                let persisted: PersistedTimers = serde_json::from_slice(&bytes)
                    .context("failed to parse persisted timers")?;
                Ok(persisted.timers)
            }
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(err) => Err(err.into()),
        }
    }

    async fn save(&self, timers: Vec<TimerInstance>) -> AnyResult<()> {
        let _guard = self.lock.lock().await;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("failed to create directory for {:?}", self.path))?;
        }

        let payload = PersistedTimers { timers };
        let bytes = serde_json::to_vec_pretty(&payload)?;
        fs::write(&*self.path, bytes)
            .await
            .with_context(|| format!("failed to write persisted timers to {:?}", self.path))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn schedule_and_fire_emits_events() {
        tracing_subscriber::fmt::try_init().ok();
        let kernel = HorologyKernel::new(SchedulerConfig::default());
        let mut events = kernel.subscribe();

        let timer = kernel
            .schedule(TimerSpec {
                id: None,
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: Some("integration-test".into()),
                duration_ms: 50,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .expect("schedule timer");

        let scheduled = events.recv().await.expect("scheduled event");
        assert!(matches!(scheduled, TimerEvent::Scheduled(_)));

        let fired = events.recv().await.expect("fired event");
        match fired {
            TimerEvent::Fired(fired_timer) => {
                assert_eq!(fired_timer.id, timer.id);
                assert_eq!(fired_timer.status, TimerStatus::Fired);
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[tokio::test]
    async fn cancelling_prevents_fire_event() {
        let kernel = HorologyKernel::new(SchedulerConfig::default());
        let mut events = kernel.subscribe();

        let timer = kernel
            .schedule(TimerSpec {
                id: None,
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: None,
                duration_ms: 200,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .unwrap();

        let _ = events.recv().await.expect("scheduled event");

        let cancelled = kernel
            .cancel(
                "tenant-a",
                timer.id,
                Some("manual".into()),
                Some("agent-1".into()),
            )
            .await
            .expect("cancel timer");

        assert_eq!(cancelled.status, TimerStatus::Cancelled);

        let cancel_event = events.recv().await.expect("cancel event");
        match cancel_event {
            TimerEvent::Cancelled {
                timer: cancelled_timer,
                ..
            } => {
                assert_eq!(cancelled_timer.id, timer.id);
            }
            other => panic!("unexpected event: {:?}", other),
        }

        tokio_time::sleep(Duration::from_millis(250)).await;
        while let Ok(event) = events.try_recv() {
            assert!(
                !matches!(event, TimerEvent::Fired(_)),
                "timer should not emit fired event after cancellation"
            );
        }
    }

    #[tokio::test]
    async fn duplicate_timer_ids_are_rejected() {
        let kernel = HorologyKernel::new(SchedulerConfig::default());
        let id = Uuid::new_v4();

        kernel
            .schedule(TimerSpec {
                id: Some(id),
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: None,
                duration_ms: 50,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .unwrap();

        let result = kernel
            .schedule(TimerSpec {
                id: Some(id),
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: None,
                duration_ms: 50,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await;

        assert!(matches!(result, Err(KernelError::DuplicateTimer)));
    }

    #[test]
    fn timer_action_proto_roundtrip_preserves_escalations() {
        let nested = TimerAction {
            id: "escalate-final".into(),
            kind: "agent_prompt".into(),
            parameters: serde_json::json!({
                "prompt": "wake the operator"
            }),
            escalation: None,
        };

        let root = TimerAction {
            id: "primary".into(),
            kind: "command".into(),
            parameters: serde_json::json!({
                "command": "ping"
            }),
            escalation: Some(Box::new(Escalation {
                after_attempts: 2,
                escalates_to: Some(Box::new(nested.clone())),
            })),
        };

        let proto = timer_action_to_proto(&root);
        assert_eq!(proto.id, "primary");

        let restored = timer_action_from_proto(proto).expect("proto conversion");
        let esc = restored
            .escalation
            .expect("restored escalation should be present");
        assert_eq!(esc.after_attempts, 2);
        let final_action = esc.escalates_to.expect("nested action should be present");
        assert_eq!(final_action.id, nested.id);
        assert_eq!(final_action.kind, nested.kind);
        assert_eq!(final_action.parameters, nested.parameters);
        assert!(final_action.escalation.is_none());
    }
}
