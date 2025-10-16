use std::net::SocketAddr;
use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::{anyhow, Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use openraft::error::{
    InitializeError, InstallSnapshotError, NetworkError, RPCError, RaftError, Unreachable,
};
use openraft::raft::{
    AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, InstallSnapshotResponse,
    VoteRequest, VoteResponse,
};
use openraft::storage::Adaptor;
use openraft::{
    BasicNode, Config, Raft, RaftMetrics, RaftNetwork, RaftNetworkFactory, SnapshotPolicy,
};
use openraft_memstore::{MemStore, TypeConfig as MemStoreConfig};
use rand::{thread_rng, Rng};
use sqlx::{Pool, Postgres, Row};
use tokio::sync::{watch, Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};
use tracing::{debug, info, warn};

use std::io;

use crate::leadership::LeaderHandle;

#[derive(Clone, Debug)]
pub struct PostgresRaftSettings {
    pub pool: Pool<Postgres>,
    pub node_id: String,
    pub heartbeat_interval: Duration,
    pub election_timeout: Duration,
}

pub struct PostgresRaftCoordinator {
    heartbeat: JoinHandle<()>,
    election: JoinHandle<()>,
    stop_tx: watch::Sender<bool>,
    leader: LeaderHandle,
}

impl PostgresRaftCoordinator {
    pub async fn start(settings: PostgresRaftSettings) -> Result<(Self, LeaderHandle)> {
        ensure_table(&settings.pool).await?;

        let (leader_tx, _) = watch::channel(false);
        let leader_handle = LeaderHandle::new(leader_tx.clone());
        let stop = watch::channel(false);
        let stop_tx = stop.0.clone();
        let mut stop_rx_heartbeat = stop.1.clone();
        let mut stop_rx_election = stop.1.clone();

        let is_leader = Arc::new(Mutex::new(false));
        let heartbeat_settings = settings.clone();
        let election_settings = settings.clone();
        let leader_for_heartbeat = leader_handle.clone();
        let leader_for_election = leader_handle.clone();
        let is_leader_for_heartbeat = is_leader.clone();
        let is_leader_for_election = is_leader.clone();

        let heartbeat = tokio::spawn(async move {
            loop {
                if stop_rx_heartbeat.changed().await.is_ok() && *stop_rx_heartbeat.borrow() {
                    break;
                }

                sleep(heartbeat_settings.heartbeat_interval).await;
                let mut guard = is_leader_for_heartbeat.lock().await;
                if !*guard {
                    continue;
                }

                if let Err(error) =
                    send_heartbeat(&heartbeat_settings.pool, &heartbeat_settings.node_id).await
                {
                    warn!(?error, "failed to publish heartbeat");
                    *guard = false;
                    leader_for_heartbeat.set_leader(false);
                }
            }
        });

        let election = tokio::spawn(async move {
            let mut next_attempt = Instant::now();
            loop {
                if stop_rx_election.changed().await.is_ok() && *stop_rx_election.borrow() {
                    break;
                }

                if Instant::now() < next_attempt {
                    sleep(next_attempt - Instant::now()).await;
                }

                match run_election_round(
                    &election_settings,
                    &leader_for_election,
                    &is_leader_for_election,
                )
                .await
                {
                    Ok(_) => {}
                    Err(error) => warn!(?error, "election round failed"),
                }

                next_attempt =
                    Instant::now() + jittered_interval(election_settings.election_timeout);
            }
        });

        let coordinator = Self {
            heartbeat,
            election,
            stop_tx,
            leader: leader_handle.clone(),
        };

        Ok((coordinator, leader_handle))
    }

    pub async fn shutdown(self) {
        let _ = self.stop_tx.send(true);
        self.heartbeat.abort();
        self.election.abort();
        self.leader.set_leader(false);
    }
}

async fn ensure_table(pool: &Pool<Postgres>) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS kernel_raft_state (
            id BOOLEAN PRIMARY KEY DEFAULT TRUE,
            leader_id TEXT NOT NULL,
            term BIGINT NOT NULL,
            heartbeat_at TIMESTAMPTZ NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await
    .context("failed to create kernel_raft_state table")?;
    Ok(())
}

async fn send_heartbeat(pool: &Pool<Postgres>, node_id: &str) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE kernel_raft_state
           SET heartbeat_at = NOW()
         WHERE id = TRUE AND leader_id = $1
        "#,
    )
    .bind(node_id)
    .execute(pool)
    .await
    .context("failed to update heartbeat")?;
    Ok(())
}

