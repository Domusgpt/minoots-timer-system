use std::{collections::HashMap, net::SocketAddr};

use anyhow::Context;
use horology_kernel::{
    proto::horology_kernel_server::HorologyKernelServer, GrpcKernelService, HorologyKernel,
    SchedulerConfig, TimerSpec,
};
use tokio::signal;
use tonic::transport::Server;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let addr: SocketAddr = std::env::var("KERNEL_GRPC_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()
        .context("invalid KERNEL_GRPC_ADDR")?;

    info!(%addr, "Starting horology kernel gRPC server");

    let kernel = HorologyKernel::new(SchedulerConfig::default());
    let mut events = kernel.subscribe();
    let grpc_service = GrpcKernelService::new(kernel.clone());

    if std::env::var("MINOOTS_BOOT_DEMO").is_ok() {
        info!("Scheduling demo timer");
        kernel
            .schedule(TimerSpec {
                id: None,
                tenant_id: "demo".into(),
                requested_by: "bootstrap".into(),
                name: Some("demo-timer".into()),
                duration_ms: 5_000,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await?;
    }

    let event_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => info!(?event, "timer event"),
                Err(err) => {
                    warn!(?err, "event channel closed");
                    break;
                }
            }
        }
    });

    let server = Server::builder()
        .add_service(HorologyKernelServer::new(grpc_service))
        .serve_with_shutdown(addr, async {
            if let Err(err) = signal::ctrl_c().await {
                warn!(?err, "failed to listen for shutdown signal");
            }
            info!("Shutdown signal received");
        });

    if let Err(err) = server.await {
        tracing::error!(?err, "Horology kernel gRPC server exited with error");
    }

    info!("Shutting down horology kernel");
    event_task.abort();
    Ok(())
}
