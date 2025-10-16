use anyhow::{Context, Result};
use async_trait::async_trait;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres, Row};
use tracing::info;

use crate::{TimerInstance, TimerStatus};

use super::{
    command_log::{CommandLog, CommandRecord},
    TimerStore,
};

#[derive(Clone)]
pub struct PostgresTimerStore {
    pool: Pool<Postgres>,
}

impl PostgresTimerStore {
    pub async fn connect(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(
                std::env::var("PGPOOL_MAX")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(10),
            )
            .connect(database_url)
            .await
            .with_context(|| "failed to connect to postgres for timer store")?;
        info!("connected to postgres for timer store");
        Ok(Self { pool })
    }

    pub fn pool(&self) -> Pool<Postgres> {
        self.pool.clone()
    }
}

#[async_trait]
impl TimerStore for PostgresTimerStore {
    async fn load_active(&self) -> Result<Vec<TimerInstance>> {
        let rows = sqlx::query(
            "SELECT * FROM timer_records WHERE status = 'scheduled' OR status = 'armed'",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut timers = Vec::with_capacity(rows.len());
        for row in rows {
            let status: String = row.try_get("status")?;
            let metadata: Option<serde_json::Value> = row.try_get("metadata")?;
            let labels_value: Option<serde_json::Value> = row.try_get("labels")?;
            let labels = labels_value
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_default();
            let timer = TimerInstance {
                id: row.try_get("id")?,
                tenant_id: row.try_get("tenant_id")?,
                requested_by: row.try_get("requested_by")?,
                name: row.try_get("name")?,
                duration_ms: row.try_get::<i64, _>("duration_ms")? as u64,
                created_at: row.try_get("created_at")?,
                fire_at: row.try_get("fire_at")?,
                status: TimerStatus::from_str(&status)
                    .ok_or_else(|| anyhow::anyhow!("unsupported timer status {status}"))?,
                metadata,
                labels,
                action_bundle: row.try_get("action_bundle")?,
                agent_binding: row.try_get("agent_binding")?,
                fired_at: row.try_get("fired_at")?,
                cancelled_at: row.try_get("cancelled_at")?,
                cancel_reason: row.try_get("cancel_reason")?,
                cancelled_by: row.try_get("cancelled_by")?,
                settled_at: row.try_get("settled_at")?,
                failure_reason: row.try_get("failure_reason")?,
                state_version: row.try_get::<i64, _>("state_version")?,
            };
            timers.push(timer);
        }
        Ok(timers)
    }

    async fn upsert(&self, timer: &TimerInstance) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO timer_records (
                tenant_id, id, requested_by, name, duration_ms, created_at, fire_at, status,
                metadata, labels, action_bundle, agent_binding, fired_at, cancelled_at, cancel_reason, cancelled_by,
                settled_at, failure_reason, state_version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19
            )
            ON CONFLICT (tenant_id, id) DO UPDATE SET
                requested_by = EXCLUDED.requested_by,
                name = EXCLUDED.name,
                duration_ms = EXCLUDED.duration_ms,
                created_at = EXCLUDED.created_at,
                fire_at = EXCLUDED.fire_at,
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata,
                labels = EXCLUDED.labels,
                action_bundle = EXCLUDED.action_bundle,
                agent_binding = EXCLUDED.agent_binding,
                fired_at = EXCLUDED.fired_at,
                cancelled_at = EXCLUDED.cancelled_at,
                cancel_reason = EXCLUDED.cancel_reason,
                cancelled_by = EXCLUDED.cancelled_by,
                settled_at = EXCLUDED.settled_at,
                failure_reason = EXCLUDED.failure_reason,
                state_version = EXCLUDED.state_version
            "#,
        )
        .bind(&timer.tenant_id)
        .bind(timer.id)
        .bind(&timer.requested_by)
        .bind(&timer.name)
        .bind(timer.duration_ms as i64)
        .bind(timer.created_at)
        .bind(timer.fire_at)
        .bind(timer.status.as_str())
        .bind(timer.metadata.clone())
        .bind(serde_json::to_value(&timer.labels)?)
        .bind(timer.action_bundle.clone())
        .bind(timer.agent_binding.clone())
        .bind(timer.fired_at)
        .bind(timer.cancelled_at)
        .bind(timer.cancel_reason.clone())
        .bind(timer.cancelled_by.clone())
        .bind(timer.settled_at)
        .bind(timer.failure_reason.clone())
        .bind(timer.state_version)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct PostgresCommandLog {
    pool: Pool<Postgres>,
}

impl PostgresCommandLog {
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CommandLog for PostgresCommandLog {
    async fn append(&self, record: &CommandRecord) -> Result<()> {
        let (tenant_id, timer_id, command) = match record {
            CommandRecord::Schedule { timer }
            | CommandRecord::Cancel { timer }
            | CommandRecord::Settle { timer } => {
                (timer.tenant_id.clone(), timer.id, command_name(record))
            }
            CommandRecord::Fire {
                tenant_id,
                timer_id,
                ..
            } => (tenant_id.clone(), *timer_id, command_name(record)),
        };

        let payload = serde_json::to_value(record)?;
        sqlx::query(
            "INSERT INTO timer_command_log (tenant_id, timer_id, command, payload) VALUES ($1, $2, $3, $4)",
        )
        .bind(tenant_id)
        .bind(timer_id)
        .bind(command)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn command_name(record: &CommandRecord) -> &'static str {
    match record {
        CommandRecord::Schedule { .. } => "schedule",
        CommandRecord::Cancel { .. } => "cancel",
        CommandRecord::Fire { .. } => "fire",
        CommandRecord::Settle { .. } => "settle",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::postgres::init_test_pool;
    use crate::{TimerInstance, TimerStatus};
    use chrono::Utc;
    use sqlx::Row;
    use std::collections::HashMap;
    use uuid::Uuid;

    #[tokio::test]
    async fn appends_command_records() {
        let Some(pool) = init_test_pool().await else {
            eprintln!("[command-log-tests] skipping — DATABASE_URL not configured");
            return;
        };

        sqlx::query("TRUNCATE timer_command_log RESTART IDENTITY")
            .execute(&pool)
            .await
            .unwrap();

        let command_log = PostgresCommandLog::new(pool.clone());
        let timer = TimerInstance {
            id: Uuid::new_v4(),
            tenant_id: "tenant-local".into(),
            requested_by: "test-suite".into(),
            name: "integration".into(),
            duration_ms: 1_000,
            created_at: Utc::now(),
            fire_at: Utc::now(),
            status: TimerStatus::Scheduled,
            metadata: None,
            labels: HashMap::new(),
            action_bundle: None,
            agent_binding: None,
            fired_at: None,
            cancelled_at: None,
            cancel_reason: None,
            cancelled_by: None,
            settled_at: None,
            failure_reason: None,
            state_version: 0,
        };

        command_log
            .append(&CommandRecord::Schedule {
                timer: timer.clone(),
            })
            .await
            .expect("append schedule");

        let record = sqlx::query(
            "SELECT tenant_id, command, payload FROM timer_command_log ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch command");

        let tenant_id: String = record.get("tenant_id");
        let command: String = record.get("command");
        let payload: serde_json::Value = record.get("payload");

        assert_eq!(tenant_id, timer.tenant_id);
        assert_eq!(command, "schedule");
        assert_eq!(
            payload.get("command").and_then(|v| v.as_str()),
            Some("schedule")
        );
        assert_eq!(
            payload
                .get("timer")
                .and_then(|value| value.get("tenant_id"))
                .and_then(|value| value.as_str()),
            Some("tenant-local"),
        );
    }
}
