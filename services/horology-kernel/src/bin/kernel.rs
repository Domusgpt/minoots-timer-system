use horology_kernel::events::jetstream::{spawn_forwarder, JetStreamForwarderConfig};
use horology_kernel::grpc::HorologyKernelService;
use horology_kernel::leadership::LeaderHandle;
use horology_kernel::pb::horology_kernel_server::HorologyKernelServer;
use horology_kernel::persistence::postgres::{PostgresCommandLog, PostgresTimerStore};
use horology_kernel::replication::{
    PostgresRaftCoordinator, PostgresRaftSettings, RaftClusterSettings, RaftSupervisor,
};
use horology_kernel::{
    EventSigner, HorologyKernel, KernelRuntimeOptions, SchedulerConfig, TimerSpec,
};
use openraft::BasicNode;
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};
use tokio::signal;
use tonic::transport::Server;
use tracing::{error, info, warn};
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    info!("Starting horology kernel");

    let (kernel, raft_supervisor, raft_coordinator) = build_kernel().await?;
    let mut logging_receiver = kernel.subscribe();
    let jetstream_task = match jetstream_forwarder_config_from_env() {
        Some(config) => match spawn_forwarder(config, kernel.subscribe()).await {
            Ok(handle) => Some(handle),
            Err(error) => {
                warn!(
                    ?error,
                    "Failed to start JetStream forwarder; continuing without NATS publishing"
                );
                None
            }
        },
        None => None,
    };
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
            match logging_receiver.recv().await {
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
    if let Some(handle) = jetstream_task {
        handle.abort();
    }
    if let Some(supervisor) = raft_supervisor {
        supervisor.shutdown().await.ok();
    }
    if let Some(coordinator) = raft_coordinator {
        coordinator.shutdown().await;
    }
    Ok(())
}

async fn build_kernel() -> anyhow::Result<(
    HorologyKernel,
    Option<horology_kernel::replication::RaftSupervisor>,
    Option<PostgresRaftCoordinator>,
)> {
    let config = SchedulerConfig::default();
    match std::env::var("KERNEL_STORE")
        .unwrap_or_else(|_| "memory".to_string())
        .to_lowercase()
        .as_str()
    {
        "postgres" => {
            let database_url = std::env::var("KERNEL_DATABASE_URL")
                .or_else(|_| std::env::var("DATABASE_URL"))
                .map_err(|_| {
                    anyhow::anyhow!(
                    "KERNEL_DATABASE_URL or DATABASE_URL must be set when KERNEL_STORE=postgres"
                )
                })?;
            let store = PostgresTimerStore::connect(&database_url).await?;
            let pool = store.pool();
            let shared_store = Arc::new(store) as horology_kernel::persistence::SharedTimerStore;
            let command_log = Arc::new(PostgresCommandLog::new(pool.clone()))
                as horology_kernel::persistence::command_log::SharedCommandLog;
            let (raft_handle, raft_coordinator, leader_handle) = if let Ok(node_id_raw) =
                std::env::var("KERNEL_RAFT_NODE_ID")
            {
                let node_id: u64 = node_id_raw
                    .parse()
                    .map_err(|error| anyhow::anyhow!("invalid KERNEL_RAFT_NODE_ID: {error}"))?;
                let rpc_addr: SocketAddr = std::env::var("KERNEL_RAFT_ADDR")
                    .unwrap_or_else(|_| "0.0.0.0:7207".to_string())
                    .parse()
                    .map_err(|error| anyhow::anyhow!("invalid KERNEL_RAFT_ADDR: {error}"))?;
                let peers_env = std::env::var("KERNEL_RAFT_PEERS")
                    .unwrap_or_else(|_| format!("{}=http://127.0.0.1:7207", node_id));
                let peers = parse_peer_map(&peers_env)?;
                let election_min = env_u64("KERNEL_RAFT_ELECTION_MIN_MS", 300);
                let election_max = env_u64("KERNEL_RAFT_ELECTION_MAX_MS", 600);
                let heartbeat = env_u64("KERNEL_RAFT_HEARTBEAT_MS", 100);

                match RaftSupervisor::start(RaftClusterSettings {
                    node_id,
                    rpc_addr,
                    peers,
                    election_timeout_min_ms: election_min,
                    election_timeout_max_ms: election_max,
                    heartbeat_interval_ms: heartbeat,
                    storage_pool: Some(pool.clone()),
                })
                .await
                {
                    Ok((supervisor, handle)) => (Some(supervisor), None, Some(handle)),
                    Err(error) => {
                        warn!(?error, "failed to start OpenRaft supervisor; using Postgres coordinator instead");
                        let (coordinator, handle) =
                            start_postgres_coordinator(pool.clone()).await?;
                        (None, Some(coordinator), Some(handle))
                    }
                }
            } else {
                let (coordinator, handle) = start_postgres_coordinator(pool.clone()).await?;
                (None, Some(coordinator), Some(handle))
            };

            let event_signer = match std::env::var("EVENT_ENVELOPE_SECRET")
                .or_else(|_| std::env::var("KERNEL_ENVELOPE_SECRET"))
            {
                Ok(secret) if !secret.trim().is_empty() => {
                    Arc::new(EventSigner::new(secret.as_bytes()))
                }
                _ => {
                    warn!(
                        "EVENT_ENVELOPE_SECRET not configured; using insecure development secret"
                    );
                    Arc::new(EventSigner::insecure_dev())
                }
            };

            let options = KernelRuntimeOptions {
                store: shared_store,
                command_log: Some(command_log),
                leader: leader_handle,
                event_signer,
            };
            let kernel = HorologyKernel::with_runtime(config, options).await?;
            tracing::info!(
                "kernel_store" = "postgres",
                "Loaded horology kernel with Postgres persistence"
            );
            Ok((kernel, raft_handle, raft_coordinator))
        }
        other => {
            if other != "memory" {
                tracing::warn!(
                    store = other,
                    "Unknown KERNEL_STORE value, defaulting to in-memory"
                );
            }
            Ok((HorologyKernel::new(config), None, None))
        }
    }
}

