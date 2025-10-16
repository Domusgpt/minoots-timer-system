use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{sync::broadcast, sync::RwLock};
use tracing::Instrument;
use uuid::Uuid;

pub mod pb {
    tonic::include_proto!("minoots.timer.v1");
}

pub mod command;
pub mod grpc;
pub mod persistence;
pub mod replication;

use command::TimerCommand;
use persistence::{InMemoryCommandLog, InMemoryTimerStore, SharedCommandLog, SharedTimerStore};
use replication::RaftSupervisor;

#[derive(Clone, Debug)]
pub struct SchedulerConfig {
    pub max_duration_ms: Option<u64>,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_duration_ms: Some(1000 * 60 * 60 * 24 * 30), // 30 days
        }
    }
}

#[derive(Debug, Error)]
pub enum KernelError {
    #[error("duration must be greater than zero")]
    InvalidDuration,
    #[error("fire_at must be in the future")]
    InvalidFireTime,
    #[error("persistence error: {0}")]
    Persistence(#[from] anyhow::Error),
    #[error("horology kernel is not the leader")]
    NotLeader,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Scheduled,
    Armed,
    Fired,
    Cancelled,
}

impl TimerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TimerStatus::Scheduled => "scheduled",
            TimerStatus::Armed => "armed",
            TimerStatus::Fired => "fired",
            TimerStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "scheduled" => Some(TimerStatus::Scheduled),
            "armed" => Some(TimerStatus::Armed),
            "fired" => Some(TimerStatus::Fired),
            "cancelled" => Some(TimerStatus::Cancelled),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimerSpec {
    pub tenant_id: String,
    pub requested_by: String,
    pub name: Option<String>,
    pub duration_ms: u64,
    pub fire_at: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
    pub labels: HashMap<String, String>,
    pub action_bundle: Option<serde_json::Value>,
    pub agent_binding: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimerInstance {
    pub id: Uuid,
    pub tenant_id: String,
    pub requested_by: String,
    pub name: String,
    pub duration_ms: u64,
    pub created_at: DateTime<Utc>,
    pub fire_at: DateTime<Utc>,
    pub status: TimerStatus,
    pub metadata: Option<serde_json::Value>,
    pub labels: HashMap<String, String>,
    pub action_bundle: Option<serde_json::Value>,
    pub agent_binding: Option<serde_json::Value>,
    pub fired_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancel_reason: Option<String>,
    pub cancelled_by: Option<String>,
}

impl TimerInstance {
    fn is_terminal(&self) -> bool {
        matches!(self.status, TimerStatus::Fired | TimerStatus::Cancelled)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum TimerEvent {
    Scheduled(TimerInstance),
    Fired(TimerInstance),
    Cancelled {
        timer: TimerInstance,
        reason: Option<String>,
    },
}

#[derive(Clone)]
struct KernelState {
    timers: Arc<RwLock<HashMap<Uuid, TimerInstance>>>,
    event_tx: Arc<broadcast::Sender<TimerEvent>>,
    config: SchedulerConfig,
    store: SharedTimerStore,
    command_log: SharedCommandLog,
    raft: Option<RaftSupervisor>,
}

#[derive(Clone)]
pub struct HorologyKernel {
    state: KernelState,
}

impl HorologyKernel {
    pub fn new(config: SchedulerConfig) -> Self {
        let (event_tx, _rx) = broadcast::channel(1024);
        let event_tx = Arc::new(event_tx);
        Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                store: Arc::new(InMemoryTimerStore::default()),
                command_log: Arc::new(InMemoryCommandLog::new()),
                raft: None,
            },
        }
    }

    pub async fn with_store(
        config: SchedulerConfig,
        store: SharedTimerStore,
        command_log: SharedCommandLog,
    ) -> Result<Self> {
        let (event_tx, _rx) = broadcast::channel(1024);
        let event_tx = Arc::new(event_tx);
        let node_id = std::env::var("KERNEL_NODE_ID")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
        let raft = Some(RaftSupervisor::new(node_id).await?);
        let kernel = Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                store,
                command_log,
                raft,
            },
        };
        kernel.restore_from_store().await?;
        Ok(kernel)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TimerEvent> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        self.ensure_leader().await?;

        let now = Utc::now();
        let delay = if let Some(ts) = spec.fire_at {
            if ts <= now {
                return Err(KernelError::InvalidFireTime);
            }
            (ts - now)
                .to_std()
                .map_err(|_| KernelError::InvalidFireTime)?
        } else {
            if spec.duration_ms == 0 {
                return Err(KernelError::InvalidDuration);
            }
            Duration::from_millis(spec.duration_ms)
        };

        let duration_ms = delay.as_millis() as u64;
        if let Some(max) = self.state.config.max_duration_ms {
            if duration_ms > max {
                return Err(KernelError::InvalidDuration);
            }
        }

        let chrono_delay =
            chrono::Duration::from_std(delay).map_err(|_| KernelError::InvalidFireTime)?;
        let fire_at = spec.fire_at.unwrap_or_else(|| now + chrono_delay);

        let timer = TimerInstance {
            id: Uuid::new_v4(),
            tenant_id: spec.tenant_id.clone(),
            requested_by: spec.requested_by.clone(),
            name: spec
                .name
                .unwrap_or_else(|| format!("timer-{}", now.timestamp_millis())),
            duration_ms,
            created_at: now,
            fire_at,
            status: TimerStatus::Scheduled,
            metadata: spec.metadata.clone(),
            labels: spec.labels.clone(),
            action_bundle: spec.action_bundle.clone(),
            agent_binding: spec.agent_binding.clone(),
            fired_at: None,
            cancelled_at: None,
            cancel_reason: None,
            cancelled_by: None,
        };

        self.state
            .command_log
            .append(&TimerCommand::Schedule {
                timer: timer.clone(),
            })
            .await
            .map_err(KernelError::from)?;

        {
            let mut timers = self.state.timers.write().await;
            timers.insert(timer.id, timer.clone());
        }

        self.state
            .store
            .upsert(&timer)
            .await
            .map_err(KernelError::from)?;

        let _ = self
            .state
            .event_tx
            .send(TimerEvent::Scheduled(timer.clone()));

        self.spawn_fire_task(timer.clone());

        Ok(timer)
    }

