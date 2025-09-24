use horology_kernel::{HorologyKernel, SchedulerConfig, TimerSpec};
use std::collections::HashMap;
use tokio::signal;
use tracing::info;

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

    let kernel_task = tokio::spawn(async move {
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

    signal::ctrl_c().await?;
    info!("Shutting down horology kernel");
    kernel_task.abort();
    Ok(())
}