async fn start_postgres_coordinator(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<(PostgresRaftCoordinator, LeaderHandle)> {
    let node_id = std::env::var("KERNEL_NODE_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("kernel-{}", Uuid::new_v4()));
    let heartbeat_ms = env_u64("KERNEL_RAFT_HEARTBEAT_MS", 250);
    let election_timeout_ms = env_u64("KERNEL_RAFT_ELECTION_TIMEOUT_MS", 1_500);

    let settings = PostgresRaftSettings {
        pool,
        node_id: node_id.clone(),
        heartbeat_interval: Duration::from_millis(heartbeat_ms),
        election_timeout: Duration::from_millis(election_timeout_ms),
    };

    let (coordinator, handle) = PostgresRaftCoordinator::start(settings).await?;
    info!(
        node = %node_id,
        heartbeat_ms,
        election_timeout_ms,
        "started postgres raft coordinator"
    );
    Ok((coordinator, handle))
}

fn jetstream_forwarder_config_from_env() -> Option<JetStreamForwarderConfig> {
    let servers = std::env::var("NATS_JETSTREAM_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("NATS_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })?;
    let subject = std::env::var("NATS_SUBJECT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "minoots.timer.fired".to_string());
    let stream = std::env::var("NATS_JETSTREAM_STREAM")
        .ok()
        .filter(|value| !value.trim().is_empty());
    Some(JetStreamForwarderConfig {
        servers,
        subject,
        stream,
    })
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn parse_peer_map(value: &str) -> anyhow::Result<HashMap<u64, BasicNode>> {
    let mut map = HashMap::new();
    for pair in value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let (id_raw, addr) = pair
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("invalid KERNEL_RAFT_PEERS entry '{pair}'"))?;
        let id: u64 = id_raw
            .trim()
            .parse()
            .map_err(|error| anyhow::anyhow!("invalid peer id '{id_raw}': {error}"))?;
        map.insert(
            id,
            BasicNode {
                addr: addr.trim().to_string(),
                ..Default::default()
            },
        );
    }
    if map.is_empty() {
        return Err(anyhow::anyhow!(
            "KERNEL_RAFT_PEERS produced an empty peer set"
        ));
    }
    Ok(map)
}
