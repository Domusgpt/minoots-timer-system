use std::pin::Pin;

use futures_core::Stream;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tonic::{metadata::MetadataMap, Request, Response, Status};
use tracing::warn;

use crate::pb::horology_kernel_server::{
    HorologyKernel as HorologyKernelApi, HorologyKernelServer,
};
use crate::pb::{
    self, TimerCancelRequest, TimerEventStreamRequest, TimerGetRequest, TimerListRequest,
    TimerScheduleRequest,
};
use crate::{HorologyKernel, KernelError, TimerEvent, TimerInstance, TimerSpec, TimerStatus};

pub type TimerEventStream =
    Pin<Box<dyn Stream<Item = Result<pb::TimerEvent, Status>> + Send + 'static>>;

#[derive(Clone)]
pub struct HorologyKernelService {
    kernel: HorologyKernel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestContext {
    tenant_id: String,
    principal_id: String,
    trace_id: Option<String>,
}

impl HorologyKernelService {
    pub fn new(kernel: HorologyKernel) -> Self {
        Self { kernel }
    }

    pub fn into_server(self) -> HorologyKernelServer<Self> {
        HorologyKernelServer::new(self)
    }
}

#[tonic::async_trait]
impl HorologyKernelApi for HorologyKernelService {
    async fn schedule_timer(
        &self,
        request: Request<TimerScheduleRequest>,
    ) -> Result<Response<pb::TimerScheduleResponse>, Status> {
        let metadata = request.metadata().clone();
        let context = extract_context(&metadata)?;
        let mut payload = request.into_inner();
        let resolved_tenant = enforce_tenant_scope(&payload.tenant_id, &context)?;
        payload.tenant_id = resolved_tenant;
        let timer_spec = convert_schedule_request(payload)?;
        let timer = self
            .kernel
            .schedule(timer_spec)
            .await
            .map_err(map_kernel_error)?;
        Ok(Response::new(pb::TimerScheduleResponse {
            timer: Some(to_proto_timer(timer)?),
        }))
    }

