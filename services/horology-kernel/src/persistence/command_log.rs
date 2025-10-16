use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use uuid::Uuid;

use crate::TimerInstance;

#[derive(Debug, Serialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum CommandRecord {
    Schedule { timer: TimerInstance },
    Cancel { timer: TimerInstance },
    Fire { timer_id: Uuid, tenant_id: String, fired_at: String },
    Settle { timer: TimerInstance },
}

#[async_trait]
pub trait CommandLog: Send + Sync + 'static {
    async fn append(&self, record: &CommandRecord) -> Result<()>;
}

pub type SharedCommandLog = Arc<dyn CommandLog>;
