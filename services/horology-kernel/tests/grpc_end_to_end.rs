use std::time::Duration;
use std::{
    collections::{BTreeMap, HashMap},
    convert::TryFrom,
};

use anyhow::Result;
use horology_kernel::{
    rpc::{self, KernelService},
    HorologyKernel, SchedulerConfig,
};
use prost_types::{value::Kind, Struct, Value};
use tokio::sync::oneshot;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{transport::Server, Request};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn grpc_timer_lifecycle_round_trip() -> Result<()> {
    let kernel = HorologyKernel::new(SchedulerConfig::default());
    let service = KernelService::new(kernel.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let incoming = TcpListenerStream::new(listener);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_handle = tokio::spawn(async move {
        Server::builder()
            .add_service(service.into_server())
            .serve_with_incoming_shutdown(incoming, async {
                let _ = shutdown_rx.await;
            })
            .await
    });

    let endpoint = format!("http://{}", addr);
    let mut client =
        rpc::proto::horology_kernel_client::HorologyKernelClient::connect(endpoint.clone()).await?;
    let mut stream_client =
        rpc::proto::horology_kernel_client::HorologyKernelClient::connect(endpoint.clone()).await?;
    let mut stream = stream_client
        .stream_timer_events(Request::new(rpc::proto::TimerEventStreamRequest {
            tenant_id: "tenant-a".into(),
            topics: vec![],
        }))
        .await?
        .into_inner();

    let metadata = struct_from(vec![
        ("topic", string_value("demo")),
        ("priority", string_value("high")),
        ("attempt", number_value(1.0)),
    ]);

    let action_parameters = struct_from(vec![
        ("url", string_value("https://example.test/webhook")),
        ("method", string_value("POST")),
        (
            "payload",
            struct_value(vec![("message", string_value("kernel fired"))]),
        ),
    ]);

    let action_bundle = rpc::proto::TimerActionBundle {
        actions: vec![rpc::proto::TimerAction {
            id: "webhook-primary".into(),
            kind: "webhook".into(),
            parameters: Some(action_parameters.clone()),
            escalation: Some(Box::new(rpc::proto::Escalation {
                after_attempts: 1,
                escalates_to: None,
            })),
        }],
        concurrency: 1,
        retry_policy: Some(rpc::proto::RetryPolicy {
            max_attempts: 3,
            backoff_initial_ms: 1000,
            backoff_multiplier: 2.0,
        }),
    };

    let agent_binding = rpc::proto::AgentCommandBinding {
        adapter: "mcp".into(),
        target: "agent-alpha".into(),
        payload_template: Some(struct_from(vec![
            ("instruction", string_value("wake-up")),
            (
                "context",
                struct_value(vec![
                    ("timerId", string_value("{{timer.id}}")),
                    ("urgency", string_value("high")),
                ]),
            ),
        ])),
        acknowledgement_timeout_ms: 45_000,
    };

    let mut labels = HashMap::new();
    labels.insert("env".into(), "test".into());
    labels.insert("owner".into(), "agent-suite".into());

    let schedule_response = client
        .schedule_timer(Request::new(rpc::proto::TimerScheduleRequest {
            tenant_id: "tenant-a".into(),
            requested_by: "agent:planner".into(),
            name: "webhook-timer".into(),
            duration_ms: 120,
            fire_time: None,
            action_bundle: Some(action_bundle.clone()),
            labels: labels.clone(),
            metadata: Some(metadata.clone()),
            agent_binding: Some(agent_binding.clone()),
        }))
        .await?
        .into_inner();

    let timer = schedule_response
        .timer
        .as_ref()
        .expect("scheduled timer should exist")
        .clone();
    assert_eq!(timer.tenant_id, "tenant-a");
    assert_eq!(timer.name, "webhook-timer");
    assert_eq!(timer.labels.get("env"), Some(&"test".to_string()));
    assert!(timer.metadata.as_ref().is_some());
    assert!(timer.action_bundle.as_ref().is_some());
    assert!(timer.agent_binding.as_ref().is_some());

    let scheduled_event = tokio::time::timeout(Duration::from_secs(1), stream.message())
        .await
        .expect("scheduled event timeout")?
        .expect("scheduled event missing");
    match scheduled_event
        .event
        .expect("scheduled event payload missing")
    {
        rpc::proto::timer_event::Event::Scheduled(payload) => {
            let scheduled_timer = payload.timer.expect("scheduled timer");
            assert_eq!(scheduled_timer.id, timer.id);
            assert_eq!(
                rpc::proto::TimerStatus::try_from(scheduled_timer.status)
                    .expect("scheduled status"),
                rpc::proto::TimerStatus::Scheduled,
            );
        }
        other => panic!("unexpected event: {:?}", other),
    }

    let fired_event = tokio::time::timeout(Duration::from_secs(2), stream.message())
        .await
        .expect("fired event timeout")?
        .expect("fired event missing");
    match fired_event.event.expect("fired event payload missing") {
        rpc::proto::timer_event::Event::Fired(payload) => {
            let fired_timer = payload.timer.expect("fired timer");
            assert_eq!(fired_timer.id, timer.id);
            assert_eq!(
                rpc::proto::TimerStatus::try_from(fired_timer.status).expect("fired status"),
                rpc::proto::TimerStatus::Fired,
            );
            assert!(fired_timer.fired_at.is_some());
        }
        other => panic!("unexpected event: {:?}", other),
    }

    let mut second_labels = HashMap::new();
    second_labels.insert("env".into(), "test".into());

    let second_schedule = client
        .schedule_timer(Request::new(rpc::proto::TimerScheduleRequest {
            tenant_id: "tenant-a".into(),
            requested_by: "agent:planner".into(),
            name: "cancelled-timer".into(),
            duration_ms: 500,
            fire_time: None,
            action_bundle: None,
            labels: second_labels,
            metadata: None,
            agent_binding: None,
        }))
        .await?
        .into_inner();

    let second_timer = second_schedule
        .timer
        .clone()
        .expect("second timer should exist");

    let second_scheduled = tokio::time::timeout(Duration::from_secs(1), stream.message())
        .await
        .expect("second scheduled timeout")?
        .expect("second scheduled missing");
    match second_scheduled
        .event
        .expect("second scheduled payload missing")
    {
        rpc::proto::timer_event::Event::Scheduled(payload) => {
            let scheduled_timer = payload.timer.expect("scheduled timer");
            assert_eq!(scheduled_timer.id, second_timer.id);
        }
        other => panic!("unexpected event: {:?}", other),
    }

    let cancel_response = client
        .cancel_timer(Request::new(rpc::proto::TimerCancelRequest {
            tenant_id: "tenant-a".into(),
            timer_id: second_timer.id.clone(),
            reason: "manual-test".into(),
            requested_by: "agent:planner".into(),
        }))
        .await?
        .into_inner();

    assert_eq!(cancel_response.cancel_reason, "manual-test");
    assert_eq!(
        rpc::proto::TimerStatus::try_from(cancel_response.status).expect("cancel status"),
        rpc::proto::TimerStatus::Cancelled,
    );
    assert_eq!(cancel_response.cancelled_by, "agent:planner");
    assert!(cancel_response.cancelled_at.is_some());

    let cancel_event = tokio::time::timeout(Duration::from_secs(1), stream.message())
        .await
        .expect("cancel event timeout")?
        .expect("cancel event missing");
    match cancel_event.event.expect("cancel event payload missing") {
        rpc::proto::timer_event::Event::Cancelled(payload) => {
            let cancelled_timer = payload.timer.expect("cancelled timer");
            assert_eq!(cancelled_timer.id, second_timer.id);
            assert_eq!(payload.reason, "manual-test");
            assert_eq!(payload.cancelled_by, "agent:planner");
        }
        other => panic!("unexpected event: {:?}", other),
    }

    let fetched = client
        .get_timer(Request::new(rpc::proto::TimerGetRequest {
            tenant_id: "tenant-a".into(),
            timer_id: timer.id.clone(),
        }))
        .await?
        .into_inner();
    assert_eq!(
        rpc::proto::TimerStatus::try_from(fetched.status).expect("fired status"),
        rpc::proto::TimerStatus::Fired,
    );
    assert!(fetched.fired_at.is_some());

    let list = client
        .list_timers(Request::new(rpc::proto::TimerListRequest {
            tenant_id: "tenant-a".into(),
            page_size: 0,
            page_token: String::new(),
            statuses: vec![],
        }))
        .await?
        .into_inner();
    assert_eq!(list.timers.len(), 2);
    let statuses: Vec<_> = list
        .timers
        .iter()
        .map(|timer| rpc::proto::TimerStatus::try_from(timer.status).expect("list timer status"))
        .collect();
    assert!(statuses.contains(&rpc::proto::TimerStatus::Fired));
    assert!(statuses.contains(&rpc::proto::TimerStatus::Cancelled));

    drop(stream);
    drop(stream_client);
    drop(client);

    shutdown_tx.send(()).ok();
    server_handle.await.expect("server task panicked")?;

    Ok(())
}

fn string_value(value: &str) -> Value {
    Value {
        kind: Some(Kind::StringValue(value.to_string())),
    }
}

fn number_value(value: f64) -> Value {
    Value {
        kind: Some(Kind::NumberValue(value)),
    }
}

fn struct_value(entries: Vec<(&str, Value)>) -> Value {
    Value {
        kind: Some(Kind::StructValue(struct_from(entries))),
    }
}

fn struct_from(entries: Vec<(&str, Value)>) -> Struct {
    let mut fields = BTreeMap::new();
    for (key, value) in entries {
        fields.insert(key.to_string(), value);
    }
    Struct { fields }
}
