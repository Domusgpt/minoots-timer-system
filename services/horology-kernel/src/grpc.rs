use std::pin::Pin;

use futures_core::Stream;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tonic::{Request, Response, Status};

use crate::pb::horology_kernel_server::{HorologyKernel as HorologyKernelApi, HorologyKernelServer};
use crate::pb::{self, TimerCancelRequest, TimerEventStreamRequest, TimerGetRequest, TimerListRequest, TimerScheduleRequest};
use crate::{HorologyKernel, KernelError, TimerEvent, TimerInstance, TimerSpec, TimerStatus};

pub type TimerEventStream = Pin<Box<dyn Stream<Item = Result<pb::TimerEvent, Status>> + Send + 'static>>;

#[derive(Clone)]
pub struct HorologyKernelService {
    kernel: HorologyKernel,
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
        let spec = request.into_inner();
        let timer_spec = convert_schedule_request(spec)?;
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
        let payload = request.into_inner();
        let id = uuid::Uuid::parse_str(&payload.timer_id)
            .map_err(|_| Status::invalid_argument("timer_id must be a valid UUID"))?;

        let result = self
            .kernel
            .cancel(&payload.tenant_id, id, optional_string(payload.reason), optional_string(payload.requested_by))
            .await;

        match result {
            Some(timer) => Ok(Response::new(to_proto_timer(timer)?)),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn get_timer(
        &self,
        request: Request<TimerGetRequest>,
    ) -> Result<Response<pb::Timer>, Status> {
        let payload = request.into_inner();
        let id = uuid::Uuid::parse_str(&payload.timer_id)
            .map_err(|_| Status::invalid_argument("timer_id must be a valid UUID"))?;
        let timer = self.kernel.get(&payload.tenant_id, id).await;
        match timer {
            Some(timer) => Ok(Response::new(to_proto_timer(timer)?)),
            None => Err(Status::not_found("timer not found")),
        }
    }

    async fn list_timers(
        &self,
        request: Request<TimerListRequest>,
    ) -> Result<Response<pb::TimerListResponse>, Status> {
        let payload = request.into_inner();
        let timers = self.kernel.list(&payload.tenant_id).await;
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
        let payload = request.into_inner();
        let tenant_id = payload.tenant_id;
        if tenant_id.is_empty() {
            return Err(Status::invalid_argument("tenant_id is required"));
        }

        let tenant_filter = if tenant_id == "__all__" {
            None
        } else {
            Some(tenant_id.clone())
        };

        let receiver = self.kernel.subscribe();
        let stream = BroadcastStream::new(receiver)
            .filter_map(move |event| match event {
                Ok(event)
                    if tenant_filter
                        .as_ref()
                        .map(|tenant| event_belongs_to_tenant(&event, tenant))
                        .unwrap_or(true) => Some(event_to_proto(event)),
                Ok(_) => None,
                Err(_) => Some(Err(Status::aborted("event channel closed"))),
            });

        Ok(Response::new(Box::pin(stream)))
    }
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
                return Err(Status::invalid_argument("duration_ms must be greater than zero"));
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
        fired_at_iso: timer
            .fired_at
            .map(format_datetime)
            .unwrap_or_default(),
        cancelled_at_iso: timer
            .cancelled_at
            .map(format_datetime)
            .unwrap_or_default(),
        cancel_reason: timer.cancel_reason.unwrap_or_default(),
        cancelled_by: timer.cancelled_by.unwrap_or_default(),
        duration_ms: timer.duration_ms,
        metadata_json: serialize_json(timer.metadata)?,
        action_bundle_json: serialize_json(timer.action_bundle)?,
        agent_binding_json: serialize_json(timer.agent_binding)?,
        labels: timer.labels,
    })
}

fn status_to_proto(status: TimerStatus) -> pb::TimerStatus {
    match status {
        TimerStatus::Scheduled => pb::TimerStatus::Scheduled,
        TimerStatus::Armed => pb::TimerStatus::Armed,
        TimerStatus::Fired => pb::TimerStatus::Fired,
        TimerStatus::Cancelled => pb::TimerStatus::Cancelled,
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
    }
}

fn event_belongs_to_tenant(event: &TimerEvent, tenant_id: &str) -> bool {
    match event {
        TimerEvent::Scheduled(timer) => timer.tenant_id == tenant_id,
        TimerEvent::Fired(timer) => timer.tenant_id == tenant_id,
        TimerEvent::Cancelled { timer, .. } => timer.tenant_id == tenant_id,
    }
}

fn map_kernel_error(error: KernelError) -> Status {
    match error {
        KernelError::InvalidDuration => Status::invalid_argument("duration must be greater than zero"),
        KernelError::InvalidFireTime => Status::invalid_argument("fire_at must be in the future"),
        KernelError::Storage(err) => Status::internal(format!("storage error: {err}")),
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
