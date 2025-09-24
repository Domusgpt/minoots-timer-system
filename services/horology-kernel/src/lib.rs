use std::{
    collections::{BTreeMap, HashMap, HashSet},
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use anyhow::{anyhow, Context, Result as AnyResult};
use chrono::{DateTime, TimeZone, Utc};
use prost_types::{
    value::Kind as ProstValueKind, ListValue as ProstListValue, Struct as ProstStruct, Timestamp,
    Value as ProstValue,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{sync::broadcast, sync::RwLock};
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tonic::Status;
use tracing::Instrument;
use uuid::Uuid;

pub mod proto {
    pub mod timer {
        tonic::include_proto!("minoots.timer.v1");
    }
}

use proto::timer;

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
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Scheduled,
    Armed,
    Fired,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RetryPolicySpec {
    pub max_attempts: u32,
    pub backoff_initial_ms: u64,
    pub backoff_multiplier: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EscalationSpec {
    pub after_attempts: u32,
    pub escalates_to: Option<Box<TimerActionSpec>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimerActionSpec {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
    pub escalation: Option<EscalationSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimerActionBundleSpec {
    pub actions: Vec<TimerActionSpec>,
    pub concurrency: Option<u32>,
    pub retry_policy: Option<RetryPolicySpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentBindingSpec {
    pub adapter: String,
    pub target: String,
    #[serde(default)]
    pub payload_template: serde_json::Value,
    pub acknowledgement_timeout_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimerSpec {
    pub tenant_id: String,
    pub requested_by: String,
    pub name: Option<String>,
    pub duration_ms: u64,
    pub fire_at: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
    pub labels: HashMap<String, String>,
    pub action_bundle: Option<TimerActionBundleSpec>,
    pub agent_binding: Option<AgentBindingSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    pub action_bundle: Option<TimerActionBundleSpec>,
    pub agent_binding: Option<AgentBindingSpec>,
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
#[serde(tag = "type", content = "data")]
pub enum TimerEvent {
    Scheduled(TimerInstance),
    Fired(TimerInstance),
    Cancelled {
        timer: TimerInstance,
        reason: Option<String>,
        cancelled_by: Option<String>,
    },
    Failed {
        timer: TimerInstance,
        error: Option<String>,
    },
}

#[derive(Clone)]
struct KernelState {
    timers: Arc<RwLock<HashMap<Uuid, TimerInstance>>>,
    event_tx: broadcast::Sender<TimerEvent>,
    config: SchedulerConfig,
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
            },
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TimerEvent> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        if spec.duration_ms == 0 && spec.fire_at.is_none() {
            return Err(KernelError::InvalidDuration);
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

        if let Some(max) = self.state.config.max_duration_ms {
            if delay.as_millis() as u64 > max {
                return Err(KernelError::InvalidDuration);
            }
        }

        let chrono_delay =
            chrono::Duration::from_std(delay).map_err(|_| KernelError::InvalidFireTime)?;
        let fire_at = spec.fire_at.unwrap_or_else(|| now + chrono_delay);

        let timer = TimerInstance {
            id: Uuid::new_v4(),
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
            timers.insert(timer.id, timer.clone());
        }

        let _ = self
            .state
            .event_tx
            .send(TimerEvent::Scheduled(timer.clone()));

        self.spawn_fire_task(timer.clone());

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
        entry.cancelled_by = cancelled_by.clone();
        let snapshot = entry.clone();
        drop(timers);

        let _ = self.state.event_tx.send(TimerEvent::Cancelled {
            timer: snapshot.clone(),
            reason,
            cancelled_by,
        });
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
        let span = tracing::info_span!("timer_fire_task", timer_id = %timer.id, tenant_id = %timer.tenant_id);
        tokio::spawn(
            async move {
                let duration = Duration::from_millis(timer.duration_ms);
                tokio::time::sleep(duration).await;

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
            }
            .instrument(span),
        );
    }
}

fn json_to_prost_value(value: &serde_json::Value) -> AnyResult<ProstValue> {
    Ok(ProstValue {
        kind: Some(match value {
            serde_json::Value::Null => ProstValueKind::NullValue(0),
            serde_json::Value::Bool(v) => ProstValueKind::BoolValue(*v),
            serde_json::Value::Number(n) => ProstValueKind::NumberValue(
                n.as_f64().ok_or_else(|| anyhow!("number out of range"))?,
            ),
            serde_json::Value::String(s) => ProstValueKind::StringValue(s.clone()),
            serde_json::Value::Array(values) => ProstValueKind::ListValue(ProstListValue {
                values: values
                    .iter()
                    .map(json_to_prost_value)
                    .collect::<AnyResult<Vec<_>>>()?,
            }),
            serde_json::Value::Object(map) => ProstValueKind::StructValue(ProstStruct {
                fields: map
                    .iter()
                    .map(|(k, v)| Ok((k.clone(), json_to_prost_value(v)?)))
                    .collect::<AnyResult<BTreeMap<_, _>>>()?,
            }),
        }),
    })
}

fn json_to_prost_struct(value: &serde_json::Value) -> AnyResult<ProstStruct> {
    match value {
        serde_json::Value::Object(map) => Ok(ProstStruct {
            fields: map
                .iter()
                .map(|(k, v)| Ok((k.clone(), json_to_prost_value(v)?)))
                .collect::<AnyResult<BTreeMap<_, _>>>()?,
        }),
        _ => Err(anyhow!("expected JSON object for Struct")),
    }
}

fn prost_value_to_json(value: &ProstValue) -> serde_json::Value {
    match value.kind.as_ref() {
        Some(ProstValueKind::NullValue(_)) | None => serde_json::Value::Null,
        Some(ProstValueKind::BoolValue(v)) => serde_json::Value::Bool(*v),
        Some(ProstValueKind::NumberValue(v)) => serde_json::Number::from_f64(*v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Some(ProstValueKind::StringValue(v)) => serde_json::Value::String(v.clone()),
        Some(ProstValueKind::ListValue(list)) => {
            serde_json::Value::Array(list.values.iter().map(prost_value_to_json).collect())
        }
        Some(ProstValueKind::StructValue(struct_value)) => {
            serde_json::Value::Object(prost_struct_to_json_map(struct_value))
        }
    }
}

fn prost_struct_to_json_map(
    struct_value: &ProstStruct,
) -> serde_json::Map<String, serde_json::Value> {
    struct_value
        .fields
        .iter()
        .map(|(k, v)| (k.clone(), prost_value_to_json(v)))
        .collect()
}

fn prost_struct_to_json(struct_value: &ProstStruct) -> serde_json::Value {
    serde_json::Value::Object(prost_struct_to_json_map(struct_value))
}

impl TimerActionSpec {
    fn from_proto(action: timer::TimerAction) -> AnyResult<Self> {
        Ok(Self {
            id: action.id,
            kind: action.kind,
            parameters: action
                .parameters
                .as_ref()
                .map(prost_struct_to_json)
                .unwrap_or(serde_json::Value::Object(Default::default())),
            escalation: action
                .escalation
                .map(|escalation| EscalationSpec::from_proto(*escalation))
                .transpose()?,
        })
    }

    fn to_proto(&self) -> AnyResult<timer::TimerAction> {
        Ok(timer::TimerAction {
            id: self.id.clone(),
            kind: self.kind.clone(),
            parameters: Some(json_to_prost_struct(&self.parameters)?),
            escalation: self
                .escalation
                .as_ref()
                .map(|escalation| escalation.to_proto())
                .transpose()?
                .map(Box::new),
        })
    }
}

impl EscalationSpec {
    fn from_proto(escalation: timer::Escalation) -> AnyResult<Self> {
        Ok(Self {
            after_attempts: escalation.after_attempts,
            escalates_to: escalation
                .escalates_to
                .map(|action| TimerActionSpec::from_proto(*action))
                .transpose()?
                .map(Box::new),
        })
    }

    fn to_proto(&self) -> AnyResult<timer::Escalation> {
        Ok(timer::Escalation {
            after_attempts: self.after_attempts,
            escalates_to: self
                .escalates_to
                .as_ref()
                .map(|action| action.to_proto())
                .transpose()?
                .map(Box::new),
        })
    }
}

impl RetryPolicySpec {
    fn from_proto(policy: timer::RetryPolicy) -> Self {
        Self {
            max_attempts: policy.max_attempts,
            backoff_initial_ms: policy.backoff_initial_ms,
            backoff_multiplier: policy.backoff_multiplier,
        }
    }

    fn to_proto(&self) -> timer::RetryPolicy {
        timer::RetryPolicy {
            max_attempts: self.max_attempts,
            backoff_initial_ms: self.backoff_initial_ms,
            backoff_multiplier: self.backoff_multiplier,
        }
    }
}

impl TimerActionBundleSpec {
    fn from_proto(bundle: timer::TimerActionBundle) -> AnyResult<Self> {
        Ok(Self {
            actions: bundle
                .actions
                .into_iter()
                .map(TimerActionSpec::from_proto)
                .collect::<AnyResult<Vec<_>>>()?,
            concurrency: if bundle.concurrency == 0 {
                None
            } else {
                Some(bundle.concurrency)
            },
            retry_policy: bundle.retry_policy.map(RetryPolicySpec::from_proto),
        })
    }

    fn to_proto(&self) -> AnyResult<timer::TimerActionBundle> {
        Ok(timer::TimerActionBundle {
            actions: self
                .actions
                .iter()
                .map(|action| action.to_proto())
                .collect::<AnyResult<Vec<_>>>()?,
            concurrency: self.concurrency.unwrap_or(0),
            retry_policy: self.retry_policy.as_ref().map(|policy| policy.to_proto()),
        })
    }
}

impl AgentBindingSpec {
    fn from_proto(binding: timer::AgentCommandBinding) -> AnyResult<Self> {
        Ok(Self {
            adapter: binding.adapter,
            target: binding.target,
            payload_template: binding
                .payload_template
                .as_ref()
                .map(prost_struct_to_json)
                .unwrap_or(serde_json::Value::Object(Default::default())),
            acknowledgement_timeout_ms: binding.acknowledgement_timeout_ms,
        })
    }

    fn to_proto(&self) -> AnyResult<timer::AgentCommandBinding> {
        Ok(timer::AgentCommandBinding {
            adapter: self.adapter.clone(),
            target: self.target.clone(),
            payload_template: Some(json_to_prost_struct(&self.payload_template)?),
            acknowledgement_timeout_ms: self.acknowledgement_timeout_ms,
        })
    }
}

fn to_timestamp(dt: &DateTime<Utc>) -> Timestamp {
    Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

fn option_to_timestamp(dt: Option<&DateTime<Utc>>) -> Option<Timestamp> {
    dt.map(to_timestamp)
}

fn timestamp_to_datetime(ts: Timestamp) -> AnyResult<DateTime<Utc>> {
    Utc.timestamp_opt(ts.seconds, ts.nanos as u32)
        .single()
        .context("invalid timestamp")
}

fn timer_status_to_proto(status: &TimerStatus) -> timer::TimerStatus {
    match status {
        TimerStatus::Scheduled => timer::TimerStatus::Scheduled,
        TimerStatus::Armed => timer::TimerStatus::Armed,
        TimerStatus::Fired => timer::TimerStatus::Fired,
        TimerStatus::Cancelled => timer::TimerStatus::Cancelled,
        TimerStatus::Failed => timer::TimerStatus::Failed,
    }
}

fn parse_timer_status(value: &str) -> Result<TimerStatus, Status> {
    match value {
        "scheduled" | "TIMER_STATUS_SCHEDULED" => Ok(TimerStatus::Scheduled),
        "armed" | "TIMER_STATUS_ARMED" => Ok(TimerStatus::Armed),
        "fired" | "TIMER_STATUS_FIRED" => Ok(TimerStatus::Fired),
        "cancelled" | "TIMER_STATUS_CANCELLED" => Ok(TimerStatus::Cancelled),
        "failed" | "TIMER_STATUS_FAILED" => Ok(TimerStatus::Failed),
        other => Err(Status::invalid_argument(format!(
            "unsupported timer status filter: {}",
            other
        ))),
    }
}

fn instance_to_proto(timer: &TimerInstance) -> Result<timer::Timer, Status> {
    Ok(timer::Timer {
        id: timer.id.to_string(),
        tenant_id: timer.tenant_id.clone(),
        name: timer.name.clone(),
        status: timer_status_to_proto(&timer.status) as i32,
        created_at: Some(to_timestamp(&timer.created_at)),
        fire_at: Some(to_timestamp(&timer.fire_at)),
        fired_at: option_to_timestamp(timer.fired_at.as_ref()),
        cancelled_at: option_to_timestamp(timer.cancelled_at.as_ref()),
        duration_ms: timer.duration_ms,
        metadata: timer
            .metadata
            .as_ref()
            .map(|value| json_to_prost_struct(value))
            .transpose()
            .map_err(|err| Status::internal(err.to_string()))?,
        action_bundle: timer
            .action_bundle
            .as_ref()
            .map(|bundle| bundle.to_proto())
            .transpose()
            .map_err(|err| Status::internal(err.to_string()))?,
        agent_binding: timer
            .agent_binding
            .as_ref()
            .map(|binding| binding.to_proto())
            .transpose()
            .map_err(|err| Status::internal(err.to_string()))?,
        requested_by: timer.requested_by.clone(),
        labels: timer.labels.clone(),
        cancel_reason: timer.cancel_reason.clone().unwrap_or_default(),
        cancelled_by: timer.cancelled_by.clone().unwrap_or_default(),
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

fn event_tenant_id(event: &TimerEvent) -> &str {
    match event {
        TimerEvent::Scheduled(timer)
        | TimerEvent::Fired(timer)
        | TimerEvent::Failed { timer, .. }
        | TimerEvent::Cancelled { timer, .. } => &timer.tenant_id,
    }
}

fn event_to_proto(event: TimerEvent) -> Result<timer::TimerEvent, Status> {
    let proto_event = match event {
        TimerEvent::Scheduled(timer) => {
            timer::timer_event::Event::Scheduled(timer::TimerScheduled {
                timer: Some(instance_to_proto(&timer)?),
            })
        }
        TimerEvent::Fired(timer) => timer::timer_event::Event::Fired(timer::TimerFired {
            timer: Some(instance_to_proto(&timer)?),
            result: None,
        }),
        TimerEvent::Cancelled {
            timer,
            reason,
            cancelled_by,
        } => timer::timer_event::Event::Cancelled(timer::TimerCancelled {
            timer: Some(instance_to_proto(&timer)?),
            reason: reason.unwrap_or_default(),
            cancelled_by: cancelled_by.unwrap_or_default(),
        }),
        TimerEvent::Failed { timer, error } => {
            timer::timer_event::Event::Failed(timer::TimerFailed {
                timer: Some(instance_to_proto(&timer)?),
                error: Some(timer::ExecutionError {
                    message: error.clone().unwrap_or_default(),
                    code: String::new(),
                    metadata: None,
                }),
            })
        }
    };

    Ok(timer::TimerEvent {
        event: Some(proto_event),
    })
}

fn convert_kernel_error(err: KernelError) -> Status {
    match err {
        KernelError::InvalidDuration => Status::invalid_argument(err.to_string()),
        KernelError::InvalidFireTime => Status::invalid_argument(err.to_string()),
    }
}

pub mod grpc {
    use super::*;
    use tonic::{Request, Response, Status};

    type TimerEventStream =
        Pin<Box<dyn Stream<Item = Result<timer::TimerEvent, Status>> + Send + 'static>>;

    #[derive(Clone)]
    pub struct KernelGrpcService {
        kernel: HorologyKernel,
    }

    impl KernelGrpcService {
        pub fn new(kernel: HorologyKernel) -> Self {
            Self { kernel }
        }
    }

    #[tonic::async_trait]
    impl timer::horology_kernel_server::HorologyKernel for KernelGrpcService {
        type StreamTimerEventsStream = TimerEventStream;

        async fn schedule_timer(
            &self,
            request: Request<timer::TimerScheduleRequest>,
        ) -> Result<Response<timer::TimerScheduleResponse>, Status> {
            let req = request.into_inner();
            let fire_at = req
                .fire_time
                .map(timestamp_to_datetime)
                .transpose()
                .map_err(|err| Status::invalid_argument(err.to_string()))?;
            let metadata = req.metadata.as_ref().map(prost_struct_to_json);
            let action_bundle = req
                .action_bundle
                .map(TimerActionBundleSpec::from_proto)
                .transpose()
                .map_err(|err| Status::invalid_argument(err.to_string()))?;
            let agent_binding = req
                .agent_binding
                .map(AgentBindingSpec::from_proto)
                .transpose()
                .map_err(|err| Status::invalid_argument(err.to_string()))?;

            let timer = self
                .kernel
                .schedule(TimerSpec {
                    tenant_id: req.tenant_id,
                    requested_by: req.requested_by,
                    name: if req.name.is_empty() {
                        None
                    } else {
                        Some(req.name)
                    },
                    duration_ms: req.duration_ms,
                    fire_at,
                    metadata,
                    labels: req.labels,
                    action_bundle,
                    agent_binding,
                })
                .await
                .map_err(convert_kernel_error)?;

            let response = timer::TimerScheduleResponse {
                timer: Some(instance_to_proto(&timer)?),
            };
            Ok(Response::new(response))
        }

        async fn cancel_timer(
            &self,
            request: Request<timer::TimerCancelRequest>,
        ) -> Result<Response<timer::Timer>, Status> {
            let req = request.into_inner();
            let timer_id = Uuid::parse_str(&req.timer_id)
                .map_err(|err| Status::invalid_argument(err.to_string()))?;
            let cancelled = self
                .kernel
                .cancel(
                    &req.tenant_id,
                    timer_id,
                    if req.reason.is_empty() {
                        None
                    } else {
                        Some(req.reason)
                    },
                    if req.cancelled_by.is_empty() {
                        None
                    } else {
                        Some(req.cancelled_by)
                    },
                )
                .await
                .ok_or_else(|| Status::not_found("timer not found"))?;

            Ok(Response::new(instance_to_proto(&cancelled)?))
        }

        async fn get_timer(
            &self,
            request: Request<timer::TimerGetRequest>,
        ) -> Result<Response<timer::Timer>, Status> {
            let req = request.into_inner();
            let timer_id = Uuid::parse_str(&req.timer_id)
                .map_err(|err| Status::invalid_argument(err.to_string()))?;
            let timer = self
                .kernel
                .get(&req.tenant_id, timer_id)
                .await
                .ok_or_else(|| Status::not_found("timer not found"))?;
            Ok(Response::new(instance_to_proto(&timer)?))
        }

        async fn list_timers(
            &self,
            request: Request<timer::TimerListRequest>,
        ) -> Result<Response<timer::TimerListResponse>, Status> {
            let req = request.into_inner();
            let status_filter: Option<HashSet<TimerStatus>> = if req.statuses.is_empty() {
                None
            } else {
                Some(
                    req.statuses
                        .iter()
                        .map(|status| parse_timer_status(status))
                        .collect::<Result<HashSet<_>, _>>()?,
                )
            };

            let mut timers = self.kernel.list(&req.tenant_id).await;
            if let Some(filter) = status_filter {
                timers.retain(|timer| filter.contains(&timer.status));
            }

            let response = timer::TimerListResponse {
                timers: timers
                    .iter()
                    .map(instance_to_proto)
                    .collect::<Result<Vec<_>, _>>()?,
                next_page_token: String::new(),
            };

            Ok(Response::new(response))
        }

        async fn stream_timer_events(
            &self,
            request: Request<timer::TimerEventStreamRequest>,
        ) -> Result<Response<Self::StreamTimerEventsStream>, Status> {
            let req = request.into_inner();
            let tenant_filter = req.tenant_id;
            let topic_filters: HashSet<String> = req.topics.into_iter().collect();
            let receiver = self.kernel.subscribe();

            let stream = BroadcastStream::new(receiver).filter_map(move |event| {
                let tenant_filter_value = tenant_filter.clone();
                let topic_filters_value = topic_filters.clone();
                match event {
                    Ok(event) => {
                        if !tenant_filter_value.is_empty()
                            && event_tenant_id(&event) != tenant_filter_value
                        {
                            return None;
                        }
                        if !topic_filters_value.is_empty()
                            && !topic_filters_value.contains(event_topic(&event))
                        {
                            return None;
                        }
                        match event_to_proto(event) {
                            Ok(proto_event) => Some(Ok(proto_event)),
                            Err(err) => {
                                tracing::warn!(error = %err, "failed to convert timer event");
                                None
                            }
                        }
                    }
                    Err(err) => {
                        tracing::warn!(error = %err, "timer event channel closed");
                        Some(Err(Status::internal("event channel closed")))
                    }
                }
            });

            Ok(Response::new(
                Box::pin(stream) as Self::StreamTimerEventsStream
            ))
        }
    }

    pub use timer::horology_kernel_server::HorologyKernelServer;
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

        tokio::time::sleep(Duration::from_millis(250)).await;
        while let Ok(event) = events.try_recv() {
            assert!(
                !matches!(event, TimerEvent::Fired(_)),
                "timer should not emit fired event after cancellation",
            );
        }
    }
}
