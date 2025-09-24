use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;

use horology_kernel::grpc::HorologyKernelService;
use horology_kernel::pb::horology_kernel_client::HorologyKernelClient;
use horology_kernel::pb::horology_kernel_server::HorologyKernelServer;
use horology_kernel::pb::{
    timer_schedule_request, TimerCancelRequest, TimerListRequest, TimerScheduleRequest,
};
use horology_kernel::{HorologyKernel, SchedulerConfig};
use tokio::sync::oneshot;
use tonic::transport::Server;

#[tokio::test]
async fn grpc_schedule_and_cancel_roundtrip() {
    let kernel = HorologyKernel::new(SchedulerConfig::default());
    let service = HorologyKernelService::new(kernel.clone());
    let addr: SocketAddr = "127.0.0.1:50061".parse().unwrap();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let server = tokio::spawn(async move {
        Server::builder()
            .add_service(HorologyKernelServer::new(service))
            .serve_with_shutdown(addr, async {
                shutdown_rx.await.ok();
            })
            .await
            .unwrap();
    });

    // Ensure the server has time to start listening.
    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut client = HorologyKernelClient::connect("http://127.0.0.1:50061")
        .await
        .expect("connect to kernel");

    let schedule_response = client
        .schedule_timer(tonic::Request::new(TimerScheduleRequest {
            tenant_id: "tenant-test".into(),
            requested_by: "agent-test".into(),
            name: "integration".into(),
            schedule_time: Some(timer_schedule_request::ScheduleTime::DurationMs(50)),
            metadata_json: String::new(),
            labels: HashMap::new(),
            action_bundle_json: String::new(),
            agent_binding_json: String::new(),
        }))
        .await
        .expect("schedule response")
        .into_inner();

    let timer = schedule_response.timer.expect("timer payload");
    assert_eq!(timer.tenant_id, "tenant-test");

    let list_response = client
        .list_timers(tonic::Request::new(TimerListRequest {
            tenant_id: "tenant-test".into(),
            page_size: 0,
            page_token: String::new(),
            statuses: vec![],
        }))
        .await
        .expect("list response")
        .into_inner();
    assert_eq!(list_response.timers.len(), 1);

    let cancel_response = client
        .cancel_timer(tonic::Request::new(TimerCancelRequest {
            tenant_id: "tenant-test".into(),
            timer_id: timer.id.clone(),
            requested_by: "agent-test".into(),
            reason: "integration".into(),
        }))
        .await
        .expect("cancel response")
        .into_inner();

    assert_eq!(cancel_response.id, timer.id);
    assert_eq!(cancel_response.status, horology_kernel::pb::TimerStatus::Cancelled as i32);

    let _ = shutdown_tx.send(());
    server.await.expect("server join");
}