    pub async fn cancel(
        &self,
        tenant_id: &str,
        timer_id: Uuid,
        reason: Option<String>,
        cancelled_by: Option<String>,
    ) -> Result<Option<TimerInstance>, KernelError> {
        self.ensure_leader().await?;

        let mut timers = self.state.timers.write().await;
        let entry = match timers.get_mut(&timer_id) {
            Some(entry) => entry,
            None => return Ok(None),
        };
        if entry.tenant_id != tenant_id {
            return Ok(None);
        }

        if entry.is_terminal() {
            return Ok(Some(entry.clone()));
        }

        let cancelled_at = Utc::now();
        let cancel_actor = cancelled_by.clone();
        self.state
            .command_log
            .append(&TimerCommand::Cancel {
                timer_id: entry.id,
                tenant_id: entry.tenant_id.clone(),
                cancelled_by: cancel_actor.clone(),
                reason: reason.clone(),
                at: cancelled_at,
            })
            .await
            .map_err(KernelError::from)?;

        entry.status = TimerStatus::Cancelled;
        entry.cancelled_at = Some(cancelled_at);
        entry.cancel_reason = reason.clone();
        entry.cancelled_by = cancel_actor.clone();
        let snapshot = entry.clone();
        drop(timers);

        let _ = self.state.event_tx.send(TimerEvent::Cancelled {
            timer: snapshot.clone(),
            reason,
        });

        self.state
            .store
            .upsert(&snapshot)
            .await
            .map_err(KernelError::from)?;

        Ok(Some(snapshot))
    }

    pub async fn get(&self, tenant_id: &str, timer_id: Uuid) -> Option<TimerInstance> {
        let timers = self.state.timers.read().await;
        timers
            .get(&timer_id)
            .filter(|t| t.tenant_id == tenant_id)
            .cloned()
    }

    pub async fn list(&self, tenant_id: &str) -> Vec<TimerInstance> {
        let timers = self.state.timers.read().await;
        let mut timers: Vec<_> = timers
            .values()
            .filter(|t| t.tenant_id == tenant_id)
            .cloned()
            .collect();
        timers.sort_by_key(|t| t.fire_at);
        timers
    }

