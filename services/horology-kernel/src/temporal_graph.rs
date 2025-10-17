use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TemporalGraphSpec {
    #[serde(default = "default_root_id")]
    pub root: String,
    #[serde(default)]
    pub nodes: Vec<TemporalGraphNode>,
}

fn default_root_id() -> String {
    "root".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TemporalGraphNode {
    pub id: String,
    #[serde(default)]
    pub after: Vec<String>,
    #[serde(default)]
    pub offset_ms: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub action_bundle: Option<Value>,
    #[serde(default)]
    pub agent_binding: Option<Value>,
}

#[derive(Clone, Default)]
pub struct TemporalGraphExecutor {
    state: Arc<RwLock<HashMap<Uuid, TemporalGraphState>>>,
}

#[derive(Clone)]
struct TemporalGraphState {
    spec: TemporalGraphSpec,
    nodes: HashMap<String, TemporalGraphNode>,
    scheduled: HashSet<String>,
    completed: HashSet<String>,
}

impl TemporalGraphState {
    fn new(spec: TemporalGraphSpec, root_node: &str) -> Self {
        let nodes = spec
            .nodes
            .iter()
            .cloned()
            .map(|node| (node.id.clone(), node))
            .collect();
        let mut scheduled = HashSet::new();
        scheduled.insert(root_node.to_string());
        Self {
            spec,
            nodes,
            scheduled,
            completed: HashSet::new(),
        }
    }

    fn mark_completed(&mut self, node_id: &str) {
        self.completed.insert(node_id.to_string());
    }

    fn ready_nodes(&mut self) -> Vec<TemporalGraphNode> {
        let mut ready = Vec::new();
        for (id, node) in self.nodes.iter() {
            if self.scheduled.contains(id) {
                continue;
            }
            let dependencies_met = node.after.iter().all(|dependency| {
                if dependency == &self.spec.root {
                    self.completed.contains(dependency)
                } else {
                    self.completed.contains(dependency)
                }
            });
            if dependencies_met {
                self.scheduled.insert(id.clone());
                ready.push(node.clone());
            }
        }
        ready
    }

    fn remove_if_finished(&self) -> bool {
        let total_nodes = self.nodes.len() + 1; // include the root node
        self.completed.len() >= total_nodes
    }
}

impl TemporalGraphExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register_root(
        &self,
        root_id: Uuid,
        spec: TemporalGraphSpec,
        root_node: String,
    ) -> Vec<TemporalGraphNode> {
        let mut graphs = self.state.write().await;
        let mut state = TemporalGraphState::new(spec, &root_node);
        let mut ready = Vec::new();
        for node in state.nodes.values() {
            if node.after.is_empty() {
                state.scheduled.insert(node.id.clone());
                ready.push(node.clone());
            }
        }
        graphs.insert(root_id, state);
        ready
    }

    pub async fn record_completion(&self, root_id: Uuid, node_id: &str) -> Vec<TemporalGraphNode> {
        let mut graphs = self.state.write().await;
        if let Some(state) = graphs.get_mut(&root_id) {
            state.mark_completed(node_id);
            let ready = state.ready_nodes();
            if state.remove_if_finished() {
                graphs.remove(&root_id);
            }
            ready
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio::runtime::Runtime;

    fn sample_spec() -> TemporalGraphSpec {
        TemporalGraphSpec {
            root: "root".to_string(),
            nodes: vec![
                TemporalGraphNode {
                    id: "a".to_string(),
                    after: vec![],
                    offset_ms: Some(50),
                    duration_ms: Some(50),
                    metadata: None,
                    labels: HashMap::new(),
                    action_bundle: None,
                    agent_binding: None,
                },
                TemporalGraphNode {
                    id: "b".to_string(),
                    after: vec!["root".to_string(), "a".to_string()],
                    offset_ms: Some(100),
                    duration_ms: Some(100),
                    metadata: None,
                    labels: HashMap::new(),
                    action_bundle: None,
                    agent_binding: None,
                },
            ],
        }
    }

    #[test]
    fn register_root_returns_independent_nodes() {
        let runtime = Runtime::new().expect("runtime");
        runtime.block_on(async {
            let executor = TemporalGraphExecutor::new();
            let root_id = Uuid::new_v4();
            let ready = executor
                .register_root(root_id, sample_spec(), "root".to_string())
                .await;
            assert_eq!(ready.len(), 1);
            assert_eq!(ready[0].id, "a");
        });
    }

    #[test]
    fn completing_dependencies_unlocks_nodes() {
        let runtime = Runtime::new().expect("runtime");
        runtime.block_on(async {
            let executor = TemporalGraphExecutor::new();
            let root_id = Uuid::new_v4();
            executor
                .register_root(root_id, sample_spec(), "root".to_string())
                .await;
            let after_root = executor.record_completion(root_id, "root").await;
            // still waiting on node "a"
            assert!(after_root.is_empty());

            let ready = executor.record_completion(root_id, "a").await;
            assert_eq!(ready.len(), 1);
            assert_eq!(ready[0].id, "b");

            // completed nodes should be evicted from internal state
            let nothing_left = executor.record_completion(root_id, "b").await;
            assert!(nothing_left.is_empty());
        });
    }
}