async fn run_election_round(
    settings: &PostgresRaftSettings,
    leader_handle: &LeaderHandle,
    is_leader: &Arc<Mutex<bool>>,
) -> Result<()> {
    let timeout = settings.election_timeout;
    let stale = sqlx::query(
        r#"
        SELECT leader_id, heartbeat_at, term
          FROM kernel_raft_state
         WHERE id = TRUE
        "#,
    )
    .fetch_optional(&settings.pool)
    .await
    .context("failed to fetch current leader")?;

    let now = Utc::now();
    let mut guard = is_leader.lock().await;

    if let Some(row) = stale {
        let leader_id: String = row.get("leader_id");
        let heartbeat_at: DateTime<Utc> = row.get("heartbeat_at");
        let term: i64 = row.get("term");

        if leader_id == settings.node_id {
            if now - heartbeat_at > ChronoDuration::from_std(timeout)? {
                debug!("heartbeat stale for current leader, attempting refresh");
                takeover(&settings.pool, &settings.node_id, term + 1, true, timeout).await?;
            }
            *guard = true;
            leader_handle.set_leader(true);
            return Ok(());
        }

        if now - heartbeat_at < ChronoDuration::from_std(timeout)? {
            *guard = false;
            leader_handle.set_leader(false);
            return Ok(());
        }

        let updated = takeover(&settings.pool, &settings.node_id, term + 1, false, timeout).await?;
        if updated {
            *guard = true;
            leader_handle.set_leader(true);
            info!(node = %settings.node_id, term = term + 1, "assumed leadership (stale heartbeat)");
        } else {
            *guard = false;
            leader_handle.set_leader(false);
        }
        return Ok(());
    }

    // No leader record yet, insert one.
    let inserted = sqlx::query(
        r#"
        INSERT INTO kernel_raft_state (id, leader_id, term, heartbeat_at)
        VALUES (TRUE, $1, 1, NOW())
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(&settings.node_id)
    .execute(&settings.pool)
    .await
    .context("failed to insert initial leader state")?;

    if inserted.rows_affected() > 0 {
        *guard = true;
        leader_handle.set_leader(true);
        info!(node = %settings.node_id, term = 1, "initialized raft state as leader");
    }

    Ok(())
}

async fn takeover(
    pool: &Pool<Postgres>,
    node_id: &str,
    term: i64,
    allow_current: bool,
    timeout: Duration,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE kernel_raft_state
           SET leader_id = $1,
               term = $2,
               heartbeat_at = NOW()
         WHERE id = TRUE
           AND ($3 OR heartbeat_at < NOW() - $4::INTERVAL)
        "#,
    )
    .bind(node_id)
    .bind(term)
    .bind(allow_current)
    .bind(interval_literal(timeout))
    .execute(pool)
    .await
    .context("failed to update leader row")?;

    Ok(result.rows_affected() > 0)
}

fn jittered_interval(base: Duration) -> Duration {
    let jitter: f64 = thread_rng().gen_range(0.6..1.2);
    let millis = (base.as_millis() as f64 * jitter).max(100.0);
    Duration::from_millis(millis as u64)
}

fn interval_literal(duration: Duration) -> String {
    let millis = duration.as_millis();
    let safe = if millis == 0 { 1 } else { millis };
    format!("{safe} milliseconds")
}

#[derive(Clone, Debug)]
pub struct RaftClusterSettings {
    pub node_id: u64,
    pub rpc_addr: SocketAddr,
    pub peers: HashMap<u64, BasicNode>,
    pub election_timeout_min_ms: u64,
    pub election_timeout_max_ms: u64,
    pub heartbeat_interval_ms: u64,
}

type LeadershipRaft = Raft<MemStoreConfig>;

#[derive(Clone)]
struct HttpRaftNetworkFactory {
    client: reqwest::Client,
    peers: Arc<RwLock<HashMap<u64, BasicNode>>>,
}

#[derive(Clone)]
struct HttpRaftNetwork {
    client: reqwest::Client,
    target: u64,
    peers: Arc<RwLock<HashMap<u64, BasicNode>>>,
}

#[derive(Clone)]
struct RaftHttpState {
    raft: LeadershipRaft,
}

