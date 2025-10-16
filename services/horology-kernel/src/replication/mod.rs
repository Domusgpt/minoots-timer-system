use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rand::{thread_rng, Rng};
use sqlx::{Pool, Postgres, Row};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};
use tracing::{debug, info, info_span, warn};

use crate::leadership::LeaderHandle;
use crate::telemetry::replication::{
    record_election_attempt, record_election_result, record_heartbeat_outcome,
    record_leadership_transition, ElectionResult, HeartbeatOutcome, LeadershipState,
};
use openraft::BasicNode;

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

pub struct RaftSupervisor;

impl RaftSupervisor {
    pub async fn start(_settings: RaftClusterSettings) -> Result<(Self, LeaderHandle)> {
        anyhow::bail!(
            "OpenRaft supervisor wiring is pending; unset KERNEL_RAFT_NODE_ID to use the Postgres coordinator",
        );
    }

    pub async fn shutdown(self) -> Result<()> {
        Ok(())
    }
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
