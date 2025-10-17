use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JitterPolicy {
    pub max_compensation_ms: u64,
    #[serde(default = "default_smoothing")]
    pub smoothing_factor: f64,
}

fn default_smoothing() -> f64 {
    0.2
}

impl Default for JitterPolicy {
    fn default() -> Self {
        Self {
            max_compensation_ms: 0,
            smoothing_factor: default_smoothing(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::runtime::Runtime;

    #[test]
    fn records_samples_and_tracks_ema() {
        let runtime = Runtime::new().expect("runtime");
        runtime.block_on(async {
            let monitor = JitterMonitor::new();
            let first = monitor.record(42, None).await;
            assert_eq!(first.observed_ms, 42);
            assert_eq!(first.ema_ms, 42.0);

            let policy = JitterPolicy {
                max_compensation_ms: 150,
                smoothing_factor: 0.5,
            };
            let second = monitor.record(100, Some(&policy)).await;
            assert_eq!(second.observed_ms, 100);
            // ema should be halfway between 42 and 100 due to smoothing factor 0.5
            assert!((second.ema_ms - 71.0).abs() < f64::EPSILON);
        });
    }

    #[test]
    fn compensation_is_capped_by_policy() {
        let runtime = Runtime::new().expect("runtime");
        runtime.block_on(async {
            let monitor = JitterMonitor::new();
            let policy = JitterPolicy {
                max_compensation_ms: 80,
                smoothing_factor: 0.3,
            };
            monitor.record(120, Some(&policy)).await;
            let compensation = monitor.compensation_ms(&policy).await;
            assert_eq!(compensation, 80);
        });
    }
}

#[derive(Default, Clone)]
pub struct JitterMonitor {
    stats: Arc<RwLock<JitterStats>>,
}

#[derive(Default, Clone)]
struct JitterStats {
    ema_ms: f64,
    last_observed_ms: i64,
    samples: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct JitterSnapshot {
    pub observed_ms: i64,
    pub ema_ms: f64,
}

impl JitterMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn record(&self, jitter_ms: i64, policy: Option<&JitterPolicy>) -> JitterSnapshot {
        let mut stats = self.stats.write().await;
        stats.last_observed_ms = jitter_ms;
        stats.samples += 1;
        let smoothing = policy
            .map(|p| p.smoothing_factor)
            .unwrap_or(default_smoothing());
        if stats.samples == 1 {
            stats.ema_ms = jitter_ms as f64;
        } else {
            stats.ema_ms = smoothing * (jitter_ms as f64) + (1.0 - smoothing) * stats.ema_ms;
        }
        JitterSnapshot {
            observed_ms: jitter_ms,
            ema_ms: stats.ema_ms,
        }
    }

    pub async fn compensation_ms(&self, policy: &JitterPolicy) -> i64 {
        let stats = self.stats.read().await;
        let ema = stats.ema_ms;
        if ema <= 0.0 {
            return 0;
        }
        ema.min(policy.max_compensation_ms as f64) as i64
    }
}
