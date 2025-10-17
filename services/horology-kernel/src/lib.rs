use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::{anyhow, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use hex::{decode as hex_decode, encode as hex_encode};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use thiserror::Error;
use tokio::{sync::broadcast, sync::RwLock};
use tracing::Instrument;
use uuid::Uuid;

pub mod pb {
    tonic::include_proto!("minoots.timer.v1");
}

pub mod events;
pub mod grpc;
pub mod leadership;
pub mod persistence;
pub mod replication;
pub mod telemetry;
#[cfg_attr(not(test), allow(dead_code))]
pub mod test_support;

use telemetry::jitter::JitterMonitor;

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
    pub jitter_ms: Option<i64>,
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

impl TimerEvent {
    pub fn event_type(&self) -> TimerEventType {
        match self {
            TimerEvent::Scheduled(_) => TimerEventType::Scheduled,
            TimerEvent::Fired(_) => TimerEventType::Fired,
            TimerEvent::Cancelled { .. } => TimerEventType::Cancelled,
            TimerEvent::Settled(_) => TimerEventType::Settled,
        }
    }

    pub fn timer(&self) -> &TimerInstance {
        match self {
            TimerEvent::Scheduled(timer)
            | TimerEvent::Fired(timer)
            | TimerEvent::Settled(timer) => timer,
            TimerEvent::Cancelled { timer, .. } => timer,
        }
    }

    pub fn tenant_id(&self) -> &str {
        &self.timer().tenant_id
    }

    pub fn timer_id(&self) -> Uuid {
        self.timer().id
    }

    pub fn state_version(&self) -> i64 {
        self.timer().state_version
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerEventType {
    Scheduled,
    Fired,
    Cancelled,
    Settled,
}

impl TimerEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TimerEventType::Scheduled => "scheduled",
            TimerEventType::Fired => "fired",
            TimerEventType::Cancelled => "cancelled",
            TimerEventType::Settled => "settled",
        }
    }
}

