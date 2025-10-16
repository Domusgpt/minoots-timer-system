use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;

use crate::TimerInstance;

#[async_trait]
pub trait TimerStore: Send + Sync + 'static {
    async fn load_active(&self) -> Result<Vec<TimerInstance>>;
    async fn upsert(&self, timer: &TimerInstance) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct InMemoryTimerStore;

#[async_trait]
impl TimerStore for InMemoryTimerStore {
    async fn load_active(&self) -> Result<Vec<TimerInstance>> {
        Ok(Vec::new())
    }

    async fn upsert(&self, _timer: &TimerInstance) -> Result<()> {
        Ok(())
    }
}

pub type SharedTimerStore = Arc<dyn TimerStore>;

pub mod command_log;
pub mod postgres;
