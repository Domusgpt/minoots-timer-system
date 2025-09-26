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

    let kernel = if let Ok(path) = std::env::var("KERNEL_PERSIST_PATH") {
        info!(path, "Loading kernel with persistence");
        HorologyKernel::with_persistence(SchedulerConfig::default(), path).await?
    } else {
        HorologyKernel::new(SchedulerConfig::default())
    };
    let mut events = kernel.subscribe();
    let grpc_service = GrpcKernelService::new(kernel.clone());

    let nats_publisher = if let Ok(url) = std::env::var("NATS_URL") {
        let subject = std::env::var("NATS_SUBJECT").unwrap_or_else(|_| "minoots.timer.events".to_string());
        match async_nats::connect(url.clone()).await {
            Ok(client) => {
                info!(%url, subject, "Publishing timer events to NATS");
                Some((client, subject))
            }
            Err(err) => {
                warn!(%url, ?err, "Failed to connect to NATS");
                None
            }
        }
    } else {
        None
    };

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
                Ok(event) => {
                    info!(?event, "timer event");
                    if let Some((client, subject)) = &nats_publisher {
                        match serde_json::to_vec(&event) {
                            Ok(payload) => {
                                if let Err(err) = client.publish(subject.clone(), payload.into()).await {
                                    warn!(?err, "failed to publish timer event to NATS");
                                }
                            }
                            Err(err) => warn!(?err, "failed to encode timer event for NATS"),
                        }
                    }
                }
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