fn broadcast_signed_event(state: &KernelState, event: TimerEvent) {
    match state.event_signer.sign_event(event) {
        Ok(envelope) => {
            if let Err(error) = state.event_tx.send(envelope) {
                tracing::warn!(?error, "failed to broadcast timer event envelope");
            }
        }
        Err(error) => {
            tracing::error!(?error, "failed to sign timer event envelope");
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EventEnvelope {
    pub envelope_id: Uuid,
    pub tenant_id: String,
    pub occurred_at_iso: String,
    pub dedupe_key: String,
    pub trace_id: Option<String>,
    pub signature: String,
    pub signature_version: String,
    pub event: TimerEvent,
}

impl EventEnvelope {
    pub fn event_type(&self) -> TimerEventType {
        self.event.event_type()
    }
}

#[derive(Clone)]
pub struct EventSigner {
    secret: Arc<[u8]>,
}

struct UnsignedEventEnvelope {
    envelope_id: Uuid,
    tenant_id: String,
    occurred_at_iso: String,
    dedupe_key: String,
    trace_id: Option<String>,
    event: TimerEvent,
}

const ENVELOPE_SIGNATURE_VERSION: &str = "v1-hmac-sha256";
const DEFAULT_ENVELOPE_SECRET: &str = "insecure-dev-envelope-secret";

impl EventSigner {
    pub fn new(secret: impl AsRef<[u8]>) -> Self {
        Self {
            secret: Arc::from(secret.as_ref().to_vec().into_boxed_slice()),
        }
    }

    pub fn insecure_dev() -> Self {
        Self::new(DEFAULT_ENVELOPE_SECRET.as_bytes())
    }

    pub fn sign_event(&self, event: TimerEvent) -> Result<EventEnvelope> {
        self.sign_event_with_trace(event, None)
    }

    pub fn sign_event_with_trace(
        &self,
        event: TimerEvent,
        trace_id: Option<String>,
    ) -> Result<EventEnvelope> {
        let occurred_at = Utc::now();
        let occurred_at_iso = occurred_at.to_rfc3339_opts(SecondsFormat::Millis, true);
        let dedupe_key = format!(
            "timer:{}:{}:{}",
            event.tenant_id(),
            event.timer_id(),
            event.state_version()
        );
        let unsigned = UnsignedEventEnvelope {
            envelope_id: Uuid::new_v4(),
            tenant_id: event.tenant_id().to_string(),
            occurred_at_iso,
            dedupe_key,
            trace_id,
            event,
        };
        self.finish(unsigned)
    }

    fn finish(&self, unsigned: UnsignedEventEnvelope) -> Result<EventEnvelope> {
        let json_bytes = self.signing_bytes(
            &unsigned.envelope_id,
            &unsigned.tenant_id,
            &unsigned.occurred_at_iso,
            &unsigned.dedupe_key,
            unsigned.trace_id.as_deref(),
            &unsigned.event,
        )?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.secret)
            .map_err(|error| anyhow!("invalid envelope secret: {error}"))?;
        mac.update(&json_bytes);
        let signature = hex_encode(mac.finalize().into_bytes());
        Ok(EventEnvelope {
            envelope_id: unsigned.envelope_id,
            tenant_id: unsigned.tenant_id,
            occurred_at_iso: unsigned.occurred_at_iso,
            dedupe_key: unsigned.dedupe_key,
            trace_id: unsigned.trace_id,
            signature,
            signature_version: ENVELOPE_SIGNATURE_VERSION.to_string(),
            event: unsigned.event,
        })
    }

    pub fn verify(&self, envelope: &EventEnvelope) -> Result<bool> {
        let json_bytes = self.signing_bytes(
            &envelope.envelope_id,
            &envelope.tenant_id,
            &envelope.occurred_at_iso,
            &envelope.dedupe_key,
            envelope.trace_id.as_deref(),
            &envelope.event,
        )?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.secret)
            .map_err(|error| anyhow!("invalid envelope secret: {error}"))?;
        mac.update(&json_bytes);
        let provided = hex_decode(&envelope.signature)
            .map_err(|error| anyhow!("invalid envelope signature encoding: {error}"))?;
        Ok(mac.verify_slice(&provided).is_ok())
    }

    fn signing_bytes(
        &self,
        envelope_id: &Uuid,
        tenant_id: &str,
        occurred_at_iso: &str,
        dedupe_key: &str,
        trace_id: Option<&str>,
        event: &TimerEvent,
    ) -> Result<Vec<u8>> {
        let payload = json!({
            "envelope_id": envelope_id,
            "tenant_id": tenant_id,
            "occurred_at_iso": occurred_at_iso,
            "dedupe_key": dedupe_key,
            "trace_id": trace_id,
            "event_type": event.event_type().as_str(),
            "event": event,
        });
        let canonical = canonicalize(payload);
        Ok(serde_json::to_vec(&canonical)?)
    }
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let mut sorted = serde_json::Map::with_capacity(entries.len());
            for (key, value) in entries {
                sorted.insert(key, canonicalize(value));
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
        other => other,
    }
}

#[derive(Clone)]
struct KernelState {
    timers: Arc<RwLock<HashMap<Uuid, TimerInstance>>>,
    event_tx: broadcast::Sender<EventEnvelope>,
    config: SchedulerConfig,
    store: SharedTimerStore,
    command_log: Option<SharedCommandLog>,
    leader: Option<LeaderHandle>,
    event_signer: Arc<EventSigner>,
    jitter_monitor: JitterMonitor,
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
    pub event_signer: Arc<EventSigner>,
}

impl KernelRuntimeOptions {
    pub fn new(store: SharedTimerStore) -> Self {
        Self {
            store,
            command_log: None,
            leader: None,
            event_signer: Arc::new(EventSigner::insecure_dev()),
        }
    }
}

impl HorologyKernel {
    pub fn new(config: SchedulerConfig) -> Self {
        let (event_tx, _rx) = broadcast::channel(1024);
        let signer = Arc::new(EventSigner::insecure_dev());
        Self {
            state: KernelState {
                timers: Arc::new(RwLock::new(HashMap::new())),
                event_tx,
                config,
                store: Arc::new(InMemoryTimerStore::default()),
                command_log: None,
                leader: None,
                event_signer: signer,
                jitter_monitor: JitterMonitor::with_default_window(),
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
                event_signer: options.event_signer,
                jitter_monitor: JitterMonitor::with_default_window(),
            },
        };
        kernel.restore_from_store().await?;
        Ok(kernel)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
        self.state.event_tx.subscribe()
    }

    pub async fn schedule(&self, spec: TimerSpec) -> Result<TimerInstance, KernelError> {
        self.ensure_leader()?;
        let now = Utc::now();
        let requested_delay = if let Some(ts) = spec.fire_at {
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

        let chrono_delay = chrono::Duration::from_std(requested_delay)
            .map_err(|_| KernelError::InvalidFireTime)?;
        let requested_fire_at = spec.fire_at.unwrap_or_else(|| now + chrono_delay);
        let fire_at = self
            .state
            .jitter_monitor
            .adjust_fire_at(now, requested_fire_at)
            .await;
        let actual_delay = (fire_at - now)
            .to_std()
            .map_err(|_| KernelError::InvalidFireTime)?;
        let duration_ms = actual_delay.as_millis() as u64;
        if let Some(max) = self.state.config.max_duration_ms {
            if duration_ms > max {
                return Err(KernelError::InvalidDuration);
            }
        }

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
            jitter_ms: None,
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

        broadcast_signed_event(&self.state, TimerEvent::Scheduled(timer.clone()));

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

        broadcast_signed_event(
            &self.state,
            TimerEvent::Cancelled {
                timer: snapshot.clone(),
                reason,
            },
        );

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
        let jitter_monitor = state.jitter_monitor.clone();
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

                let scheduled_fire_at = timer.fire_at;
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
                    let actual_fire_at = Utc::now();
                    entry.fired_at = Some(actual_fire_at);
                    entry.jitter_ms = Some((actual_fire_at - scheduled_fire_at).num_milliseconds());
                    entry.clone()
                };

                if let (Some(fired_at), Some(jitter_ms)) = (snapshot.fired_at, snapshot.jitter_ms) {
                    let sample = jitter_monitor
                        .record(scheduled_fire_at, fired_at, snapshot.id, &snapshot.tenant_id)
                        .await;
                    tracing::debug!(
                        timer_id = %snapshot.id,
                        tenant_id = %snapshot.tenant_id,
                        jitter_ms = jitter_ms,
                        sample_ms = sample.delta_ms,
                        "recorded timer jitter sample"
                    );
                }

                broadcast_signed_event(&state, TimerEvent::Fired(snapshot.clone()));
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
                broadcast_signed_event(&state, TimerEvent::Settled(settled.clone()));
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

        let signer = EventSigner::insecure_dev();

        let scheduled = events.recv().await.unwrap();
        assert!(signer
            .verify(&scheduled)
            .expect("verify scheduled envelope"));
        match scheduled.event {
            TimerEvent::Scheduled(ref scheduled_timer) => {
                assert_eq!(scheduled_timer.id, timer.id);
            }
            other => panic!("unexpected event {other:?}"),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        let fired = events.recv().await.unwrap();
        assert!(signer.verify(&fired).expect("verify fired envelope"));
        match fired.event {
            TimerEvent::Fired(fired_timer) => {
                assert_eq!(fired_timer.id, timer.id);
            }
            other => panic!("unexpected event {other:?}"),
        }
    }
}
