use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;

use crate::command::{CommandEntry, TimerCommand};

#[async_trait]
pub trait CommandLog: Send + Sync + 'static {
    async fn append(&self, command: &TimerCommand) -> Result<CommandEntry>;
    async fn load_all(&self) -> Result<Vec<CommandEntry>>;
}

#[derive(Clone, Default)]
pub struct InMemoryCommandLog {
    entries: Arc<tokio::sync::Mutex<Vec<CommandEntry>>>,
    counter: Arc<AtomicI64>,
}

impl InMemoryCommandLog {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CommandLog for InMemoryCommandLog {
    async fn append(&self, command: &TimerCommand) -> Result<CommandEntry> {
        let mut entries = self.entries.lock().await;
        let seq = self.counter.fetch_add(1, Ordering::SeqCst) + 1;
        let entry = CommandEntry {
            sequence: seq,
            command: command.clone(),
            created_at: chrono::Utc::now(),
        };
        entries.push(entry.clone());
        Ok(entry)
    }

    async fn load_all(&self) -> Result<Vec<CommandEntry>> {
        let entries = self.entries.lock().await;
        Ok(entries.clone())
    }
}

pub type SharedCommandLog = Arc<dyn CommandLog>;
