use std::{
    collections::{BTreeSet, HashMap},
    fmt,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rand::{thread_rng, Rng};
use sqlx::{Pool, Postgres, Row};
use tokio::sync::{oneshot, watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tracing::{debug, error, info, info_span, warn};

use crate::leadership::LeaderHandle;
use crate::telemetry::replication::{
    record_election_attempt, record_election_result, record_heartbeat_outcome,
    record_leadership_transition, ElectionResult, HeartbeatOutcome, LeadershipState,
};
use axum::{extract::State, routing::post, Json, Router};
use openraft::error::{
    InitializeError, InstallSnapshotError, NetworkError, RPCError, RaftError, Unreachable,
};
use openraft::metrics::RaftMetrics;
use openraft::network::{RPCOption, RaftNetwork, RaftNetworkFactory};
use openraft::raft::{
    AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, InstallSnapshotResponse,
    VoteRequest, VoteResponse,
};
use openraft::storage::Adaptor;
use openraft::{BasicNode, Config, Raft, ServerState};
use openraft_memstore::MemStore;
use reqwest::Client as HttpClient;
use serde::{de::DeserializeOwned, Serialize};

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
            let mut interval = tokio::time::interval(heartbeat_settings.heartbeat_interval);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                tokio::select! {
                    changed = stop_rx_heartbeat.changed() => {
                        if changed.is_ok() && *stop_rx_heartbeat.borrow() {
                            break;
                        }
                        continue;
                    }
                    _ = interval.tick() => {}
                }

                if *stop_rx_heartbeat.borrow() {
                    break;
                }

                let was_leader = *is_leader_for_heartbeat.lock().await;
                if !was_leader {
                    continue;
                }

                let span = info_span!(
                    "coordinator.heartbeat",
                    node = %heartbeat_settings.node_id
                );
                let _enter = span.enter();

                match send_heartbeat(&heartbeat_settings.pool, &heartbeat_settings.node_id).await {
                    Ok(_) => {
                        record_heartbeat_outcome(&heartbeat_settings.node_id, HeartbeatOutcome::Ok);
                    }
                    Err(error) => {
                        warn!(?error, "failed to publish heartbeat");
                        record_heartbeat_outcome(
                            &heartbeat_settings.node_id,
                            HeartbeatOutcome::Error,
                        );
                        let mut guard = is_leader_for_heartbeat.lock().await;
                        let previously_leader = *guard;
                        *guard = false;
                        leader_for_heartbeat.set_leader(false);
                        if previously_leader {
                            record_leadership_transition(
                                &heartbeat_settings.node_id,
                                LeadershipState::Follower,
                            );
                        }
                    }
                }
            }
        });

        let election = tokio::spawn(async move {
            let mut next_attempt = Instant::now();
            loop {
                if *stop_rx_election.borrow() {
                    break;
                }

                let delay_duration = next_attempt
                    .checked_duration_since(Instant::now())
                    .unwrap_or_else(|| Duration::from_millis(0));
                let sleep_fut = tokio::time::sleep(delay_duration);
                tokio::pin!(sleep_fut);
                tokio::select! {
                    changed = stop_rx_election.changed() => {
                        if changed.is_err() || *stop_rx_election.borrow() {
                            break;
                        }
                        continue;
                    }
                    _ = &mut sleep_fut => {}
                }

                if *stop_rx_election.borrow() {
                    break;
                }

                match run_election_round(
                    &election_settings,
                    &leader_for_election,
                    &is_leader_for_election,
                )
                .await
                {
                    Ok(_) => {}
                    Err(error) => {
                        record_election_result(&election_settings.node_id, ElectionResult::Error);
                        warn!(?error, "election round failed");
                    }
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
    let span = info_span!("coordinator.election_round", node = %settings.node_id);
    let _enter = span.enter();

    record_election_attempt(&settings.node_id);

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
    let was_leader = *guard;

    let timeout_chrono = ChronoDuration::from_std(timeout)?;

    if let Some(row) = stale {
        let leader_id: String = row.get("leader_id");
        let heartbeat_at: DateTime<Utc> = row.get("heartbeat_at");
        let term: i64 = row.get("term");

        if leader_id == settings.node_id {
            if now - heartbeat_at > timeout_chrono {
                debug!("heartbeat stale for current leader, attempting refresh");
                takeover(&settings.pool, &settings.node_id, term + 1, true, timeout).await?;
                record_election_result(&settings.node_id, ElectionResult::HeartbeatRefresh);
            } else {
                record_election_result(&settings.node_id, ElectionResult::Retained);
            }
            if !was_leader {
                record_leadership_transition(&settings.node_id, LeadershipState::Leader);
            }
            *guard = true;
            leader_handle.set_leader(true);
            return Ok(());
        }

        if now - heartbeat_at < timeout_chrono {
            record_election_result(&settings.node_id, ElectionResult::PeerHealthy);
            if was_leader {
                record_leadership_transition(&settings.node_id, LeadershipState::Follower);
            }
            *guard = false;
            leader_handle.set_leader(false);
            return Ok(());
        }

        let updated = takeover(&settings.pool, &settings.node_id, term + 1, false, timeout).await?;
        if updated {
            record_election_result(&settings.node_id, ElectionResult::Won);
            if !was_leader {
                record_leadership_transition(&settings.node_id, LeadershipState::Leader);
            }
            *guard = true;
            leader_handle.set_leader(true);
            info!(node = %settings.node_id, term = term + 1, "assumed leadership (stale heartbeat)");
        } else {
            record_election_result(&settings.node_id, ElectionResult::Contended);
            if was_leader {
                record_leadership_transition(&settings.node_id, LeadershipState::Follower);
            }
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
        record_election_result(&settings.node_id, ElectionResult::Initialized);
        if !was_leader {
            record_leadership_transition(&settings.node_id, LeadershipState::Leader);
        }
        *guard = true;
        leader_handle.set_leader(true);
        info!(node = %settings.node_id, term = 1, "initialized raft state as leader");
    } else {
        record_election_result(&settings.node_id, ElectionResult::PeerHealthy);
        if was_leader {
            record_leadership_transition(&settings.node_id, LeadershipState::Follower);
        }
        *guard = false;
        leader_handle.set_leader(false);
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
    let span = info_span!(
        "coordinator.takeover",
        node = %node_id,
        term,
        allow_current,
        timeout_ms = timeout.as_millis() as u64
    );
    let _enter = span.enter();

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

type RaftTypeConfig = openraft_memstore::TypeConfig;
type RaftNodeId = <RaftTypeConfig as openraft::RaftTypeConfig>::NodeId;
type RaftNode = <RaftTypeConfig as openraft::RaftTypeConfig>::Node;
type StandardRpcError = RPCError<RaftNodeId, RaftNode, RaftError<RaftNodeId>>;
type SnapshotRpcError = RPCError<RaftNodeId, RaftNode, RaftError<RaftNodeId, InstallSnapshotError>>;

#[derive(Clone)]
struct PeerConfig {
    address: String,
}

#[derive(Clone)]
struct HttpRaftNetworkFactory {
    client: HttpClient,
    peers: Arc<HashMap<RaftNodeId, PeerConfig>>,
}

impl HttpRaftNetworkFactory {
    fn new(peers: Arc<HashMap<RaftNodeId, PeerConfig>>) -> Self {
        Self {
            client: HttpClient::new(),
            peers,
        }
    }
}

#[derive(Clone)]
struct HttpRaftNetwork {
    client: HttpClient,
    target: RaftNodeId,
    address: Option<String>,
}

impl HttpRaftNetwork {
    async fn send_rpc<Req, Resp, Err>(
        &self,
        path: &str,
        req: Req,
    ) -> Result<Resp, RPCError<RaftNodeId, RaftNode, Err>>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
        Err: std::error::Error + DeserializeOwned,
    {
        let Some(address) = &self.address else {
            let missing = MissingPeer {
                target: self.target,
            };
            return Err(RPCError::Unreachable(Unreachable::new(&missing)));
        };

        let url = format!("{address}/{path}");
        let response = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|error| {
                if error.is_connect() {
                    RPCError::Unreachable(Unreachable::new(&error))
                } else {
                    RPCError::Network(NetworkError::new(&error))
                }
            })?;

        let body: Result<Resp, Err> = response
            .json()
            .await
            .map_err(|error| RPCError::Network(NetworkError::new(&error)))?;

        body.map_err(|error| {
            RPCError::RemoteError(openraft::error::RemoteError::new(self.target, error))
        })
    }
}

impl RaftNetworkFactory<RaftTypeConfig> for HttpRaftNetworkFactory {
    type Network = HttpRaftNetwork;

    async fn new_client(&mut self, target: RaftNodeId, node: &RaftNode) -> Self::Network {
        let address = self
            .peers
            .get(&target)
            .map(|peer| peer.address.clone())
            .or_else(|| match node {
                () => None,
            });

        HttpRaftNetwork {
            client: self.client.clone(),
            target,
            address,
        }
    }
}

impl RaftNetwork<RaftTypeConfig> for HttpRaftNetwork {
    async fn append_entries(
        &mut self,
        rpc: AppendEntriesRequest<RaftTypeConfig>,
        _option: RPCOption,
    ) -> Result<AppendEntriesResponse<RaftNodeId>, StandardRpcError> {
        self.send_rpc("raft-append", rpc).await
    }

    async fn install_snapshot(
        &mut self,
        rpc: InstallSnapshotRequest<RaftTypeConfig>,
        _option: RPCOption,
    ) -> Result<InstallSnapshotResponse<RaftNodeId>, SnapshotRpcError> {
        self.send_rpc("raft-snapshot", rpc).await
    }

    async fn vote(
        &mut self,
        rpc: VoteRequest<RaftNodeId>,
        _option: RPCOption,
    ) -> Result<VoteResponse<RaftNodeId>, StandardRpcError> {
        self.send_rpc("raft-vote", rpc).await
    }
}

#[derive(Clone)]
struct RaftHttpState {
    raft: Arc<Raft<RaftTypeConfig>>,
}

async fn handle_vote(
    State(state): State<RaftHttpState>,
    Json(request): Json<VoteRequest<RaftNodeId>>,
) -> Json<Result<VoteResponse<RaftNodeId>, RaftError<RaftNodeId>>> {
    Json(state.raft.vote(request).await)
}

async fn handle_append(
    State(state): State<RaftHttpState>,
    Json(request): Json<AppendEntriesRequest<RaftTypeConfig>>,
) -> Json<Result<AppendEntriesResponse<RaftNodeId>, RaftError<RaftNodeId>>> {
    Json(state.raft.append_entries(request).await)
}

async fn handle_snapshot(
    State(state): State<RaftHttpState>,
    Json(request): Json<InstallSnapshotRequest<RaftTypeConfig>>,
) -> Json<Result<InstallSnapshotResponse<RaftNodeId>, RaftError<RaftNodeId, InstallSnapshotError>>>
{
    Json(state.raft.install_snapshot(request).await)
}

pub struct RaftSupervisor {
    raft: Arc<Raft<RaftTypeConfig>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: JoinHandle<()>,
    metrics_task: JoinHandle<()>,
    leader: LeaderHandle,
}

impl RaftSupervisor {
    pub async fn start(settings: RaftClusterSettings) -> Result<(Self, LeaderHandle)> {
        if settings.peers.is_empty() {
            anyhow::bail!("KERNEL_RAFT_PEERS must include at least one entry");
        }

        let peers: HashMap<RaftNodeId, PeerConfig> = settings
            .peers
            .iter()
            .map(|(id, node)| {
                (
                    *id,
                    PeerConfig {
                        address: normalize_peer_address(&node.addr),
                    },
                )
            })
            .collect();

        if !peers.contains_key(&settings.node_id) {
            anyhow::bail!(
                "local node id {} missing from KERNEL_RAFT_PEERS",
                settings.node_id
            );
        }

        let config = Config {
            cluster_name: "minoots-kernel".to_string(),
            heartbeat_interval: settings.heartbeat_interval_ms,
            election_timeout_min: settings.election_timeout_min_ms,
            election_timeout_max: settings.election_timeout_max_ms,
            ..Default::default()
        };
        let config = Arc::new(config.validate().context("invalid raft configuration")?);

        let store = MemStore::new_async().await;
        let (log_store, state_machine) = Adaptor::new(store);
        let network = HttpRaftNetworkFactory::new(Arc::new(peers));

        let raft = Arc::new(
            Raft::new(
                settings.node_id,
                config.clone(),
                network,
                log_store,
                state_machine,
            )
            .await
            .context("failed to start raft node")?,
        );

        let http_state = RaftHttpState { raft: raft.clone() };
        let router = Router::new()
            .route("/raft-vote", post(handle_vote))
            .route("/raft-append", post(handle_append))
            .route("/raft-snapshot", post(handle_snapshot))
            .with_state(http_state);

        let listener = tokio::net::TcpListener::bind(settings.rpc_addr)
            .await
            .with_context(|| format!("failed to bind raft RPC address {}", settings.rpc_addr))?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server_task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router.into_make_service())
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
            {
                error!(?error, "raft HTTP server terminated");
            }
        });

        let (leader_tx, _) = watch::channel(false);
        let leader_handle = LeaderHandle::new(leader_tx.clone());
        let metrics_task =
            spawn_metrics_task(raft.clone(), leader_handle.clone(), settings.node_id);

        let members: BTreeSet<RaftNodeId> = settings.peers.keys().copied().collect();
        match raft.initialize(members.clone()).await {
            Ok(_) => info!(node = settings.node_id, members = ?members, "initialized raft cluster"),
            Err(RaftError::APIError(InitializeError::NotAllowed(_))) => {
                info!(node = settings.node_id, "raft cluster already initialized")
            }
            Err(error) => return Err(error.into()),
        }

        let supervisor = Self {
            raft,
            shutdown_tx: Some(shutdown_tx),
            server_task,
            metrics_task,
            leader: leader_handle.clone(),
        };

        Ok((supervisor, leader_handle))
    }

    pub async fn shutdown(mut self) -> Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        self.leader.set_leader(false);

        if let Err(error) = self.raft.shutdown().await {
            warn!(?error, "raft shutdown encountered error");
        }

        self.metrics_task.abort();
        let _ = self.metrics_task.await;

        self.server_task.abort();
        if let Err(error) = self.server_task.await {
            if !error.is_cancelled() {
                warn!(?error, "raft HTTP server join failed");
            }
        }

        Ok(())
    }
}

fn spawn_metrics_task(
    raft: Arc<Raft<RaftTypeConfig>>,
    leader: LeaderHandle,
    node_id: RaftNodeId,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut metrics = raft.metrics();
        let mut last_leader = false;
        loop {
            if metrics.changed().await.is_err() {
                leader.set_leader(false);
                break;
            }

            let snapshot: RaftMetrics<RaftNodeId, RaftNode> = metrics.borrow().clone();
            let is_leader = snapshot.current_leader == Some(node_id)
                && matches!(snapshot.state, ServerState::Leader);
            if is_leader != last_leader {
                record_leadership_transition(
                    &format!("raft-{node_id}"),
                    if is_leader {
                        LeadershipState::Leader
                    } else {
                        LeadershipState::Follower
                    },
                );
                leader.set_leader(is_leader);
                last_leader = is_leader;
            }
        }
    })
}

