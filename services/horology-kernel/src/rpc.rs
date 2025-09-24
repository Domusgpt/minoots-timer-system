use std::{
    collections::{BTreeMap, HashSet},
    pin::Pin,
};

use async_stream::try_stream;
use chrono::{DateTime, Utc};
use futures_core::Stream;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::{
    HorologyKernel as KernelCore, KernelError, TimerEvent, TimerInstance, TimerSpec, TimerStatus,
};

pub mod proto {
    tonic::include_proto!("minoots.timer.v1");
}

use proto::horology_kernel_server::{HorologyKernel, HorologyKernelServer};

pub struct KernelService {
    kernel: KernelCore,
}

impl KernelService {
    pub fn new(kernel: KernelCore) -> Self {
        Self { kernel }
    }

    pub fn into_server(self) -> HorologyKernelServer<Self> {
        HorologyKernelServer::new(self)
    }
}

#[tonic::async_trait]
impl HorologyKernel for KernelService {
    type StreamTimerEventsStream =
        Pin<Box<dyn Stream<Item = Result<proto::TimerEvent, Status>> + Send>>;

    async fn schedule_timer(
        &self,
        request: Request<proto::TimerScheduleRequest>,
    ) -> Result<Response<proto::TimerScheduleResponse>, Status> {
        let payload = request.into_inner();

        let duration_ms = if payload.duration_ms > 0 {
            payload.duration_ms
        } else if let Some(ref fire_time) = payload.fire_time {
            let fire_at = timestamp_to_datetime(fire_time)?;
            let now = Utc::now();
            if fire_at <= now {
                return Err(Status::invalid_argument("fire_time must be in the future"));
            }
            (fire_at - now)
                .to_std()
                .map_err(|_| Status::invalid_argument("invalid fire_time"))?
                .as_millis() as u64
        } else {
            return Err(Status::invalid_argument(
                "Either duration_ms or fire_time must be provided",
            ));
        };

        let fire_at = match payload.fire_time {
            Some(ref ts) => Some(timestamp_to_datetime(ts)?),
            None => None,
        };

        let action_bundle = match payload.action_bundle {
            Some(ref bundle) => Some(action_bundle_to_json(bundle)?),
            None => None,
        };

        let agent_binding = match payload.agent_binding {
            Some(ref binding) => Some(agent_binding_to_json(binding)?),
            None => None,
        };

        let metadata = payload
            .metadata
            .as_ref()
            .map(struct_to_json)
            .transpose()
            .map_err(|_| Status::invalid_argument("invalid metadata struct"))?;

        let spec = TimerSpec {
            tenant_id: payload.tenant_id,
            requested_by: payload.requested_by,
            name: if payload.name.is_empty() {
                None
            } else {
                Some(payload.name)
            },
            duration_ms,
            fire_at,
            metadata,
            labels: payload.labels,
            action_bundle,
            agent_binding,
        };

        let timer = self
            .kernel
            .schedule(spec)
            .await
            .map_err(kernel_error_to_status)?;

        let timer_proto = timer_to_proto(timer)?;
        Ok(Response::new(proto::TimerScheduleResponse {
            timer: Some(timer_proto),
        }))
    }

    async fn cancel_timer(
        &self,
        request: Request<proto::TimerCancelRequest>,
    ) -> Result<Response<proto::Timer>, Status> {
        let payload = request.into_inner();
        let timer_id = parse_timer_id(&payload.timer_id)?;
        let cancelled = self
            .kernel
            .cancel(
                &payload.tenant_id,
                timer_id,
                if payload.reason.is_empty() {
                    None
                } else {
                    Some(payload.reason)
                },
                if payload.requested_by.is_empty() {
                    None
                } else {
                    Some(payload.requested_by)
                },
            )
            .await
            .ok_or_else(|| Status::not_found("timer not found"))?;

        let timer_proto = timer_to_proto(cancelled)?;
        Ok(Response::new(timer_proto))
    }

    async fn get_timer(
        &self,
        request: Request<proto::TimerGetRequest>,
    ) -> Result<Response<proto::Timer>, Status> {
        let payload = request.into_inner();
        let timer_id = parse_timer_id(&payload.timer_id)?;
        let timer = self
            .kernel
            .get(&payload.tenant_id, timer_id)
            .await
            .ok_or_else(|| Status::not_found("timer not found"))?;

        let timer_proto = timer_to_proto(timer)?;
        Ok(Response::new(timer_proto))
    }

