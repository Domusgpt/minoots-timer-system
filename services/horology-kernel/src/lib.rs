use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{sync::broadcast, sync::RwLock};
use tracing::Instrument;
use uuid::Uuid;

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
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Scheduled,
    Armed,
    Fired,
    Cancelled,
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
    event_tx: broadcast::Sender<TimerEvent>,
    config: SchedulerConfig,
}

#[derive(Clone)]
pub struct HorologyKernel {
    state: KernelState,
}

impl HorologyKernel {
    pub fn new(config: SchedulerConfig) -> Self {
        let (event_tx, _rx) = broadcast::channel(1024);
        Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
            },
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TimerEvent> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        if spec.duration_ms == 0 {
            return Err(KernelError::InvalidDuration);
        }
        if let Some(max) = self.state.config.max_duration_ms {
            if spec.duration_ms > max {
                return Err(KernelError::InvalidDuration);
            }
        }

        let now = Utc::now();
        let delay = if let Some(ts) = spec.fire_at {
            if ts <= now {
                return Err(KernelError::InvalidFireTime);
            }
            (ts - now)
                .to_std()
                .map_err(|_| KernelError::InvalidFireTime)?
        } else {
            Duration::from_millis(spec.duration_ms)
        };

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
            duration_ms: delay.as_millis() as u64,
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

        {
            let mut timers = self.state.timers.write().await;
            timers.insert(timer.id, timer.clone());
        }

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
    ) -> Option<TimerInstance> {
        let mut timers = self.state.timers.write().await;
        let entry = timers.get_mut(&timer_id)?;
        if entry.tenant_id != tenant_id {
            return None;
        }

        if entry.is_terminal() {
            return Some(entry.clone());
        }

        entry.status = TimerStatus::Cancelled;
        entry.cancelled_at = Some(Utc::now());
        entry.cancel_reason = reason.clone();
        entry.cancelled_by = cancelled_by;
        let snapshot = entry.clone();
        drop(timers);

        let _ = self.state.event_tx.send(TimerEvent::Cancelled {
            timer: snapshot.clone(),
            reason,
        });
        Some(snapshot)
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
                let duration = Duration::from_millis(timer.duration_ms);
                tokio::time::sleep(duration).await;

                let mut timers = state.timers.write().await;
                let entry = match timers.get_mut(&timer.id) {
                    Some(entry) => entry,
                    None => return,
                };

                if entry.is_terminal() {
                    return;
                }

                entry.status = TimerStatus::Fired;
                entry.fired_at = Some(Utc::now());
                let snapshot = entry.clone();
                drop(timers);

                let _ = state.event_tx.send(TimerEvent::Fired(snapshot));
            }
            .instrument(span),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            .expect("cancel timer");

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
}
