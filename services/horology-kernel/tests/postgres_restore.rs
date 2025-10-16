use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use horology_kernel::persistence::command_log::SharedCommandLog;
use horology_kernel::persistence::postgres::{PostgresCommandLog, PostgresTimerStore};
use horology_kernel::persistence::{SharedTimerStore, TimerStore};
use horology_kernel::{
    HorologyKernel, KernelRuntimeOptions, SchedulerConfig, TimerEvent, TimerInstance, TimerStatus,
};
use sqlx::Row;
use tokio::time::timeout;
use uuid::Uuid;

use horology_kernel::test_support::postgres::init_test_pool;

#[tokio::test]
async fn restores_scheduled_timer_after_restart() {
    let Some(pool) = init_test_pool().await else {
        eprintln!(
            "[postgres-restore-tests] skipping — TEST_DATABASE_URL or DATABASE_URL not configured",
        );
        return;
    };

    sqlx::query("TRUNCATE timer_records RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate timer_records");
    sqlx::query("TRUNCATE timer_command_log RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate timer_command_log");

    let timer = TimerInstance {
        id: Uuid::new_v4(),
        tenant_id: "tenant-persist".into(),
        requested_by: "integration-test".into(),
        name: "durable-timer".into(),
        duration_ms: 500,
        created_at: Utc::now(),
        fire_at: Utc::now() + ChronoDuration::milliseconds(250),
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

    let store = PostgresTimerStore::from_pool(pool.clone());
    store.upsert(&timer).await.expect("persist scheduled timer");

    let shared_store: SharedTimerStore = Arc::new(store);
    let shared_command_log: SharedCommandLog = Arc::new(PostgresCommandLog::new(pool.clone()));
    let kernel = HorologyKernel::with_runtime(
        SchedulerConfig::default(),
        KernelRuntimeOptions {
            store: shared_store.clone(),
            command_log: Some(shared_command_log.clone()),
            leader: None,
        },
    )
    .await
    .expect("initialize kernel with postgres store");

    let mut events = kernel.subscribe();

    let fired = timeout(Duration::from_secs(3), async {
        loop {
            match events.recv().await {
                Ok(TimerEvent::Fired(timer)) => break timer,
                Ok(_) => continue,
                Err(error) => panic!("event channel closed unexpectedly: {error:?}"),
            }
        }
    })
    .await
    .expect("timer fired before timeout");

    let expected_timer_id = timer.id;
    let expected_tenant_id = timer.tenant_id.clone();

    assert_eq!(fired.id, expected_timer_id);
    assert_eq!(fired.tenant_id.as_str(), expected_tenant_id.as_str());

    timeout(Duration::from_secs(3), async {
        loop {
            match events.recv().await {
                Ok(TimerEvent::Settled(settled)) if settled.id == expected_timer_id => break,
                Ok(_) => continue,
                Err(error) => panic!("event channel closed unexpectedly: {error:?}"),
            }
        }
    })
    .await
    .expect("timer settled before timeout");

    let stored_status: Option<String> =
        sqlx::query("SELECT status FROM timer_records WHERE id = $1")
            .bind(expected_timer_id)
            .fetch_optional(&pool)
            .await
            .expect("fetch stored timer")
            .map(|row| row.get("status"));

    assert_eq!(stored_status.as_deref(), Some("settled"));

    let command_rows: Vec<(String, Uuid, String)> =
        sqlx::query("SELECT command, timer_id, tenant_id FROM timer_command_log ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("fetch command log entries")
            .into_iter()
            .map(|row| {
                (
                    row.get("command"),
                    row.get("timer_id"),
                    row.get("tenant_id"),
                )
            })
            .collect();

    assert_eq!(command_rows.len(), 2, "expected fire and settle records");
    assert_eq!(
        command_rows,
        vec![
            (
                "fire".to_string(),
                expected_timer_id,
                expected_tenant_id.clone()
            ),
            (
                "settle".to_string(),
                expected_timer_id,
                expected_tenant_id.clone(),
            ),
        ]
    );

    drop(shared_command_log);
    drop(shared_store);
}
