use std::fmt::Debug;
use std::io::Cursor;
use std::ops::RangeBounds;
use std::sync::Arc;

use anyhow::anyhow;
use openraft::storage::{RaftLogReader, RaftStorage};
use openraft::{
    Entry, LogId, OptionalSend, RaftLogId, Snapshot, SnapshotMeta, StorageError, StorageIOError,
    StoredMembership, Vote,
};
use openraft_memstore::{MemStore, MemStoreStateMachine, TypeConfig as MemStoreConfig};
use serde_json::Value;
use sqlx::{Executor, Pool, Postgres, Row};
use tracing::{debug, info_span};
use uuid::Uuid;

const METADATA_KEY: bool = true;

#[derive(Clone)]
pub struct PostgresBackedStore {
    inner: Arc<MemStore>,
    pool: Option<Pool<Postgres>>,
}

impl PostgresBackedStore {
    pub async fn new(pool: Pool<Postgres>) -> anyhow::Result<Self> {
        let inner = MemStore::new_async().await;
        let store = Self {
            inner,
            pool: Some(pool),
        };
        store.bootstrap().await?;
        Ok(store)
    }

    pub async fn in_memory() -> Self {
        Self {
            inner: MemStore::new_async().await,
            pool: None,
        }
    }

    pub fn inner(&self) -> Arc<MemStore> {
        self.inner.clone()
    }

    async fn bootstrap(&self) -> anyhow::Result<()> {
        let span = info_span!("horology.kernel.raft.bootstrap");
        let _guard = span.enter();
        let Some(pool) = &self.pool else {
            debug!("no pool configured; skipping postgres bootstrap");
            return Ok(());
        };

        let entries =
            sqlx::query("SELECT log_index, entry FROM kernel_raft_log ORDER BY log_index ASC")
                .fetch_all(pool)
                .await?;

        if !entries.is_empty() {
            debug!(count = entries.len(), "restoring raft log from postgres");
            let mut parsed = Vec::with_capacity(entries.len());
            for row in entries {
                let value: Value = row.try_get::<Value, _>("entry")?;
                let entry: Entry<MemStoreConfig> = serde_json::from_value(value)
                    .map_err(|error| anyhow!("failed to decode raft log entry: {error}"))?;
                parsed.push(entry);
            }
            let mut inner = self.inner.clone();
            inner
                .append_to_log(parsed)
                .await
                .map_err(|error| anyhow!("failed to seed raft log from postgres: {error}"))?;
        }

        if let Some(row) = sqlx::query(
            "SELECT vote, committed, last_purged_log, state_machine, snapshot_meta FROM kernel_raft_metadata WHERE id = $1",
        )
        .bind(METADATA_KEY)
        .fetch_optional(pool)
        .await? {
            if let Some(vote_json) = row.try_get::<Option<Value>, _>("vote")? {
                let vote: Vote<u64> = serde_json::from_value(vote_json)
                    .map_err(|error| anyhow!("failed to decode stored vote: {error}"))?;
                let mut inner = self.inner.clone();
                inner
                    .save_vote(&vote)
                    .await
                    .map_err(|error| anyhow!("failed to restore vote: {error}"))?;
                debug!(?vote, "restored vote from postgres");
            }

            if let Some(committed_json) = row.try_get::<Option<Value>, _>("committed")? {
                let committed: Option<LogId<u64>> = serde_json::from_value(committed_json)
                    .map_err(|error| anyhow!("failed to decode committed log id: {error}"))?;
                let mut inner = self.inner.clone();
                inner
                    .save_committed(committed)
                    .await
                    .map_err(|error| anyhow!("failed to restore committed log id: {error}"))?;
                debug!(?committed, "restored committed log id from postgres");
            }

            if let Some(last_purged_json) = row.try_get::<Option<Value>, _>("last_purged_log")? {
                if let Some(log_id) = serde_json::from_value::<Option<LogId<u64>>>(last_purged_json)
                    .map_err(|error| anyhow!("failed to decode last purged log id: {error}"))?
                {
                    let mut inner = self.inner.clone();
                    inner
                        .purge_logs_upto(log_id)
                        .await
                        .map_err(|error| anyhow!("failed to restore purged log state: {error}"))?;
                    debug!(?log_id, "restored purge watermark from postgres");
                }
            }

            let snapshot_meta = row
                .try_get::<Option<Value>, _>("snapshot_meta")?
                .map(|value| serde_json::from_value::<SnapshotMeta<u64, ()>>(value))
                .transpose()
                .map_err(|error| anyhow!("failed to decode snapshot metadata: {error}"))?;

            if let Some(state_machine_json) = row.try_get::<Option<Value>, _>("state_machine")? {
                let state_machine: MemStoreStateMachine = serde_json::from_value(state_machine_json)
                    .map_err(|error| anyhow!("failed to decode stored state machine: {error}"))?;
                self.restore_state_machine(state_machine, snapshot_meta).await?;
                debug!("restored state machine snapshot from postgres");
            }
        }

        Ok(())
    }

