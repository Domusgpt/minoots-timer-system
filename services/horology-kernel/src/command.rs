use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::TimerInstance;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TimerCommand {
    Schedule {
        timer: TimerInstance,
    },
    Cancel {
        timer_id: Uuid,
        tenant_id: String,
        cancelled_by: Option<String>,
        reason: Option<String>,
        at: DateTime<Utc>,
    },
    Fire {
        timer_id: Uuid,
        tenant_id: String,
        at: DateTime<Utc>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandEntry {
    pub sequence: i64,
    pub command: TimerCommand,
    pub created_at: DateTime<Utc>,
}

impl TimerCommand {
    pub fn timer_id(&self) -> Uuid {
        match self {
            TimerCommand::Schedule { timer } => timer.id,
            TimerCommand::Cancel { timer_id, .. } => *timer_id,
            TimerCommand::Fire { timer_id, .. } => *timer_id,
        }
    }

    pub fn tenant_id(&self) -> &str {
        match self {
            TimerCommand::Schedule { timer } => &timer.tenant_id,
            TimerCommand::Cancel { tenant_id, .. } => tenant_id,
            TimerCommand::Fire { tenant_id, .. } => tenant_id,
        }
    }
}
