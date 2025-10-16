use anyhow::{Context, Result};
use async_trait::async_trait;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres, Row};
use tracing::info;

use crate::{TimerInstance, TimerStatus};

use super::TimerStore;

#[derive(Clone)]
pub struct PostgresTimerStore {
    pool: Pool<Postgres>,
}

impl PostgresTimerStore {
    pub async fn connect(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(std::env::var("PGPOOL_MAX")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10))
            .connect(database_url)
            .await
            .with_context(|| "failed to connect to postgres for timer store")?;
        info!("connected to postgres for timer store");
        Ok(Self { pool })
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
                metadata, labels, action_bundle, agent_binding, fired_at, cancelled_at, cancel_reason, cancelled_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16
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
                cancelled_by = EXCLUDED.cancelled_by
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
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