    async fn restore_state_machine(
        &self,
        sm: MemStoreStateMachine,
        meta: Option<SnapshotMeta<u64, ()>>,
    ) -> anyhow::Result<()> {
        let has_meta = meta.is_some();
        let span = info_span!(
            "horology.kernel.raft.restore_state_machine",
            has_meta,
            last_applied = sm.last_applied_log.map(|log| log.index)
        );
        let _guard = span.enter();
        let meta = meta.unwrap_or_else(|| SnapshotMeta {
            last_log_id: sm.last_applied_log,
            last_membership: sm.last_membership.clone(),
            snapshot_id: format!("postgres-restore-{}", Uuid::new_v4()),
        });

        let data = serde_json::to_vec(&sm)?;
        let mut inner = self.inner.clone();
        inner
            .install_snapshot(&meta, Box::new(Cursor::new(data)))
            .await
            .map_err(|error| anyhow!("failed to apply stored state machine snapshot: {error}"))?;
        debug!(snapshot_id = %meta.snapshot_id, "applied state machine snapshot from postgres");
        Ok(())
    }

    fn vote_error(error: &sqlx::Error) -> StorageError<u64> {
        StorageError::IO {
            source: StorageIOError::write_vote(error),
        }
    }

    fn logs_error(error: &sqlx::Error) -> StorageError<u64> {
        StorageError::IO {
            source: StorageIOError::write_logs(error),
        }
    }

    fn log_entry_error(log_id: LogId<u64>, error: &sqlx::Error) -> StorageError<u64> {
        StorageError::IO {
            source: StorageIOError::write_log_entry(log_id, error),
        }
    }

    fn state_error(error: &sqlx::Error) -> StorageError<u64> {
        StorageError::IO {
            source: StorageIOError::write_state_machine(error),
        }
    }

    async fn persist_vote(&self, vote: &Vote<u64>) -> Result<(), StorageError<u64>> {
        let span = info_span!("horology.kernel.raft.persist_vote", has_pool = %self.pool.is_some());
        let _guard = span.enter();
        if self.pool.is_none() {
            debug!("no pool configured; skipping vote persistence");
            return Ok(());
        }
        let value = serde_json::to_value(vote).map_err(|error| StorageError::IO {
            source: StorageIOError::write_vote(&error),
        })?;
        sqlx::query(
            "INSERT INTO kernel_raft_metadata (id, vote) VALUES ($1, $2)\n             ON CONFLICT (id) DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()",
        )
        .bind(METADATA_KEY)
        .bind(value)
        .execute(self.pool.as_ref().unwrap())
        .await
        .map(|result| {
            debug!(rows = result.rows_affected(), vote = ?vote, "persisted raft vote");
            ()
        })
        .map_err(|error| Self::vote_error(&error))
    }