fn normalize_peer_address(addr: &str) -> String {
    if addr.starts_with("http://") || addr.starts_with("https://") {
        addr.to_string()
    } else {
        format!("http://{addr}")
    }
}

#[derive(Debug)]
struct MissingPeer {
    target: RaftNodeId,
}

impl fmt::Display for MissingPeer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "missing raft peer configuration for node {}",
            self.target
        )
    }
}

impl std::error::Error for MissingPeer {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::postgres::init_test_pool;
    use std::net::TcpListener;
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

    fn reserve_local_address() -> SocketAddr {
        TcpListener::bind("127.0.0.1:0")
            .expect("bind test listener")
            .local_addr()
            .expect("listener local addr")
    }

    fn make_peer(addr: SocketAddr) -> BasicNode {
        BasicNode {
            addr: format!("{}:{}", addr.ip(), addr.port()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn raft_supervisor_elects_single_leader() {
        let addr = reserve_local_address();
        let peers = HashMap::from([(1_u64, make_peer(addr))]);

        let (supervisor, handle) = RaftSupervisor::start(RaftClusterSettings {
            node_id: 1,
            rpc_addr: addr,
            peers,
            election_timeout_min_ms: 200,
            election_timeout_max_ms: 400,
            heartbeat_interval_ms: 100,
        })
        .await
        .expect("start raft supervisor");

        let leader_elected =
            wait_for_condition(Duration::from_secs(5), || handle.is_leader()).await;
        assert!(leader_elected, "raft supervisor never reported leadership");

        supervisor
            .shutdown()
            .await
            .expect("shutdown raft supervisor");
    }

    #[tokio::test]
    async fn raft_supervisor_promotes_follower_on_failover() {
        let addr_a = reserve_local_address();
        let addr_b = reserve_local_address();
        let addr_c = reserve_local_address();
        let peers = HashMap::from([
            (1_u64, make_peer(addr_a)),
            (2_u64, make_peer(addr_b)),
            (3_u64, make_peer(addr_c)),
        ]);

        let (supervisor_a, handle_a) = RaftSupervisor::start(RaftClusterSettings {
            node_id: 1,
            rpc_addr: addr_a,
            peers: peers.clone(),
            election_timeout_min_ms: 200,
            election_timeout_max_ms: 400,
            heartbeat_interval_ms: 100,
        })
        .await
        .expect("start raft node a");

        let (supervisor_b, handle_b) = RaftSupervisor::start(RaftClusterSettings {
            node_id: 2,
            rpc_addr: addr_b,
            peers: peers.clone(),
            election_timeout_min_ms: 200,
            election_timeout_max_ms: 400,
            heartbeat_interval_ms: 100,
        })
        .await
        .expect("start raft node b");

        let (supervisor_c, handle_c) = RaftSupervisor::start(RaftClusterSettings {
            node_id: 3,
            rpc_addr: addr_c,
            peers,
            election_timeout_min_ms: 200,
            election_timeout_max_ms: 400,
            heartbeat_interval_ms: 100,
        })
        .await
        .expect("start raft node c");

        let mut nodes = vec![
            (1_u64, supervisor_a, handle_a),
            (2_u64, supervisor_b, handle_b),
            (3_u64, supervisor_c, handle_c),
        ];

        let leader_ready = wait_for_condition(Duration::from_secs(8), || {
            nodes.iter().any(|(_, _, handle)| handle.is_leader())
        })
        .await;
        assert!(leader_ready, "no raft leader elected within timeout");

        let leader_index = nodes
            .iter()
            .position(|(_, _, handle)| handle.is_leader())
            .expect("leader handle never flipped to true");

        let (_leader_id, leader_sup, leader_handle) = nodes.swap_remove(leader_index);

        leader_sup
            .shutdown()
            .await
            .expect("shutdown leader supervisor");

        let failover = wait_for_condition(Duration::from_secs(8), || {
            nodes.iter().any(|(_, _, handle)| handle.is_leader())
        })
        .await;
        assert!(failover, "no follower assumed leadership after failover");

        let new_leader_index = nodes
            .iter()
            .position(|(_, _, handle)| handle.is_leader())
            .expect("expected follower to assume leadership");

        let (_new_leader_id, new_leader_sup, new_leader_handle) =
            nodes.swap_remove(new_leader_index);

        new_leader_sup
            .shutdown()
            .await
            .expect("shutdown new leader supervisor");

        let new_leader_cleared =
            wait_for_condition(Duration::from_secs(2), || !new_leader_handle.is_leader()).await;
        assert!(
            new_leader_cleared,
            "new leader handle remained true after shutdown"
        );

        let original_leader_cleared =
            wait_for_condition(Duration::from_secs(2), || !leader_handle.is_leader()).await;
        assert!(
            original_leader_cleared,
            "old leader handle still marked leader"
        );

        for (_node_id, follower_sup, follower_handle) in nodes {
            follower_sup
                .shutdown()
                .await
                .expect("shutdown remaining follower");

            let follower_cleared =
                wait_for_condition(Duration::from_secs(2), || !follower_handle.is_leader()).await;
            assert!(
                follower_cleared,
                "follower handle remained true after shutdown"
            );
        }
    }
}