    fn spawn_fire_task(&self, timer: TimerInstance) {
        let state = self.state.clone();
        let span = tracing::info_span!("timer_fire_task", timer_id = %timer.id, tenant_id = %timer.tenant_id);
        tokio::spawn(
            async move {
                let now = Utc::now();
                let duration = match (timer.fire_at - now).to_std() {
                    Ok(value) => value,
                    Err(_) => Duration::from_secs(0),
                };

                {
                    let mut timers = state.timers.write().await;
                    let entry = match timers.get_mut(&timer.id) {
                        Some(entry) => entry,
                        None => return,
                    };

                    if entry.is_terminal() {
                        return;
                    }

                    entry.status = TimerStatus::Armed;
                    let snapshot = entry.clone();
                    drop(timers);

                    if let Err(error) = state.store.upsert(&snapshot).await {
                        tracing::error!(timer_id = %timer.id, ?error, "failed to persist armed timer");
                    }
                }

                tokio::time::sleep(duration).await;

                let mut timers = state.timers.write().await;
                let entry = match timers.get_mut(&timer.id) {
                    Some(entry) => entry,
                    None => return,
                };

                if entry.is_terminal() {
                    return;
                }

                let fired_at = Utc::now();
                entry.status = TimerStatus::Fired;
                entry.fired_at = Some(fired_at);
                let snapshot = entry.clone();
                drop(timers);

                let _ = state.event_tx.send(TimerEvent::Fired(snapshot.clone()));
                if let Err(error) = state
                    .command_log
                    .append(&TimerCommand::Fire {
                        timer_id: snapshot.id,
                        tenant_id: snapshot.tenant_id.clone(),
                        at: fired_at,
                    })
                    .await
                {
                    tracing::error!(timer_id = %timer.id, ?error, "failed to append fire command");
                }
                if let Err(error) = state.store.upsert(&snapshot).await {
                    tracing::error!(timer_id = %timer.id, ?error, "failed to persist fired timer");
                }
            }
            .instrument(span),
        );
    }