    async fn persist_committed(
        &self,
        committed: Option<LogId<u64>>,
    ) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.persist_committed",
            has_pool = %self.pool.is_some(),
            committed_index = committed.map(|log| log.index)
        );
        let _guard = span.enter();
        if self.pool.is_none() {
            debug!("no pool configured; skipping committed watermark persistence");
            return Ok(());
        }
        let value = serde_json::to_value(committed).map_err(|error| StorageError::IO {
            source: StorageIOError::write_logs(&error),
        })?;
        sqlx::query(
            "INSERT INTO kernel_raft_metadata (id, committed) VALUES ($1, $2)\n             ON CONFLICT (id) DO UPDATE SET committed = EXCLUDED.committed, updated_at = NOW()",
        )
        .bind(METADATA_KEY)
        .bind(value)
        .execute(self.pool.as_ref().unwrap())
        .await
        .map(|result| {
            debug!(rows = result.rows_affected(), "persisted committed watermark");
            ()
        })
        .map_err(|error| Self::logs_error(&error))
    }

    async fn persist_last_purged(
        &self,
        log_id: Option<LogId<u64>>,
    ) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.persist_last_purged",
            has_pool = %self.pool.is_some(),
            purged_index = log_id.map(|log| log.index)
        );
        let _guard = span.enter();
        if self.pool.is_none() {
            debug!("no pool configured; skipping purge watermark persistence");
            return Ok(());
        }
        let value = serde_json::to_value(log_id).map_err(|error| StorageError::IO {
            source: StorageIOError::write_logs(&error),
        })?;
        sqlx::query(
            "INSERT INTO kernel_raft_metadata (id, last_purged_log) VALUES ($1, $2)\n             ON CONFLICT (id) DO UPDATE SET last_purged_log = EXCLUDED.last_purged_log, updated_at = NOW()",
        )
        .bind(METADATA_KEY)
        .bind(value)
        .execute(self.pool.as_ref().unwrap())
        .await
        .map(|result| {
            debug!(rows = result.rows_affected(), "persisted purge watermark");
            ()
        })
        .map_err(|error| Self::logs_error(&error))
    }

    async fn persist_log_entries(
        &self,
        entries: &[Entry<MemStoreConfig>],
    ) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.persist_log_entries",
            has_pool = %self.pool.is_some(),
            entry_count = entries.len()
        );
        let _guard = span.enter();
        let Some(pool) = &self.pool else {
            debug!("no pool configured; skipping log persistence");
            return Ok(());
        };
        if entries.is_empty() {
            debug!("no log entries to persist");
            return Ok(());
        }
        let mut tx = pool
            .begin()
            .await
            .map_err(|error| Self::logs_error(&error))?;

        for entry in entries {
            let log_id = *entry.get_log_id();
            let index: i64 = entry.log_id.index.try_into().map_err(|_| {
                let msg = format!("raft log index overflow: {}", entry.log_id.index);
                let io_error = std::io::Error::new(std::io::ErrorKind::Other, msg);
                StorageError::IO {
                    source: StorageIOError::write_log_entry(log_id, &io_error),
                }
            })?;
            let value = serde_json::to_value(entry).map_err(|error| StorageError::IO {
                source: StorageIOError::write_log_entry(log_id, &error),
            })?;
            tx.execute(
                sqlx::query(
                    "INSERT INTO kernel_raft_log (log_index, entry) VALUES ($1, $2)\n                 ON CONFLICT (log_index) DO UPDATE SET entry = EXCLUDED.entry, updated_at = NOW()",
                )
                .bind(index)
                .bind(value),
            )
            .await
            .map(|result| {
                debug!(rows = result.rows_affected(), index = log_id.index, "upserted raft log entry");
                ()
            })
            .map_err(|error| Self::log_entry_error(log_id, &error))?;
        }

        tx.commit()
            .await
            .map(|_| {
                debug!("committed raft log batch");
            })
            .map_err(|error| Self::logs_error(&error))
    }

    async fn delete_log_entries_since(&self, index: u64) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.delete_log_entries_since",
            has_pool = %self.pool.is_some(),
            start_index = index
        );
        let _guard = span.enter();
        let Some(pool) = &self.pool else {
            debug!("no pool configured; skipping conflicting log deletion");
            return Ok(());
        };
        let index_i64: i64 = index.try_into().map_err(|_| {
            let msg = format!("raft log index overflow: {index}");
            let io_error = std::io::Error::new(std::io::ErrorKind::Other, msg);
            StorageError::IO {
                source: StorageIOError::write_logs(&io_error),
            }
        })?;
        sqlx::query("DELETE FROM kernel_raft_log WHERE log_index >= $1")
            .bind(index_i64)
            .execute(pool)
            .await
            .map(|result| {
                debug!(
                    rows = result.rows_affected(),
                    "deleted conflicting raft log entries"
                );
                ()
            })
            .map_err(|error| Self::logs_error(&error))
    }

    async fn purge_log_entries_upto(&self, index: u64) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.purge_log_entries",
            has_pool = %self.pool.is_some(),
            end_index = index
        );
        let _guard = span.enter();
        let Some(pool) = &self.pool else {
            debug!("no pool configured; skipping log purge");
            return Ok(());
        };
        let index_i64: i64 = index.try_into().map_err(|_| {
            let msg = format!("raft log index overflow: {index}");
            let io_error = std::io::Error::new(std::io::ErrorKind::Other, msg);
            StorageError::IO {
                source: StorageIOError::write_logs(&io_error),
            }
        })?;
        sqlx::query("DELETE FROM kernel_raft_log WHERE log_index <= $1")
            .bind(index_i64)
            .execute(pool)
            .await
            .map(|result| {
                debug!(rows = result.rows_affected(), "purged raft log entries");
                ()
            })
            .map_err(|error| Self::logs_error(&error))
    }

    async fn persist_state_machine(
        &self,
        explicit_meta: Option<SnapshotMeta<u64, ()>>,
    ) -> Result<(), StorageError<u64>> {
        let span = info_span!(
            "horology.kernel.raft.persist_state_machine",
            has_pool = %self.pool.is_some(),
            has_explicit_meta = explicit_meta.is_some()
        );
        let _guard = span.enter();
        if self.pool.is_none() {
            debug!("no pool configured; skipping state machine persistence");
            return Ok(());
        }
        let sm = self.inner.get_state_machine().await;
        let meta = explicit_meta.unwrap_or_else(|| SnapshotMeta {
            last_log_id: sm.last_applied_log,
            last_membership: sm.last_membership.clone(),
            snapshot_id: format!("state-{}", Uuid::new_v4()),
        });

        let state_json = serde_json::to_value(&sm).map_err(|error| StorageError::IO {
            source: StorageIOError::write_state_machine(&error),
        })?;
        let meta_json = serde_json::to_value(&meta).map_err(|error| StorageError::IO {
            source: StorageIOError::write_snapshot(Some(meta.signature()), &error),
        })?;

        sqlx::query(
            "INSERT INTO kernel_raft_metadata (id, state_machine, snapshot_meta) VALUES ($1, $2, $3)\n             ON CONFLICT (id) DO UPDATE SET state_machine = EXCLUDED.state_machine, snapshot_meta = EXCLUDED.snapshot_meta, updated_at = NOW()",
        )
        .bind(METADATA_KEY)
        .bind(state_json)
        .bind(meta_json)
        .execute(self.pool.as_ref().unwrap())
        .await
        .map(|result| {
            debug!(rows = result.rows_affected(), "persisted state machine snapshot");
            ()
        })
        .map_err(|error| Self::state_error(&error))
    }
}