    async fn list_timers(
        &self,
        request: Request<proto::TimerListRequest>,
    ) -> Result<Response<proto::TimerListResponse>, Status> {
        let payload = request.into_inner();
        let statuses: HashSet<TimerStatus> = payload
            .statuses
            .iter()
            .filter_map(|status| parse_status_filter(status))
            .collect();

        let timers = self.kernel.list(&payload.tenant_id).await;
        let filtered: Vec<_> = if statuses.is_empty() {
            timers
        } else {
            timers
                .into_iter()
                .filter(|timer| statuses.contains(&timer.status))
                .collect()
        };

        let mut response = proto::TimerListResponse::default();
        response.timers = filtered
            .into_iter()
            .map(|timer| timer_to_proto(timer))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Response::new(response))
    }

    async fn stream_timer_events(
        &self,
        request: Request<proto::TimerEventStreamRequest>,
    ) -> Result<Response<Self::StreamTimerEventsStream>, Status> {
        let payload = request.into_inner();
        let tenant_filter = if payload.tenant_id.is_empty() {
            None
        } else {
            Some(payload.tenant_id)
        };
        let topics: HashSet<String> = payload.topics.into_iter().collect();
        let receiver = self.kernel.subscribe();
        let mut stream = BroadcastStream::new(receiver);

        let output = try_stream! {
            while let Some(item) = stream.next().await {
                match item {
                    Ok(event) => {
                        if let Some(ref tenant) = tenant_filter {
                            if event.tenant_id() != tenant {
                                continue;
                            }
                        }
                        if !topics.is_empty() && !topics.contains(event.topic()) {
                            continue;
                        }
                        yield timer_event_to_proto(event)?;
                    }
                    Err(err) => {
                        tracing::warn!(?err, "event subscriber lagged");
                    }
                }
            }
        };

        Ok(Response::new(
            Box::pin(output) as Self::StreamTimerEventsStream
        ))
    }
}

fn kernel_error_to_status(err: KernelError) -> Status {
    match err {
        KernelError::InvalidDuration => {
            Status::invalid_argument("duration must be greater than zero")
        }
        KernelError::InvalidFireTime => Status::invalid_argument("fire_at must be in the future"),
    }
}

fn parse_timer_id(value: &str) -> Result<Uuid, Status> {
    Uuid::parse_str(value).map_err(|_| Status::invalid_argument("invalid timer_id"))
}

fn parse_status_filter(raw: &str) -> Option<TimerStatus> {
    match raw.to_ascii_lowercase().as_str() {
        "scheduled" | "timer_status_scheduled" => Some(TimerStatus::Scheduled),
        "armed" | "timer_status_armed" => Some(TimerStatus::Armed),
        "fired" | "timer_status_fired" => Some(TimerStatus::Fired),
        "cancelled" | "canceled" | "timer_status_cancelled" => Some(TimerStatus::Cancelled),
        _ => None,
    }
}

fn timer_to_proto(timer: TimerInstance) -> Result<proto::Timer, Status> {
    Ok(proto::Timer {
        id: timer.id.to_string(),
        tenant_id: timer.tenant_id,
        name: timer.name,
        status: timer_status_to_proto(timer.status) as i32,
        created_at: Some(datetime_to_timestamp(timer.created_at)),
        fire_at: Some(datetime_to_timestamp(timer.fire_at)),
        fired_at: timer.fired_at.map(datetime_to_timestamp),
        duration_ms: timer.duration_ms,
        metadata: timer
            .metadata
            .map(|value| json_to_struct(&value))
            .transpose()
            .map_err(|_| Status::invalid_argument("invalid metadata value"))?,
        action_bundle: timer
            .action_bundle
            .map(|value| json_to_action_bundle(&value))
            .transpose()?,
        agent_binding: timer
            .agent_binding
            .map(|value| json_to_agent_binding(&value))
            .transpose()?,
        requested_by: timer.requested_by,
        labels: timer.labels,
        cancelled_at: timer.cancelled_at.map(datetime_to_timestamp),
        cancel_reason: timer.cancel_reason.unwrap_or_default(),
        cancelled_by: timer.cancelled_by.unwrap_or_default(),
    })
}

