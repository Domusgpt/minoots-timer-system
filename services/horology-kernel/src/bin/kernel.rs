use horology_kernel::grpc::HorologyKernelService;
use horology_kernel::leadership::PostgresLeaderElector;
use horology_kernel::persistence::postgres::{PostgresCommandLog, PostgresTimerStore};
use horology_kernel::pb::horology_kernel_server::HorologyKernelServer;
use horology_kernel::{HorologyKernel, KernelRuntimeOptions, SchedulerConfig, TimerSpec};
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};
use tokio::signal;
use tonic::transport::Server;
use tracing::{error, info};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    info!("Starting horology kernel");

    let kernel = build_kernel().await?;
    let mut events = kernel.subscribe();
    let grpc_addr: SocketAddr = std::env::var("KERNEL_GRPC_ADDR")
        .or_else(|_| std::env::var("KERNEL_GRPC_URL"))
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;
    let grpc_service = HorologyKernelService::new(kernel.clone());

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

    let event_task = tokio::spawn(async move {
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

    info!(%grpc_addr, "Starting horology kernel gRPC server");
    Server::builder()
        .add_service(HorologyKernelServer::new(grpc_service))
        .serve_with_shutdown(grpc_addr, async {
            signal::ctrl_c()
                .await
                .expect("failed to listen for shutdown signal");
        })
        .await
        .map_err(|error| {
            error!(?error, "gRPC server error");
            anyhow::anyhow!(error)
        })?;

    info!("Shutting down horology kernel");
    event_task.abort();
    Ok(())
}

async fn build_kernel() -> anyhow::Result<HorologyKernel> {
    let config = SchedulerConfig::default();
    match std::env::var("KERNEL_STORE")
        .unwrap_or_else(|_| "memory".to_string())
        .to_lowercase()
        .as_str()
    {
        "postgres" => {
            let database_url = std::env::var("KERNEL_DATABASE_URL")
                .or_else(|_| std::env::var("DATABASE_URL"))
                .map_err(|_| anyhow::anyhow!(
                    "KERNEL_DATABASE_URL or DATABASE_URL must be set when KERNEL_STORE=postgres"
                ))?;
            let store = PostgresTimerStore::connect(&database_url).await?;
            let pool = store.pool();
            let shared_store = Arc::new(store) as horology_kernel::persistence::SharedTimerStore;
            let command_log = Arc::new(PostgresCommandLog::new(pool.clone()))
                as horology_kernel::persistence::command_log::SharedCommandLog;
            let leader = PostgresLeaderElector::new(pool, 42, Duration::from_secs(1))
                .start()
                .await?;
            let options = KernelRuntimeOptions {
                store: shared_store,
                command_log: Some(command_log),
                leader: Some(leader),
            };
            let kernel = HorologyKernel::with_runtime(config, options).await?;
            tracing::info!("kernel_store" = "postgres", "Loaded horology kernel with Postgres persistence");
            Ok(kernel)
        }
        other => {
            if other != "memory" {
                tracing::warn!(store = other, "Unknown KERNEL_STORE value, defaulting to in-memory");
            }
            Ok(HorologyKernel::new(config))
        }
    }
}
