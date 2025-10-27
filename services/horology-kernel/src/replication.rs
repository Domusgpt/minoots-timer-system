use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::sync::RwLock;

/// A thin abstraction that models the kernel's leadership expectations.
///
/// Phase 1 promotes deterministic writes through a replicated command log. The
/// Raft supervisor currently operates in single-node mode while exposing an
/// async API that mirrors the OpenRaft contract we plan to adopt in Phase 2.
/// This keeps the call-sites stable and lets us harden leadership checks today
/// without blocking on the full cluster implementation.
#[derive(Clone, Default)]
pub struct RaftSupervisor {
    inner: Arc<RaftState>,
}

#[derive(Default)]
struct RaftState {
    node_id: u64,
    leader_id: RwLock<Option<u64>>,
}

impl RaftSupervisor {
    pub async fn new(node_id: u64) -> Result<Self> {
        let supervisor = Self {
            inner: Arc::new(RaftState {
                node_id,
                leader_id: RwLock::new(None),
            }),
        };
        supervisor.initialize().await?;
        Ok(supervisor)
    }

    async fn initialize(&self) -> Result<()> {
        let mut leader = self.inner.leader_id.write().await;
        if leader.is_none() {
            *leader = Some(self.inner.node_id);
        }
        Ok(())
    }

    pub async fn ensure_leader(&self) -> Result<()> {
        if self.is_leader().await {
            Ok(())
        } else {
            Err(anyhow!("raft leadership not established"))
        }
    }

    pub async fn is_leader(&self) -> bool {
        let leader = self.inner.leader_id.read().await;
        matches!(*leader, Some(id) if id == self.inner.node_id)
    }

    pub async fn mark_stepdown(&self) {
        let mut leader = self.inner.leader_id.write().await;
        *leader = None;
    }

    pub async fn promote_self(&self) {
        let mut leader = self.inner.leader_id.write().await;
        *leader = Some(self.inner.node_id);
    }

    pub fn node_id(&self) -> u64 {
        self.inner.node_id
    }
}