fn timer_event_to_proto(event: TimerEvent) -> Result<proto::TimerEvent, Status> {
    Ok(match event {
        TimerEvent::Scheduled(timer) => proto::TimerEvent {
            event: Some(proto::timer_event::Event::Scheduled(
                proto::TimerScheduled {
                    timer: Some(timer_to_proto(timer)?),
                },
            )),
        },
        TimerEvent::Fired(timer) => proto::TimerEvent {
            event: Some(proto::timer_event::Event::Fired(proto::TimerFired {
                timer: Some(timer_to_proto(timer)?),
                result: None,
            })),
        },
        TimerEvent::Cancelled { timer, reason } => {
            let cancelled_by = timer.cancelled_by.clone().unwrap_or_default();
            proto::TimerEvent {
                event: Some(proto::timer_event::Event::Cancelled(
                    proto::TimerCancelled {
                        timer: Some(timer_to_proto(timer)?),
                        reason: reason.unwrap_or_default(),
                        cancelled_by,
                    },
                )),
            }
        }
    })
}

fn timer_status_to_proto(status: TimerStatus) -> proto::TimerStatus {
    match status {
        TimerStatus::Scheduled => proto::TimerStatus::Scheduled,
        TimerStatus::Armed => proto::TimerStatus::Armed,
        TimerStatus::Fired => proto::TimerStatus::Fired,
        TimerStatus::Cancelled => proto::TimerStatus::Cancelled,
    }
}

fn datetime_to_timestamp(value: DateTime<Utc>) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: value.timestamp(),
        nanos: value.timestamp_subsec_nanos() as i32,
    }
}

fn timestamp_to_datetime(value: &prost_types::Timestamp) -> Result<DateTime<Utc>, Status> {
    let nanos = value.nanos as u32;
    let naive = chrono::NaiveDateTime::from_timestamp_opt(value.seconds, nanos)
        .ok_or_else(|| Status::invalid_argument("invalid timestamp"))?;
    Ok(DateTime::<Utc>::from_utc(naive, Utc))
}

fn json_to_struct(value: &serde_json::Value) -> Result<prost_types::Struct, ()> {
    if let serde_json::Value::Object(map) = value {
        let mut fields = BTreeMap::new();
        for (key, entry) in map {
            fields.insert(key.clone(), json_to_value(entry)?);
        }
        Ok(prost_types::Struct { fields })
    } else {
        Err(())
    }
}

fn struct_to_json(structure: &prost_types::Struct) -> Result<serde_json::Value, ()> {
    let mut output = serde_json::Map::new();
    for (key, value) in &structure.fields {
        output.insert(key.clone(), value_to_json(value)?);
    }
    Ok(serde_json::Value::Object(output))
}

fn json_to_value(value: &serde_json::Value) -> Result<prost_types::Value, ()> {
    use prost_types::value::Kind;
    let kind = match value {
        serde_json::Value::Null => Kind::NullValue(0),
        serde_json::Value::Bool(b) => Kind::BoolValue(*b),
        serde_json::Value::Number(num) => Kind::NumberValue(num.as_f64().ok_or(())?),
        serde_json::Value::String(s) => Kind::StringValue(s.clone()),
        serde_json::Value::Array(list) => {
            let values = list
                .iter()
                .map(json_to_value)
                .collect::<Result<Vec<_>, _>>()?;
            Kind::ListValue(prost_types::ListValue { values })
        }
        serde_json::Value::Object(map) => {
            let mut fields = BTreeMap::new();
            for (key, entry) in map {
                fields.insert(key.clone(), json_to_value(entry)?);
            }
            Kind::StructValue(prost_types::Struct { fields })
        }
    };
    Ok(prost_types::Value { kind: Some(kind) })
}

