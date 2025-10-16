use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use sqlx::{pool::PoolConnection, Pool, Postgres};
use tokio::sync::watch;
use tokio::{select, time::Duration};

#[derive(Clone)]
pub struct LeaderHandle {
    inner: Arc<LeaderInner>,
}

struct LeaderInner {
    is_leader: AtomicBool,
    shutdown: Mutex<Option<watch::Sender<bool>>>,
}

impl LeaderHandle {
    pub(crate) fn new(sender: watch::Sender<bool>) -> Self {
        Self {
            inner: Arc::new(LeaderInner {
                is_leader: AtomicBool::new(false),
                shutdown: Mutex::new(Some(sender)),
            }),
        }
    }

    pub fn is_leader(&self) -> bool {
        self.inner.is_leader.load(Ordering::SeqCst)
    }

    pub(crate) fn set_leader(&self, value: bool) {
        self.inner.is_leader.store(value, Ordering::SeqCst);
    }
}

impl Drop for LeaderHandle {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.inner.shutdown.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(true);
            }
        }
        self.inner.is_leader.store(false, Ordering::SeqCst);
    }
}

pub struct PostgresLeaderElector {
    pool: Pool<Postgres>,
    advisory_key: i64,
    refresh_interval: Duration,
}

impl PostgresLeaderElector {
    pub fn new(pool: Pool<Postgres>, advisory_key: i64, refresh_interval: Duration) -> Self {
        Self {
            pool,
            advisory_key,
            refresh_interval,
        }
    }

    pub async fn start(self) -> Result<LeaderHandle> {
        let (sender, mut receiver) = watch::channel(false);
        let handle = LeaderHandle::new(sender.clone());
        let pool = self.pool.clone();
        let key = self.advisory_key;
        let interval = self.refresh_interval;
        let leader_clone = handle.clone();

        tokio::spawn(async move {
            let mut held_connection: Option<PoolConnection<Postgres>> = None;
            loop {
                if *receiver.borrow() {
                    break;
                }

                if held_connection.is_none() {
                    match pool.acquire().await {
                        Ok(mut conn) => {
                            match sqlx::query_scalar::<_, bool>("SELECT pg_try_advisory_lock($1)")
                                .bind(key)
                                .fetch_one(conn.as_mut())
                                .await
                            {
                                Ok(true) => {
                                    leader_clone.set_leader(true);
                                    held_connection = Some(conn);
                                }
                                Ok(false) => {
                                    leader_clone.set_leader(false);
                                }
                                Err(error) => {
                                    tracing::error!(?error, "leader election lock attempt failed");
                                }
                            }
                        }
                        Err(error) => {
                            tracing::error!(
                                ?error,
                                "failed to acquire postgres connection for leadership"
                            );
                        }
                    }
                } else {
                    // keep lock alive
                    if let Some(conn) = held_connection.as_mut() {
                        if let Err(error) = sqlx::query("SELECT 1").execute(conn.as_mut()).await {
                            tracing::warn!(?error, "leader lock heartbeat failed; releasing lock");
                            held_connection = None;
                            leader_clone.set_leader(false);
                        }
                    }
                }

                select! {
                    _ = tokio::time::sleep(interval) => {}
                    changed = receiver.changed() => {
                        if changed.is_ok() && *receiver.borrow() {
                            break;
                        }
                    }
                }
            }

            if let Some(mut conn) = held_connection {
                if let Err(error) = sqlx::query("SELECT pg_advisory_unlock($1)")
                    .bind(key)
                    .execute(conn.as_mut())
                    .await
                {
                    tracing::error!(?error, "failed to release advisory lock on shutdown");
                }
            }
            leader_clone.set_leader(false);
        });

        Ok(handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::postgres::init_test_pool;
    use tokio::time::{sleep, Duration};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn elects_single_leader_and_fails_over() {
        let Some(pool) = init_test_pool().await else {
            eprintln!("[leadership-tests] skipping — DATABASE_URL not configured");
            return;
        };

        let elector_one =
            PostgresLeaderElector::new(pool.clone(), 9_001, Duration::from_millis(100));
        let elector_two =
            PostgresLeaderElector::new(pool.clone(), 9_001, Duration::from_millis(100));

        let leader_one = elector_one.start().await.expect("leader one should start");
        let leader_two = elector_two.start().await.expect("leader two should start");

        let mut attempts = 0;
        while attempts < 20 && !leader_one.is_leader() && !leader_two.is_leader() {
            sleep(Duration::from_millis(50)).await;
            attempts += 1;
        }

        assert!(
            leader_one.is_leader() || leader_two.is_leader(),
            "no leader elected"
        );
        assert!(
            !(leader_one.is_leader() && leader_two.is_leader()),
            "both leader handles reported leadership simultaneously",
        );

        drop(leader_one);
        sleep(Duration::from_millis(250)).await;

        let mut takeover_attempts = 0;
        while takeover_attempts < 20 && !leader_two.is_leader() {
            sleep(Duration::from_millis(50)).await;
            takeover_attempts += 1;
        }

        assert!(
            leader_two.is_leader(),
            "second leader should assume leadership after failover"
        );
    }
}
