use horology_kernel::{
    grpc::{HorologyKernelServer, KernelGrpcService},
    HorologyKernel, SchedulerConfig, TimerSpec,
};
use std::{collections::HashMap, net::SocketAddr};
use tokio::signal;
use tonic::transport::Server;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let addr: SocketAddr = std::env::var("KERNEL_GRPC_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;

    info!(%addr, "Starting horology kernel gRPC server");

    let kernel = HorologyKernel::new(SchedulerConfig::default());
    let mut events = kernel.subscribe();
    let grpc = KernelGrpcService::new(kernel.clone());

    // Spawn a demo timer if running in local dev mode.
    if std::env::var("MINOOTS_BOOT_DEMO").is_ok() {
        info!("Scheduling demo timer");
        kernel
            .schedule(TimerSpec {
                tenant_id: "demo".into(),
                requested_by: "bootstrap".into(),
                name: Some("demo-timer".into()),
                duration_ms: 5000,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await?;
    }

    let log_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => info!(?event, "timer event"),
                Err(err) => {
                    tracing::warn!(?err, "event channel closed");
                    break;
                }
            }
        }
    });

    let server = Server::builder()
        .add_service(HorologyKernelServer::new(grpc))
        .serve(addr);

    tokio::select! {
        result = server => {
            result?;
        }
        _ = signal::ctrl_c() => {
            info!("Received shutdown signal");
        }
    }

    info!("Shutting down horology kernel");
    log_task.abort();
    Ok(())
}