impl RaftLogReader<MemStoreConfig> for PostgresBackedStore {
    async fn try_get_log_entries<RB: RangeBounds<u64> + Clone + Debug + OptionalSend>(
        &mut self,
        range: RB,
    ) -> Result<Vec<Entry<MemStoreConfig>>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.try_get_log_entries(range).await
    }
}

impl RaftStorage<MemStoreConfig> for PostgresBackedStore {
    type LogReader = Arc<MemStore>;
    type SnapshotBuilder = Arc<MemStore>;

    async fn save_vote(&mut self, vote: &Vote<u64>) -> Result<(), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.save_vote(vote).await?;
        self.persist_vote(vote).await
    }

    async fn read_vote(&mut self) -> Result<Option<Vote<u64>>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.read_vote().await
    }

    async fn save_committed(
        &mut self,
        committed: Option<LogId<u64>>,
    ) -> Result<(), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.save_committed(committed).await?;
        self.persist_committed(committed).await
    }

    async fn read_committed(&mut self) -> Result<Option<LogId<u64>>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.read_committed().await
    }

    async fn get_log_state(
        &mut self,
    ) -> Result<openraft::storage::LogState<MemStoreConfig>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.get_log_state().await
    }

    async fn get_log_reader(&mut self) -> Self::LogReader {
        self.inner.clone()
    }

    async fn append_to_log<I>(&mut self, entries: I) -> Result<(), StorageError<u64>>
    where
        I: IntoIterator<Item = Entry<MemStoreConfig>> + OptionalSend,
    {
        let collected: Vec<_> = entries.into_iter().collect();
        if collected.is_empty() {
            return Ok(());
        }

        let mut inner = self.inner.clone();
        inner.append_to_log(collected.clone()).await?;
        self.persist_log_entries(&collected).await
    }

    async fn delete_conflict_logs_since(
        &mut self,
        log_id: LogId<u64>,
    ) -> Result<(), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.delete_conflict_logs_since(log_id).await?;
        self.delete_log_entries_since(log_id.index).await
    }

    async fn purge_logs_upto(&mut self, log_id: LogId<u64>) -> Result<(), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.purge_logs_upto(log_id).await?;
        self.purge_log_entries_upto(log_id.index).await?;
        self.persist_last_purged(Some(log_id)).await
    }

    async fn last_applied_state(
        &mut self,
    ) -> Result<(Option<LogId<u64>>, StoredMembership<u64, ()>), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.last_applied_state().await
    }

    async fn apply_to_state_machine(
        &mut self,
        entries: &[Entry<MemStoreConfig>],
    ) -> Result<Vec<<MemStoreConfig as openraft::RaftTypeConfig>::R>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        let response = inner.apply_to_state_machine(entries).await?;
        self.persist_state_machine(None).await?;
        Ok(response)
    }

    async fn get_snapshot_builder(&mut self) -> Self::SnapshotBuilder {
        self.inner.clone()
    }

    async fn begin_receiving_snapshot(
        &mut self,
    ) -> Result<Box<<MemStoreConfig as openraft::RaftTypeConfig>::SnapshotData>, StorageError<u64>>
    {
        let mut inner = self.inner.clone();
        inner.begin_receiving_snapshot().await
    }

    async fn install_snapshot(
        &mut self,
        meta: &SnapshotMeta<u64, ()>,
        snapshot: Box<<MemStoreConfig as openraft::RaftTypeConfig>::SnapshotData>,
    ) -> Result<(), StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.install_snapshot(meta, snapshot).await?;
        self.persist_state_machine(Some(meta.clone())).await
    }

    async fn get_current_snapshot(
        &mut self,
    ) -> Result<Option<Snapshot<MemStoreConfig>>, StorageError<u64>> {
        let mut inner = self.inner.clone();
        inner.get_current_snapshot().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::postgres::init_test_pool;
    use openraft::CommittedLeaderId;
    use openraft::EntryPayload;
    use tokio::time::Duration;

    async fn truncate_tables(pool: &Pool<Postgres>) {
        let mut tx = pool.begin().await.expect("begin truncate tx");
        tx.execute(sqlx::query("TRUNCATE kernel_raft_log RESTART IDENTITY"))
            .await
            .expect("truncate log");
        tx.execute(sqlx::query(
            "TRUNCATE kernel_raft_metadata RESTART IDENTITY",
        ))
        .await
        .expect("truncate metadata");
        tx.commit().await.expect("commit truncate tx");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn restores_vote_logs_and_state_machine() {
        let pool = match init_test_pool().await {
            Some(pool) => pool,
            None => {
                eprintln!("skipping postgres raft store test; TEST_DATABASE_URL not set");
                return;
            }
        };

        truncate_tables(&pool).await;

        let mut store = PostgresBackedStore::new(pool.clone())
            .await
            .expect("initialize store");

        let vote = Vote::new_committed(3, 1);
        store.save_vote(&vote).await.expect("persist vote");

        let leader = CommittedLeaderId::new(3, 1);
        let log_id = LogId::new(leader, 1);
        let entry = Entry {
            log_id,
            payload: EntryPayload::Blank,
        };

        store
            .append_to_log(vec![entry.clone()])
            .await
            .expect("append entry");
        store
            .save_committed(Some(log_id))
            .await
            .expect("save committed");
        store
            .apply_to_state_machine(&[entry.clone()])
            .await
            .expect("apply state machine");

        drop(store);

        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut restored = PostgresBackedStore::new(pool.clone())
            .await
            .expect("restore store from postgres");

        let restored_vote = restored.read_vote().await.expect("read vote");
        assert_eq!(restored_vote, Some(vote));

        let log_state = restored.get_log_state().await.expect("log state");
        assert_eq!(log_state.last_log_id, Some(log_id));

        let (applied, _membership) = restored.last_applied_state().await.expect("applied state");
        assert_eq!(applied, Some(log_id));

        let committed = restored.read_committed().await.expect("read committed");
        assert_eq!(committed, Some(log_id));
    }
}