    async fn restore_from_store(&self) -> Result<()> {
        match self.state.command_log.load_all().await {
            Ok(entries) if !entries.is_empty() => {
                let mut timers = HashMap::new();
                for entry in entries {
                    Self::apply_command(&mut timers, &entry.command);
                }

                {
                    let mut state_timers = self.state.timers.write().await;
                    state_timers.clear();
                    for (id, timer) in timers.iter() {
                        state_timers.insert(*id, timer.clone());
                    }
                }

                for timer in timers.into_values() {
                    if timer.is_terminal() {
                        continue;
                    }
                    self.spawn_fire_task(timer);
                }
                Ok(())
            }
            Ok(_) => {
                let persisted = self.state.store.load_active().await?;
                if persisted.is_empty() {
                    return Ok(());
                }

                {
                    let mut timers = self.state.timers.write().await;
                    timers.clear();
                    for timer in persisted.iter() {
                        timers.insert(timer.id, timer.clone());
                    }
                }

                for timer in persisted {
                    if timer.is_terminal() {
                        continue;
                    }
                    self.spawn_fire_task(timer);
                }

                Ok(())
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    "failed to load command log; falling back to store state"
                );
                let persisted = self.state.store.load_active().await?;
                if persisted.is_empty() {
                    return Ok(());
                }

                {
                    let mut timers = self.state.timers.write().await;
                    timers.clear();
                    for timer in persisted.iter() {
                        timers.insert(timer.id, timer.clone());
                    }
                }

                for timer in persisted {
                    if timer.is_terminal() {
                        continue;
                    }
                    self.spawn_fire_task(timer);
                }

                Ok(())
            }
        }
    }

    async fn ensure_leader(&self) -> Result<(), KernelError> {
        if let Some(raft) = &self.state.raft {
            raft.ensure_leader().await.map_err(|error| {
                tracing::error!(?error, "raft leader check failed");
                KernelError::NotLeader
            })?
        }
        Ok(())
    }

    fn apply_command(timers: &mut HashMap<Uuid, TimerInstance>, command: &TimerCommand) {
        match command {
            TimerCommand::Schedule { timer } => {
                timers.insert(timer.id, timer.clone());
            }
            TimerCommand::Cancel {
                timer_id,
                tenant_id,
                cancelled_by,
                reason,
                at,
            } => {
                if let Some(entry) = timers.get_mut(timer_id) {
                    if entry.tenant_id == *tenant_id {
                        entry.status = TimerStatus::Cancelled;
                        entry.cancelled_at = Some(*at);
                        entry.cancelled_by = cancelled_by.clone();
                        entry.cancel_reason = reason.clone();
                    }
                }
            }
            TimerCommand::Fire {
                timer_id,
                tenant_id,
                at,
            } => {
                if let Some(entry) = timers.get_mut(timer_id) {
                    if entry.tenant_id == *tenant_id {
                        entry.status = TimerStatus::Fired;
                        entry.fired_at = Some(*at);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::{InMemoryCommandLog, SharedCommandLog, SharedTimerStore, TimerStore};
    use async_trait::async_trait;

    #[derive(Clone, Default)]
    struct RecordingStore {
        timers: Arc<RwLock<Vec<TimerInstance>>>,
    }

    #[async_trait]
    impl TimerStore for RecordingStore {
        async fn load_active(&self) -> anyhow::Result<Vec<TimerInstance>> {
            let timers = self.timers.read().await;
            Ok(timers.clone())
        }

        async fn upsert(&self, timer: &TimerInstance) -> anyhow::Result<()> {
            let mut timers = self.timers.write().await;
            if let Some(existing) = timers.iter_mut().find(|t| t.id == timer.id) {
                *existing = timer.clone();
            } else {
                timers.push(timer.clone());
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn schedule_and_fire_emits_events() {
        tracing_subscriber::fmt::try_init().ok();
        let kernel = HorologyKernel::new(SchedulerConfig::default());
        let mut events = kernel.subscribe();

        let timer = kernel
            .schedule(TimerSpec {
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: Some("integration-test".into()),
                duration_ms: 50,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .expect("schedule timer");

        let scheduled = events.recv().await.expect("scheduled event");
        assert!(matches!(scheduled, TimerEvent::Scheduled(_)));

        let fired = events.recv().await.expect("fired event");
        match fired {
            TimerEvent::Fired(fired_timer) => {
                assert_eq!(fired_timer.id, timer.id);
                assert_eq!(fired_timer.status, TimerStatus::Fired);
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[tokio::test]
    async fn cancelling_prevents_fire_event() {
        let kernel = HorologyKernel::new(SchedulerConfig::default());
        let mut events = kernel.subscribe();

        let timer = kernel
            .schedule(TimerSpec {
                tenant_id: "tenant-a".into(),
                requested_by: "agent-1".into(),
                name: None,
                duration_ms: 200,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .unwrap();

        let _ = events.recv().await.expect("scheduled event");

        let cancelled = kernel
            .cancel(
                "tenant-a",
                timer.id,
                Some("manual".into()),
                Some("agent-1".into()),
            )
            .await
            .expect("cancel timer")
            .expect("timer should exist");

        assert_eq!(cancelled.status, TimerStatus::Cancelled);

        let cancel_event = events.recv().await.expect("cancel event");
        match cancel_event {
            TimerEvent::Cancelled {
                timer: cancelled_timer,
                ..
            } => {
                assert_eq!(cancelled_timer.id, timer.id);
            }
            other => panic!("unexpected event: {:?}", other),
        }

        // Ensure no fired event occurs by waiting longer than the duration
        tokio::time::sleep(Duration::from_millis(250)).await;
        while let Ok(event) = events.try_recv() {
            assert!(
                !matches!(event, TimerEvent::Fired(_)),
                "timer should not emit fired event after cancellation"
            );
        }
    }

    #[tokio::test]
    async fn restore_rehydrates_scheduled_timer() {
        let store = RecordingStore::default();
        let shared_store: SharedTimerStore = Arc::new(store.clone());
        let command_log: SharedCommandLog = Arc::new(InMemoryCommandLog::new());
        let kernel = HorologyKernel::with_store(
            SchedulerConfig::default(),
            shared_store.clone(),
            command_log.clone(),
        )
        .await
        .expect("kernel with store");

        let timer = kernel
            .schedule(TimerSpec {
                tenant_id: "tenant-restore".into(),
                requested_by: "agent".into(),
                name: Some("restore-test".into()),
                duration_ms: 30,
                fire_at: None,
                metadata: None,
                labels: HashMap::new(),
                action_bundle: None,
                agent_binding: None,
            })
            .await
            .expect("schedule timer");

        drop(kernel);

        let restored = HorologyKernel::with_store(
            SchedulerConfig::default(),
            shared_store.clone(),
            command_log.clone(),
        )
        .await
        .expect("restored kernel");
        let mut events = restored.subscribe();

        let fetched = restored
            .get(&timer.tenant_id, timer.id)
            .await
            .expect("timer should exist after restore");
        assert_eq!(fetched.id, timer.id);

        let fired = events.recv().await.expect("fired event after restore");
        match fired {
            TimerEvent::Fired(fired_timer) => assert_eq!(fired_timer.id, timer.id),
            other => panic!("unexpected event: {:?}", other),
        }
    }
}