pub struct RaftSupervisor {
    raft: LeadershipRaft,
    http_task: JoinHandle<()>,
    http_shutdown: watch::Sender<bool>,
    metrics_task: JoinHandle<()>,
    leader: LeaderHandle,
}

impl RaftSupervisor {
    pub async fn start(settings: RaftClusterSettings) -> Result<(Self, LeaderHandle)> {
        let (leader_tx, _) = watch::channel(false);
        let leader_handle = LeaderHandle::new(leader_tx.clone());

        let peers = Arc::new(RwLock::new(settings.peers.clone()));
        {
            let mut guard = peers.write().await;
            guard.insert(
                settings.node_id,
                BasicNode {
                    addr: format!("http://{}", settings.rpc_addr),
                    ..Default::default()
                },
            );
        }

        let mut config = Config::default();
        config.cluster_name = "horology-kernel".into();
        config.election_timeout_min = settings.election_timeout_min_ms;
        config.election_timeout_max = settings.election_timeout_max_ms;
        config.heartbeat_interval = settings.heartbeat_interval_ms;
        config.snapshot_policy = SnapshotPolicy::Never;
        let config = Arc::new(config.validate().map_err(|err| anyhow!(err))?);

        let store = MemStore::new_async().await;
        let (log_store, state_machine) = Adaptor::new(store.clone());
        let network = HttpRaftNetworkFactory::new(peers.clone());
        let raft = Raft::new(
            settings.node_id,
            config.clone(),
            network,
            log_store,
            state_machine,
        )
        .await
        .map_err(|fatal| anyhow!(fatal))?;

        initialize_membership(&raft, settings.node_id, peers.clone()).await?;

        let (http_shutdown, mut http_rx) = watch::channel(false);
        let state = RaftHttpState { raft: raft.clone() };
        let app = Router::new()
            .route("/raft/append", post(http_append))
            .route("/raft/vote", post(http_vote))
            .route("/raft/install", post(http_install_snapshot))
            .with_state(state.clone());

        let listener = tokio::net::TcpListener::bind(settings.rpc_addr)
            .await
            .context("failed to bind raft HTTP listener")?;

        let http_task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = http_rx.changed().await;
                })
                .await
            {
                warn!(?error, "raft http server exited with error");
            }
        });

        let metrics_task =
            spawn_metrics_watcher(raft.clone(), leader_handle.clone(), settings.node_id);

        let supervisor = Self {
            raft,
            http_task,
            http_shutdown,
            metrics_task,
            leader: leader_handle.clone(),
        };

        Ok((supervisor, leader_handle))
    }

    pub async fn shutdown(self) -> Result<()> {
        self.leader.set_leader(false);
        let _ = self.http_shutdown.send(true);
        if let Err(error) = self.raft.shutdown().await {
            warn!(?error, "error during raft shutdown");
        }
        self.metrics_task.abort();
        let _ = self.metrics_task.await;
        if let Err(error) = self.http_task.await {
            warn!(?error, "error joining raft http task");
        }
        Ok(())
    }
}

impl HttpRaftNetworkFactory {
    fn new(peers: Arc<RwLock<HashMap<u64, BasicNode>>>) -> Self {
        Self {
            client: reqwest::Client::new(),
            peers,
        }
    }
}

impl RaftNetworkFactory<MemStoreConfig> for HttpRaftNetworkFactory {
    type Network = HttpRaftNetwork;

    async fn new_client(&mut self, target: u64, _node: &()) -> Self::Network {
        HttpRaftNetwork {
            client: self.client.clone(),
            target,
            peers: self.peers.clone(),
        }
    }
}

impl RaftNetwork<MemStoreConfig> for HttpRaftNetwork {
    async fn append_entries(
        &mut self,
        rpc: AppendEntriesRequest<MemStoreConfig>,
        _option: openraft::network::RPCOption,
    ) -> Result<AppendEntriesResponse<u64>, RPCError<u64, (), RaftError<u64>>> {
        self.perform_append_entries(rpc).await
    }

    async fn install_snapshot(
        &mut self,
        rpc: InstallSnapshotRequest<MemStoreConfig>,
        _option: openraft::network::RPCOption,
    ) -> Result<InstallSnapshotResponse<u64>, RPCError<u64, (), RaftError<u64, InstallSnapshotError>>>
    {
        self.perform_install_snapshot(rpc).await
    }

