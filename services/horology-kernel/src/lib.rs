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

pub mod grpc;
pub mod leadership;
pub mod persistence;
pub mod replication;
#[cfg_attr(not(test), allow(dead_code))]
pub mod test_support;

use leadership::LeaderHandle;
use persistence::{
    command_log::{CommandRecord, SharedCommandLog},
    InMemoryTimerStore, SharedTimerStore,
};

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
    #[error("kernel is not the active leader")]
    NotLeader,
    #[error("persistence error: {0}")]
    Persistence(#[from] anyhow::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Scheduled,
    Armed,
    Fired,
    Cancelled,
    Failed,
    Settled,
}

impl TimerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TimerStatus::Scheduled => "scheduled",
            TimerStatus::Armed => "armed",
            TimerStatus::Fired => "fired",
            TimerStatus::Cancelled => "cancelled",
            TimerStatus::Failed => "failed",
            TimerStatus::Settled => "settled",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "scheduled" => Some(TimerStatus::Scheduled),
            "armed" => Some(TimerStatus::Armed),
            "fired" => Some(TimerStatus::Fired),
            "cancelled" => Some(TimerStatus::Cancelled),
            "failed" => Some(TimerStatus::Failed),
            "settled" => Some(TimerStatus::Settled),
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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
    pub settled_at: Option<DateTime<Utc>>,
    pub failure_reason: Option<String>,
    pub state_version: i64,
}