fn value_to_json(value: &prost_types::Value) -> Result<serde_json::Value, ()> {
    use prost_types::value::Kind;
    match value.kind.as_ref() {
        None => Ok(serde_json::Value::Null),
        Some(Kind::NullValue(_)) => Ok(serde_json::Value::Null),
        Some(Kind::BoolValue(b)) => Ok(serde_json::Value::Bool(*b)),
        Some(Kind::NumberValue(n)) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .ok_or(()),
        Some(Kind::StringValue(s)) => Ok(serde_json::Value::String(s.clone())),
        Some(Kind::ListValue(list)) => {
            let values = list
                .values
                .iter()
                .map(value_to_json)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(serde_json::Value::Array(values))
        }
        Some(Kind::StructValue(structure)) => struct_to_json(structure),
    }
}

fn action_bundle_to_json(bundle: &proto::TimerActionBundle) -> Result<serde_json::Value, Status> {
    let actions = bundle
        .actions
        .iter()
        .map(|action| {
            let mut object = serde_json::Map::new();
            object.insert("id".into(), serde_json::Value::String(action.id.clone()));
            object.insert(
                "kind".into(),
                serde_json::Value::String(action.kind.clone()),
            );
            if let Some(ref parameters) = action.parameters {
                object.insert(
                    "parameters".into(),
                    struct_to_json(parameters)
                        .map_err(|_| Status::invalid_argument("invalid action parameters"))?,
                );
            }
            if let Some(ref escalation) = action.escalation {
                let mut esc = serde_json::Map::new();
                esc.insert(
                    "afterAttempts".into(),
                    serde_json::Value::Number((escalation.after_attempts as u64).into()),
                );
                if let Some(ref inner) = escalation.escalates_to {
                    esc.insert("escalatesTo".into(), action_to_json(inner)?);
                }
                object.insert("escalation".into(), serde_json::Value::Object(esc));
            }
            Ok(serde_json::Value::Object(object))
        })
        .collect::<Result<Vec<_>, Status>>()?;

    let mut map = serde_json::Map::new();
    map.insert("actions".into(), serde_json::Value::Array(actions));
    if bundle.concurrency != 0 {
        map.insert(
            "concurrency".into(),
            serde_json::Value::Number((bundle.concurrency as u64).into()),
        );
    }
    if let Some(ref retry) = bundle.retry_policy {
        let mut retry_map = serde_json::Map::new();
        retry_map.insert(
            "maxAttempts".into(),
            serde_json::Value::Number((retry.max_attempts as u64).into()),
        );
        retry_map.insert(
            "backoffInitialMs".into(),
            serde_json::Value::Number(serde_json::Number::from(retry.backoff_initial_ms as i64)),
        );
        retry_map.insert(
            "backoffMultiplier".into(),
            serde_json::Value::Number(
                serde_json::Number::from_f64(retry.backoff_multiplier)
                    .ok_or_else(|| Status::invalid_argument("invalid retry multiplier"))?,
            ),
        );
        map.insert("retryPolicy".into(), serde_json::Value::Object(retry_map));
    }
    Ok(serde_json::Value::Object(map))
}

fn action_to_json(action: &proto::TimerAction) -> Result<serde_json::Value, Status> {
    let mut object = serde_json::Map::new();
    object.insert("id".into(), serde_json::Value::String(action.id.clone()));
    object.insert(
        "kind".into(),
        serde_json::Value::String(action.kind.clone()),
    );
    if let Some(ref params) = action.parameters {
        object.insert(
            "parameters".into(),
            struct_to_json(params)
                .map_err(|_| Status::invalid_argument("invalid action parameters"))?,
        );
    }
    if let Some(ref escalation) = action.escalation {
        let mut esc = serde_json::Map::new();
        esc.insert(
            "afterAttempts".into(),
            serde_json::Value::Number((escalation.after_attempts as u64).into()),
        );
        if let Some(ref inner) = escalation.escalates_to {
            esc.insert("escalatesTo".into(), action_to_json(inner)?);
        }
        object.insert("escalation".into(), serde_json::Value::Object(esc));
    }
    Ok(serde_json::Value::Object(object))
}

fn agent_binding_to_json(
    binding: &proto::AgentCommandBinding,
) -> Result<serde_json::Value, Status> {
    let mut map = serde_json::Map::new();
    map.insert(
        "adapter".into(),
        serde_json::Value::String(binding.adapter.clone()),
    );
    map.insert(
        "target".into(),
        serde_json::Value::String(binding.target.clone()),
    );
    map.insert(
        "acknowledgementTimeoutMs".into(),
        serde_json::Value::Number((binding.acknowledgement_timeout_ms as u64).into()),
    );
    if let Some(ref payload) = binding.payload_template {
        map.insert(
            "payloadTemplate".into(),
            struct_to_json(payload)
                .map_err(|_| Status::invalid_argument("invalid payload template"))?,
        );
    }
    Ok(serde_json::Value::Object(map))
}