    async fn vote(
        &mut self,
        rpc: VoteRequest<u64>,
        _option: openraft::network::RPCOption,
    ) -> Result<VoteResponse<u64>, RPCError<u64, (), RaftError<u64>>> {
        self.perform_vote(rpc).await
    }
}

impl HttpRaftNetwork {
    async fn resolve_url(&self, path: &str) -> Result<String, RPCError<u64, (), RaftError<u64>>> {
        let map = self.peers.read().await;
        map.get(&self.target)
            .map(|node| format!("{}{}", node.addr, path))
            .ok_or_else(|| {
                let err = io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("unknown peer {}", self.target),
                );
                RPCError::Unreachable(Unreachable::new(&err))
            })
    }

    async fn resolve_url_install(
        &self,
        path: &str,
    ) -> Result<String, RPCError<u64, (), RaftError<u64, InstallSnapshotError>>> {
        let map = self.peers.read().await;
        map.get(&self.target)
            .map(|node| format!("{}{}", node.addr, path))
            .ok_or_else(|| {
                let err = io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("unknown peer {}", self.target),
                );
                RPCError::Unreachable(Unreachable::new(&err))
            })
    }

    async fn perform_append_entries(
        &self,
        rpc: AppendEntriesRequest<MemStoreConfig>,
    ) -> Result<AppendEntriesResponse<u64>, RPCError<u64, (), RaftError<u64>>> {
        let url = self.resolve_url("/raft/append").await?;

        let response = self
            .client
            .post(url)
            .json(&rpc)
            .send()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        let response = response
            .error_for_status()
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        response
            .json()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))
    }

    async fn perform_install_snapshot(
        &self,
        rpc: InstallSnapshotRequest<MemStoreConfig>,
    ) -> Result<InstallSnapshotResponse<u64>, RPCError<u64, (), RaftError<u64, InstallSnapshotError>>>
    {
        let url = self.resolve_url_install("/raft/install").await?;

        let response = self
            .client
            .post(url)
            .json(&rpc)
            .send()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        let response = response
            .error_for_status()
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        response
            .json()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))
    }

    async fn perform_vote(
        &self,
        rpc: VoteRequest<u64>,
    ) -> Result<VoteResponse<u64>, RPCError<u64, (), RaftError<u64>>> {
        let url = self.resolve_url("/raft/vote").await?;

        let response = self
            .client
            .post(url)
            .json(&rpc)
            .send()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        let response = response
            .error_for_status()
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        response
            .json()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))
    }
}

async fn initialize_membership(
    raft: &LeadershipRaft,
    local_id: u64,
    peers: Arc<RwLock<HashMap<u64, BasicNode>>>,
) -> Result<()> {
    use std::collections::BTreeSet;

    let mut members = BTreeSet::new();
    members.insert(local_id);
    {
        let map = peers.read().await;
        for id in map.keys() {
            members.insert(*id);
        }
    }

    match raft.initialize(members).await {
        Ok(_) => Ok(()),
        Err(RaftError::APIError(InitializeError::NotAllowed(_))) => Ok(()),
        Err(RaftError::APIError(InitializeError::NotInMembers(err))) => {
            Err(anyhow!("local node missing from membership: {err:?}",))
        }
        Err(RaftError::Fatal(fatal)) => Err(anyhow!(fatal)),
    }
}

fn spawn_metrics_watcher(
    raft: LeadershipRaft,
    leader_handle: LeaderHandle,
    local_id: u64,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut metrics = raft.metrics();
        update_leadership(&leader_handle, &metrics.borrow(), local_id);
        while metrics.changed().await.is_ok() {
            update_leadership(&leader_handle, &metrics.borrow(), local_id);
        }
        leader_handle.set_leader(false);
    })
}

fn update_leadership(handle: &LeaderHandle, metrics: &RaftMetrics<u64, ()>, local_id: u64) {
    let is_leader = metrics
        .current_leader
        .as_ref()
        .is_some_and(|leader| *leader == local_id);
    handle.set_leader(is_leader);
}