    async fn cancel_timer(
        &self,
        request: Request<TimerCancelRequest>,
    ) -> Result<Response<pb::Timer>, Status> {
        let metadata = request.metadata().clone();
        let context = extract_context(&metadata)?;
        let mut payload = request.into_inner();
        let resolved_tenant = enforce_tenant_scope(&payload.tenant_id, &context)?;
        payload.tenant_id = resolved_tenant.clone();
        let id = uuid::Uuid::parse_str(&payload.timer_id)
            .map_err(|_| Status::invalid_argument("timer_id must be a valid UUID"))?;

        let result = self
            .kernel
            .cancel(
                &resolved_tenant,
                id,
                optional_string(payload.reason),
                optional_string(payload.requested_by),
            )
            .await
            .map_err(map_kernel_error)?;

        match result {
            Some(timer) => Ok(Response::new(to_proto_timer(timer)?)),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn get_timer(
        &self,
        request: Request<TimerGetRequest>,
    ) -> Result<Response<pb::Timer>, Status> {
        let metadata = request.metadata().clone();
        let context = extract_context(&metadata)?;
        let mut payload = request.into_inner();
        let resolved_tenant = enforce_tenant_scope(&payload.tenant_id, &context)?;
        payload.tenant_id = resolved_tenant.clone();
        let id = uuid::Uuid::parse_str(&payload.timer_id)
            .map_err(|_| Status::invalid_argument("timer_id must be a valid UUID"))?;
        let timer = self.kernel.get(&resolved_tenant, id).await;
        match timer {
            Some(timer) => Ok(Response::new(to_proto_timer(timer)?)),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn list_timers(
        &self,
        request: Request<TimerListRequest>,
    ) -> Result<Response<pb::TimerListResponse>, Status> {
        let metadata = request.metadata().clone();
        let context = extract_context(&metadata)?;
        let mut payload = request.into_inner();
        let resolved_tenant = enforce_tenant_scope(&payload.tenant_id, &context)?;
        payload.tenant_id = resolved_tenant.clone();
        let timers = self.kernel.list(&resolved_tenant).await;
        let timers = timers
            .into_iter()
            .map(to_proto_timer)
            .collect::<Result<Vec<_>, Status>>()?;
        Ok(Response::new(pb::TimerListResponse {
            timers,
            next_page_token: String::new(),
        }))
    }

    type StreamTimerEventsStream = TimerEventStream;

    async fn stream_timer_events(
        &self,
        request: Request<TimerEventStreamRequest>,
    ) -> Result<Response<Self::StreamTimerEventsStream>, Status> {
        let metadata = request.metadata().clone();
        let context = extract_context(&metadata)?;
        let mut payload = request.into_inner();
        let tenant_id = enforce_stream_scope(&payload.tenant_id, &context)?;
        payload.tenant_id = tenant_id.clone();

        let tenant_filter = if tenant_id == "__all__" {
            None
        } else {
            Some(tenant_id.clone())
        };

        let receiver = self.kernel.subscribe();
        let stream = BroadcastStream::new(receiver).filter_map(move |event| match event {
            Ok(event)
                if tenant_filter
                    .as_ref()
                    .map(|tenant| event_belongs_to_tenant(&event, tenant))
                    .unwrap_or(true) =>
            {
                Some(event_to_proto(event))
            }
            Ok(_) => None,
            Err(_) => Some(Err(Status::aborted("event channel closed"))),
        });

        Ok(Response::new(Box::pin(stream)))
    }
}

fn extract_context(metadata: &MetadataMap) -> Result<RequestContext, Status> {
    let tenant_id = require_ascii_metadata(metadata, "x-tenant-id")?;
    let principal_id = require_ascii_metadata(metadata, "x-principal-id")?;
    let signature = require_ascii_metadata(metadata, "x-signature")?;
    let expected = compute_signature(&principal_id, &tenant_id);

    if signature.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1 {
        warn!(
            tenant_id = %tenant_id,
            principal_id = %principal_id,
            "kernel metadata signature mismatch"
        );
        return Err(Status::unauthenticated(
            "invalid signature for kernel request",
        ));
    }

    let trace_id = metadata
        .get("x-trace-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    Ok(RequestContext {
        tenant_id,
        principal_id,
        trace_id,
    })
}

fn require_ascii_metadata(metadata: &MetadataMap, key: &str) -> Result<String, Status> {
    metadata
        .get(key)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .ok_or_else(|| Status::unauthenticated(format!("{key} metadata is required")))
}

fn compute_signature(principal_id: &str, tenant_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(principal_id.as_bytes());
    hasher.update(b":");
    hasher.update(tenant_id.as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)
}

fn enforce_tenant_scope(requested: &str, context: &RequestContext) -> Result<String, Status> {
    if requested.is_empty() || requested == context.tenant_id {
        Ok(context.tenant_id.clone())
    } else {
        Err(Status::permission_denied(
            "tenant mismatch for kernel request",
        ))
    }
}

fn enforce_stream_scope(requested: &str, context: &RequestContext) -> Result<String, Status> {
    if requested.is_empty() || requested == context.tenant_id {
        return Ok(context.tenant_id.clone());
    }
    if requested == "__all__" && context.tenant_id == "__all__" {
        return Ok(String::from("__all__"));
    }
    Err(Status::permission_denied(
        "tenant mismatch for timer event stream",
    ))
}

fn convert_schedule_request(request: TimerScheduleRequest) -> Result<TimerSpec, Status> {
    if request.tenant_id.is_empty() {
        return Err(Status::invalid_argument("tenant_id is required"));
    }
    if request.requested_by.is_empty() {
        return Err(Status::invalid_argument("requested_by is required"));
    }

    let (duration_ms, fire_at) = match request.schedule_time {
        Some(pb::timer_schedule_request::ScheduleTime::DurationMs(duration)) => {
            if duration == 0 {
                return Err(Status::invalid_argument(
                    "duration_ms must be greater than zero",
                ));
            }
            (duration, None)
        }
        Some(pb::timer_schedule_request::ScheduleTime::FireTimeIso(iso)) => {
            let fire_at = parse_iso_datetime(&iso)?;
            let now = chrono::Utc::now();
            if fire_at <= now {
                return Err(Status::invalid_argument("fire_time must be in the future"));
            }
            let duration = (fire_at - now)
                .to_std()
                .map_err(|_| Status::invalid_argument("fire_time must be in the future"))?;
            (duration.as_millis() as u64, Some(fire_at))
        }
        None => {
            return Err(Status::invalid_argument(
                "either duration_ms or fire_time must be provided",
            ))
        }
    };

    let spec = TimerSpec {
        tenant_id: request.tenant_id,
        requested_by: request.requested_by,
        name: optional_string(request.name),
        duration_ms,
        fire_at,
        metadata: parse_optional_json_string(request.metadata_json)?,
        labels: request.labels,
        action_bundle: parse_optional_json_string(request.action_bundle_json)?,
        agent_binding: parse_optional_json_string(request.agent_binding_json)?,
    };

    Ok(spec)
}

fn optional_string(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn to_proto_timer(timer: TimerInstance) -> Result<pb::Timer, Status> {
    Ok(pb::Timer {
        id: timer.id.to_string(),
        tenant_id: timer.tenant_id,
        requested_by: timer.requested_by,
        name: timer.name,
        status: status_to_proto(timer.status) as i32,
        created_at_iso: format_datetime(timer.created_at),
        fire_at_iso: format_datetime(timer.fire_at),
        fired_at_iso: timer.fired_at.map(format_datetime).unwrap_or_default(),
        cancelled_at_iso: timer.cancelled_at.map(format_datetime).unwrap_or_default(),
        cancel_reason: timer.cancel_reason.unwrap_or_default(),
        cancelled_by: timer.cancelled_by.unwrap_or_default(),
        duration_ms: timer.duration_ms,
        metadata_json: serialize_json(timer.metadata)?,
        action_bundle_json: serialize_json(timer.action_bundle)?,
        agent_binding_json: serialize_json(timer.agent_binding)?,
        labels: timer.labels,
        settled_at_iso: timer.settled_at.map(format_datetime).unwrap_or_default(),
        failure_reason: timer.failure_reason.unwrap_or_default(),
        state_version: timer
            .state_version
            .max(0)
            .try_into()
            .map_err(|_| Status::internal("timer state version overflow"))?,
    })
}

fn status_to_proto(status: TimerStatus) -> pb::TimerStatus {
    match status {
        TimerStatus::Scheduled => pb::TimerStatus::Scheduled,
        TimerStatus::Armed => pb::TimerStatus::Armed,
        TimerStatus::Fired => pb::TimerStatus::Fired,
        TimerStatus::Cancelled => pb::TimerStatus::Cancelled,
        TimerStatus::Failed => pb::TimerStatus::Failed,
        TimerStatus::Settled => pb::TimerStatus::Settled,
    }
}

fn event_to_proto(event: TimerEvent) -> Result<pb::TimerEvent, Status> {
    match event {
        TimerEvent::Scheduled(timer) => Ok(pb::TimerEvent {
            event: Some(pb::timer_event::Event::Scheduled(pb::TimerScheduled {
                timer: Some(to_proto_timer(timer)?),
            })),
        }),
        TimerEvent::Fired(timer) => Ok(pb::TimerEvent {
            event: Some(pb::timer_event::Event::Fired(pb::TimerFired {
                timer: Some(to_proto_timer(timer)?),
                result: None,
            })),
        }),
        TimerEvent::Cancelled { timer, reason } => Ok(pb::TimerEvent {
            event: Some(pb::timer_event::Event::Cancelled(pb::TimerCancelled {
                timer: Some(to_proto_timer(timer)?),
                reason: reason.unwrap_or_default(),
            })),
        }),
        TimerEvent::Settled(timer) => Ok(pb::TimerEvent {
            event: Some(pb::timer_event::Event::Settled(pb::TimerSettled {
                timer: Some(to_proto_timer(timer)?),
            })),
        }),
    }
}

fn event_belongs_to_tenant(event: &TimerEvent, tenant_id: &str) -> bool {
    match event {
        TimerEvent::Scheduled(timer) => timer.tenant_id == tenant_id,
        TimerEvent::Fired(timer) => timer.tenant_id == tenant_id,
        TimerEvent::Cancelled { timer, .. } => timer.tenant_id == tenant_id,
        TimerEvent::Settled(timer) => timer.tenant_id == tenant_id,
    }
}

fn map_kernel_error(error: KernelError) -> Status {
    match error {
        KernelError::InvalidDuration => {
            Status::invalid_argument("duration must be greater than zero")
        }
        KernelError::InvalidFireTime => Status::invalid_argument("fire_at must be in the future"),
        KernelError::NotLeader => Status::failed_precondition("kernel is not the active leader"),
        KernelError::Persistence(inner) => Status::internal(format!("persistence error: {inner}")),
    }
}

fn parse_iso_datetime(value: &str) -> Result<chrono::DateTime<chrono::Utc>, Status> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|_| Status::invalid_argument("fire_time_iso must be RFC3339"))
}

fn format_datetime(value: chrono::DateTime<chrono::Utc>) -> String {
    value.to_rfc3339()
}

fn parse_optional_json_string(value: String) -> Result<Option<serde_json::Value>, Status> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(trimmed)
        .map(Some)
        .map_err(|error| Status::invalid_argument(format!("invalid json payload: {error}")))
}

fn serialize_json(value: Option<serde_json::Value>) -> Result<String, Status> {
    match value {
        Some(inner) => serde_json::to_string(&inner)
            .map_err(|error| Status::internal(format!("failed to serialize json: {error}"))),
        None => Ok(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use tonic::{metadata::MetadataValue, Code};

    fn signed_metadata(principal: &str, tenant: &str) -> MetadataMap {
        let mut metadata = MetadataMap::new();
        metadata.insert(
            "x-principal-id",
            MetadataValue::from_str(principal).unwrap(),
        );
        metadata.insert("x-tenant-id", MetadataValue::from_str(tenant).unwrap());
        let signature = compute_signature(principal, tenant);
        metadata.insert("x-signature", MetadataValue::from_str(&signature).unwrap());
        metadata
    }

    #[test]
    fn extract_context_succeeds_with_valid_signature() {
        let mut metadata = signed_metadata("principal-a", "tenant-123");
        metadata.insert("x-trace-id", MetadataValue::from_static("trace-abc"));

        let context = extract_context(&metadata).expect("context should parse");
        assert_eq!(context.tenant_id, "tenant-123");
        assert_eq!(context.principal_id, "principal-a");
        assert_eq!(context.trace_id.as_deref(), Some("trace-abc"));
    }

    #[test]
    fn extract_context_rejects_invalid_signature() {
        let mut metadata = MetadataMap::new();
        metadata.insert("x-principal-id", MetadataValue::from_static("principal-a"));
        metadata.insert("x-tenant-id", MetadataValue::from_static("tenant-123"));
        metadata.insert("x-signature", MetadataValue::from_static("invalid"));

        let error = extract_context(&metadata).expect_err("signature mismatch should error");
        assert_eq!(error.code(), Code::Unauthenticated);
    }

    #[test]
    fn tenant_scope_defaults_to_context_when_missing() {
        let context = RequestContext {
            tenant_id: "tenant-123".into(),
            principal_id: "principal".into(),
            trace_id: None,
        };

        assert_eq!(enforce_tenant_scope("", &context).unwrap(), "tenant-123");
        assert_eq!(
            enforce_tenant_scope("tenant-123", &context).unwrap(),
            "tenant-123"
        );
        assert!(enforce_tenant_scope("tenant-other", &context).is_err());
    }

    #[test]
    fn stream_scope_allows_all_only_for_all_tenant_context() {
        let tenant_context = RequestContext {
            tenant_id: "tenant-123".into(),
            principal_id: "principal".into(),
            trace_id: None,
        };
        let control_context = RequestContext {
            tenant_id: "__all__".into(),
            principal_id: "control".into(),
            trace_id: None,
        };

        assert!(enforce_stream_scope("__all__", &tenant_context).is_err());
        assert_eq!(
            enforce_stream_scope("__all__", &control_context).unwrap(),
            "__all__"
        );
    }
}
