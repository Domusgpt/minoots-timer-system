use std::{collections::VecDeque, sync::Arc};

use chrono::{DateTime, Duration, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

const DEFAULT_WINDOW: usize = 64;
const MIN_COMPENSATED_LEAD_MS: i64 = 5;
const MAX_COMPENSATION_MS: i64 = 500;

#[derive(Clone, Debug, PartialEq)]
pub struct JitterSample {
    pub timer_id: Uuid,
    pub tenant_id: String,
    pub delta_ms: i64,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Default)]
struct JitterState {
    samples: VecDeque<i64>,
    sum: i128,
}

#[derive(Clone, Default)]
pub struct JitterMonitor {
    state: Arc<RwLock<JitterState>>,
    window: usize,
}

impl JitterMonitor {
    pub fn new(window: usize) -> Self {
        Self {
            state: Arc::new(RwLock::new(JitterState::default())),
            window: window.max(1),
        }
    }

    pub fn with_default_window() -> Self {
        Self::new(DEFAULT_WINDOW)
    }

    pub async fn record(
        &self,
        scheduled: DateTime<Utc>,
        actual: DateTime<Utc>,
        timer_id: Uuid,
        tenant_id: &str,
    ) -> JitterSample {
        let delta_ms = (actual - scheduled).num_milliseconds();
        let mut state = self.state.write().await;
        state.samples.push_back(delta_ms);
        state.sum += delta_ms as i128;
        if state.samples.len() > self.window {
            if let Some(expired) = state.samples.pop_front() {
                state.sum -= expired as i128;
            }
        }
        drop(state);
        JitterSample {
            timer_id,
            tenant_id: tenant_id.to_string(),
            delta_ms,
            recorded_at: Utc::now(),
        }
    }

    pub async fn compensation_hint_ms(&self) -> i64 {
        let state = self.state.read().await;
        if state.samples.is_empty() {
            return 0;
        }
        let average = state.sum as f64 / state.samples.len() as f64;
        average
            .round()
            .clamp(-(MAX_COMPENSATION_MS as f64), MAX_COMPENSATION_MS as f64) as i64
    }

    pub async fn adjust_fire_at(&self, now: DateTime<Utc>, target: DateTime<Utc>) -> DateTime<Utc> {
        let hint = self.compensation_hint_ms().await;
        if hint == 0 {
            return target;
        }
        let adjustment = Duration::milliseconds(hint.into());
        let candidate = target - adjustment;
        let minimum = now + Duration::milliseconds(MIN_COMPENSATED_LEAD_MS);
        if candidate < minimum {
            minimum
        } else {
            candidate
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn averages_samples_with_clamped_compensation() {
        let monitor = JitterMonitor::new(3);
        let now = Utc::now();
        let timer_id = Uuid::new_v4();
        for offset in [10, 20, 30] {
            monitor
                .record(
                    now,
                    now + Duration::milliseconds(offset),
                    timer_id,
                    "tenant",
                )
                .await;
        }
        let hint = monitor.compensation_hint_ms().await;
        assert_eq!(hint, 20);

        // Large outlier should be clamped by window and max compensation
        monitor
            .record(now, now + Duration::milliseconds(5_000), timer_id, "tenant")
            .await;
        let hint = monitor.compensation_hint_ms().await;
        assert_eq!(hint, MAX_COMPENSATION_MS);
    }

    #[tokio::test]
    async fn adjust_fire_at_never_returns_past_now() {
        let monitor = JitterMonitor::with_default_window();
        let now = Utc::now();
        let scheduled = now + Duration::milliseconds(100);
        // Introduce negative jitter to bias earlier fire time
        monitor
            .record(
                scheduled,
                scheduled - Duration::milliseconds(80),
                Uuid::new_v4(),
                "tenant",
            )
            .await;
        let adjusted = monitor.adjust_fire_at(now, scheduled).await;
        assert!(adjusted >= now + Duration::milliseconds(MIN_COMPENSATED_LEAD_MS));
    }
}