async fn http_append(
    State(state): State<RaftHttpState>,
    Json(rpc): Json<AppendEntriesRequest<MemStoreConfig>>,
) -> Result<Json<AppendEntriesResponse<u64>>, StatusCode> {
    state
        .raft
        .append_entries(rpc)
        .await
        .map(Json)
        .map_err(|error| {
            warn!(?error, "append_entries handler failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn http_vote(
    State(state): State<RaftHttpState>,
    Json(rpc): Json<VoteRequest<u64>>,
) -> Result<Json<VoteResponse<u64>>, StatusCode> {
    state.raft.vote(rpc).await.map(Json).map_err(|error| {
        warn!(?error, "vote handler failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

async fn http_install_snapshot(
    State(state): State<RaftHttpState>,
    Json(rpc): Json<InstallSnapshotRequest<MemStoreConfig>>,
) -> Result<Json<InstallSnapshotResponse<u64>>, StatusCode> {
    state
        .raft
        .install_snapshot(rpc)
        .await
        .map(Json)
        .map_err(|error| {
            warn!(?error, "install_snapshot handler failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::postgres::init_test_pool;
    use std::time::Instant;

    async fn wait_for_condition<F>(timeout_duration: Duration, mut condition: F) -> bool
    where
        F: FnMut() -> bool + Send,
    {
        let deadline = Instant::now() + timeout_duration;
        loop {
            if condition() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn truncate_state(pool: &Pool<Postgres>) {
        sqlx::query("TRUNCATE kernel_raft_state RESTART IDENTITY")
            .execute(pool)
            .await
            .expect("truncate kernel_raft_state");
    }

    #[tokio::test]
    async fn coordinates_single_leader() {
        let Some(pool) = init_test_pool().await else {
            eprintln!("[replication-tests] skipping — DATABASE_URL not configured");
            return;
        };

        truncate_state(&pool).await;

        let settings = PostgresRaftSettings {
            pool: pool.clone(),
            node_id: "node-a".into(),
            heartbeat_interval: Duration::from_millis(50),
            election_timeout: Duration::from_millis(200),
        };

        let (coordinator, leader) = PostgresRaftCoordinator::start(settings)
            .await
            .expect("start coordinator");

        let became_leader = wait_for_condition(Duration::from_secs(2), || leader.is_leader()).await;
        assert!(became_leader, "leader handle never flipped to true");

        let row = sqlx::query("SELECT leader_id, term FROM kernel_raft_state WHERE id = TRUE")
            .fetch_one(&pool)
            .await
            .expect("fetch leader row");

        let leader_id: String = row.get("leader_id");
        let term: i64 = row.get("term");
        assert_eq!(leader_id, "node-a");
        assert_eq!(term, 1);

        coordinator.shutdown().await;
        let lost_leadership =
            wait_for_condition(Duration::from_secs(1), || !leader.is_leader()).await;
        assert!(
            lost_leadership,
            "leader handle remained true after shutdown"
        );
    }

    #[tokio::test]
    async fn fails_over_after_heartbeat_gap() {
        let Some(pool) = init_test_pool().await else {
            eprintln!("[replication-tests] skipping — DATABASE_URL not configured");
            return;
        };

        truncate_state(&pool).await;

        let election_timeout = Duration::from_millis(200);

        let (coord_a, leader_a) = PostgresRaftCoordinator::start(PostgresRaftSettings {
            pool: pool.clone(),
            node_id: "node-a".into(),
            heartbeat_interval: Duration::from_millis(40),
            election_timeout,
        })
        .await
        .expect("start coordinator a");

        let (coord_b, leader_b) = PostgresRaftCoordinator::start(PostgresRaftSettings {
            pool: pool.clone(),
            node_id: "node-b".into(),
            heartbeat_interval: Duration::from_millis(40),
            election_timeout,
        })
        .await
        .expect("start coordinator b");

        let a_is_leader = wait_for_condition(Duration::from_secs(2), || leader_a.is_leader()).await;
        assert!(a_is_leader, "node-a never became leader");
        assert!(
            !leader_b.is_leader(),
            "node-b should not lead while node-a heartbeats"
        );

        coord_a.shutdown().await;

        let failover = wait_for_condition(Duration::from_secs(3), || leader_b.is_leader()).await;
        assert!(
            failover,
            "node-b did not assume leadership after heartbeat gap"
        );

        coord_b.shutdown().await;
        let b_cleared = wait_for_condition(Duration::from_secs(1), || !leader_b.is_leader()).await;
        assert!(
            b_cleared,
            "node-b leader handle remained true after shutdown"
        );
    }
}