fn json_to_action_bundle(value: &serde_json::Value) -> Result<proto::TimerActionBundle, Status> {
    let obj = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("actionBundle must be an object"))?;

    let actions_value = obj
        .get("actions")
        .ok_or_else(|| Status::invalid_argument("actionBundle missing actions"))?;
    let actions_array = actions_value
        .as_array()
        .ok_or_else(|| Status::invalid_argument("actions must be an array"))?;

    let actions = actions_array
        .iter()
        .map(json_to_timer_action)
        .collect::<Result<Vec<_>, Status>>()?;

    let concurrency = obj
        .get("concurrency")
        .and_then(|value| value.as_u64())
        .unwrap_or(1) as u32;

    let retry_policy = obj
        .get("retryPolicy")
        .map(|value| json_to_retry_policy(value))
        .transpose()?;

    Ok(proto::TimerActionBundle {
        actions,
        concurrency,
        retry_policy,
    })
}

fn json_to_timer_action(value: &serde_json::Value) -> Result<proto::TimerAction, Status> {
    let obj = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("action must be an object"))?;
    let id = obj
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| Status::invalid_argument("action missing id"))?;
    let kind = obj
        .get("kind")
        .and_then(|value| value.as_str())
        .ok_or_else(|| Status::invalid_argument("action missing kind"))?;

    let parameters = obj
        .get("parameters")
        .map(|value| {
            json_to_struct(value).map_err(|_| Status::invalid_argument("invalid action parameters"))
        })
        .transpose()?;

    let escalation = obj.get("escalation").map(json_to_escalation).transpose()?;

    Ok(proto::TimerAction {
        id: id.to_string(),
        kind: kind.to_string(),
        parameters,
        escalation: escalation.map(Box::new),
    })
}

fn json_to_escalation(value: &serde_json::Value) -> Result<proto::Escalation, Status> {
    let obj = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("escalation must be an object"))?;

    let after_attempts = obj
        .get("afterAttempts")
        .and_then(|value| value.as_u64())
        .unwrap_or(1) as u32;

    let escalates_to = obj
        .get("escalatesTo")
        .map(|value| json_to_timer_action(value).map(Box::new))
        .transpose()?;

    Ok(proto::Escalation {
        after_attempts,
        escalates_to,
    })
}

fn json_to_retry_policy(value: &serde_json::Value) -> Result<proto::RetryPolicy, Status> {
    let obj = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("retryPolicy must be an object"))?;
    Ok(proto::RetryPolicy {
        max_attempts: obj
            .get("maxAttempts")
            .and_then(|value| value.as_u64())
            .unwrap_or(1) as u32,
        backoff_initial_ms: obj
            .get("backoffInitialMs")
            .and_then(|value| value.as_u64())
            .unwrap_or(1000),
        backoff_multiplier: obj
            .get("backoffMultiplier")
            .and_then(|value| value.as_f64())
            .unwrap_or(2.0),
    })
}

fn json_to_agent_binding(value: &serde_json::Value) -> Result<proto::AgentCommandBinding, Status> {
    let obj = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("agentBinding must be an object"))?;

    let adapter = obj
        .get("adapter")
        .and_then(|value| value.as_str())
        .unwrap_or("mcp");
    let target = obj
        .get("target")
        .and_then(|value| value.as_str())
        .ok_or_else(|| Status::invalid_argument("agentBinding missing target"))?;

    let payload_template = obj
        .get("payloadTemplate")
        .map(|value| {
            json_to_struct(value).map_err(|_| Status::invalid_argument("invalid payload template"))
        })
        .transpose()?;

    Ok(proto::AgentCommandBinding {
        adapter: adapter.to_string(),
        target: target.to_string(),
        payload_template,
        acknowledgement_timeout_ms: obj
            .get("acknowledgementTimeoutMs")
            .and_then(|value| value.as_u64())
            .unwrap_or(60000),
    })
}
