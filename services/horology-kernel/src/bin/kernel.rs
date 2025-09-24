use horology_kernel::{rpc::KernelService, HorologyKernel, SchedulerConfig, TimerSpec};
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::signal;
use tonic::transport::Server;
use tracing::{error, info};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    info!("Starting horology kernel");

    let kernel = HorologyKernel::new(SchedulerConfig::default());
    let mut events = kernel.subscribe();

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

    let addr: SocketAddr = std::env::var("KERNEL_BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;

    info!(%addr, "Starting gRPC server for horology kernel");

    Server::builder()
        .add_service(KernelService::new(kernel.clone()).into_server())
        .serve_with_shutdown(addr, async {
            if let Err(error) = signal::ctrl_c().await {
                error!(?error, "Failed waiting for shutdown signal");
            }
            info!("Shutdown signal received");
        })
        .await?;

    info!("Shutting down horology kernel");
    log_task.abort();
    Ok(())
}