impl TimerInstance {
    fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            TimerStatus::Cancelled | TimerStatus::Failed | TimerStatus::Settled
        )
    }

    fn transition(&mut self, status: TimerStatus) {
        self.status = status;
        self.state_version += 1;
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum TimerEvent {
    Scheduled(TimerInstance),
    Fired(TimerInstance),
    Cancelled {
        timer: TimerInstance,
        reason: Option<String>,
    },
    Settled(TimerInstance),
}

#[derive(Clone)]
struct KernelState {
    timers: Arc<RwLock<HashMap<Uuid, TimerInstance>>>,
    event_tx: broadcast::Sender<TimerEvent>,
    config: SchedulerConfig,
    store: SharedTimerStore,
    command_log: Option<SharedCommandLog>,
    leader: Option<LeaderHandle>,
}

#[derive(Clone)]
pub struct HorologyKernel {
    state: KernelState,
}

#[derive(Clone)]
pub struct KernelRuntimeOptions {
    pub store: SharedTimerStore,
    pub command_log: Option<SharedCommandLog>,
    pub leader: Option<LeaderHandle>,
}

impl KernelRuntimeOptions {
    pub fn new(store: SharedTimerStore) -> Self {
        Self {
            store,
            command_log: None,
            leader: None,
        }
    }
}

impl HorologyKernel {
    pub fn new(config: SchedulerConfig) -> Self {
        let (event_tx, _rx) = broadcast::channel(1024);
        Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                store: Arc::new(InMemoryTimerStore::default()),
                command_log: None,
                leader: None,
            },
        }
    }

    pub async fn with_store(config: SchedulerConfig, store: SharedTimerStore) -> Result<Self> {
        Self::with_runtime(config, KernelRuntimeOptions::new(store)).await
    }

    pub async fn with_runtime(
        config: SchedulerConfig,
        options: KernelRuntimeOptions,
    ) -> Result<Self> {
        let (event_tx, _rx) = broadcast::channel(1024);
        let kernel = Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                store: options.store,
                command_log: options.command_log,
                leader: options.leader,
            },
        };
        kernel.restore_from_store().await?;
        Ok(kernel)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TimerEvent> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        self.ensure_leader()?;
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
            settled_at: None,
            failure_reason: None,
            state_version: 0,
        };

        {
            let mut timers = self.state.timers.write().await;
            timers.insert(timer.id, timer.clone());
        }

        self.state
            .store
            .upsert(&timer)
            .await
            .map_err(KernelError::from)?;
        self.record_command(CommandRecord::Schedule {
            timer: timer.clone(),
        })
        .await?;

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
        self.ensure_leader()?;
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

        entry.transition(TimerStatus::Cancelled);
        entry.cancelled_at = Some(Utc::now());
        entry.cancel_reason = reason.clone();
        entry.cancelled_by = cancelled_by;
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
        self.record_command(CommandRecord::Cancel {
            timer: snapshot.clone(),
        })
        .await?;

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
        let leader = state.leader.clone();
        let span = tracing::info_span!(
            "timer_fire_task",
            timer_id = %timer.id,
            tenant_id = %timer.tenant_id
        );
        tokio::spawn(
            async move {
                let now = Utc::now();
                let duration = match (timer.fire_at - now).to_std() {
                    Ok(value) => value,
                    Err(_) => Duration::from_secs(0),
                };

                {
                    if let Some(ref handle) = leader {
                        if !handle.is_leader() {
                            tracing::debug!(timer_id = %timer.id, "skipping arm transition because node is not leader");
                            return;
                        }
                    }

                    let mut timers = state.timers.write().await;
                    if let Some(entry) = timers.get_mut(&timer.id) {
                        if matches!(entry.status, TimerStatus::Scheduled) {
                            entry.transition(TimerStatus::Armed);
                            if let Err(error) = state.store.upsert(entry).await {
                                tracing::error!(timer_id = %timer.id, ?error, "failed to persist armed timer");
                            }
                        }
                    }
                }

                tokio::time::sleep(duration).await;

                if let Some(ref handle) = leader {
                    if !handle.is_leader() {
                        tracing::debug!(timer_id = %timer.id, "leader lost before firing timer");
                        return;
                    }
                }

                let snapshot = {
                    let mut timers = state.timers.write().await;
                    let entry = match timers.get_mut(&timer.id) {
                        Some(entry) => entry,
                        None => return,
                    };

                    if entry.is_terminal() {
                        return;
                    }

                    entry.transition(TimerStatus::Fired);
                    entry.fired_at = Some(Utc::now());
                    entry.clone()
                };

                let _ = state.event_tx.send(TimerEvent::Fired(snapshot.clone()));
                if let Err(error) = state.store.upsert(&snapshot).await {
                    tracing::error!(timer_id = %timer.id, ?error, "failed to persist fired timer");
                }
                if let Some(log) = state.command_log.clone() {
                    if let Err(error) = log
                        .append(&CommandRecord::Fire {
                            timer_id: snapshot.id,
                            tenant_id: snapshot.tenant_id.clone(),
                            fired_at: snapshot
                                .fired_at
                                .map(|ts| ts.to_rfc3339())
                                .unwrap_or_else(|| Utc::now().to_rfc3339()),
                        })
                        .await
                    {
                        tracing::warn!(timer_id = %snapshot.id, ?error, "failed to append fire command log");
                    }
                }

                let settled = {
                    let mut timers = state.timers.write().await;
                    if let Some(entry) = timers.get_mut(&snapshot.id) {
                        if entry.is_terminal() {
                            return;
                        }
                        entry.transition(TimerStatus::Settled);
                        entry.settled_at = Some(Utc::now());
                        entry.clone()
                    } else {
                        return;
                    }
                };

                if let Err(error) = state.store.upsert(&settled).await {
                    tracing::error!(timer_id = %settled.id, ?error, "failed to persist settled timer");
                }
                let _ = state.event_tx.send(TimerEvent::Settled(settled.clone()));
                if let Some(log) = state.command_log.clone() {
                    if let Err(error) = log.append(&CommandRecord::Settle { timer: settled.clone() }).await {
                        tracing::warn!(timer_id = %settled.id, ?error, "failed to append settle command log");
                    }
                }
            }
            .instrument(span),
        );
    }

    async fn record_command(&self, record: CommandRecord) -> Result<(), KernelError> {
        if let Some(log) = &self.state.command_log {
            log.append(&record).await.map_err(KernelError::from)?;
        }
        Ok(())
    }

    fn ensure_leader(&self) -> Result<(), KernelError> {
        if let Some(leader) = &self.state.leader {
            if !leader.is_leader() {
                return Err(KernelError::NotLeader);
            }
        }
        Ok(())
    }

    async fn restore_from_store(&self) -> Result<()> {
        let persisted = self.state.store.load_active().await?;
        if persisted.is_empty() {
            return Ok(());
        }

        {
            let mut timers = self.state.timers.write().await;
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

#[cfg(test)]
#[allow(dead_code)]
mod tests {
    use super::*;
    use crate::persistence::TimerStore;
    use async_trait::async_trait;

    #[allow(dead_code)]
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

        assert_eq!(
            events.recv().await.unwrap(),
            TimerEvent::Scheduled(timer.clone())
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        let fired = events.recv().await.unwrap();
        match fired {
            TimerEvent::Fired(fired_timer) => {
                assert_eq!(fired_timer.id, timer.id);
            }
            other => panic!("unexpected event {other:?}"),
        }
    }
}
