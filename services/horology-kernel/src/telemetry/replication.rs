use once_cell::sync::Lazy;
use opentelemetry::{global, metrics::Counter, KeyValue};

static COORDINATOR_METRICS: Lazy<CoordinatorMetrics> = Lazy::new(|| {
    let meter = global::meter("horology-kernel.replication");
    CoordinatorMetrics {
        election_attempts: meter
            .u64_counter("kernel.coordinator.election.attempts")
            .with_description("Number of election rounds started by this node")
            .init(),
        election_results: meter
            .u64_counter("kernel.coordinator.election.results")
            .with_description("Outcome of coordinator election rounds")
            .init(),
        leadership_transitions: meter
            .u64_counter("kernel.coordinator.leadership.transitions")
            .with_description("Leadership transitions observed by this node")
            .init(),
        heartbeat_results: meter
            .u64_counter("kernel.coordinator.heartbeat.results")
            .with_description("Heartbeat publication outcomes")
            .init(),
    }
});

struct CoordinatorMetrics {
    election_attempts: Counter<u64>,
    election_results: Counter<u64>,
    leadership_transitions: Counter<u64>,
    heartbeat_results: Counter<u64>,
}

#[derive(Clone, Copy)]
pub enum ElectionResult {
    Retained,
    HeartbeatRefresh,
    PeerHealthy,
    Won,
    Contended,
    Initialized,
    Error,
}

#[derive(Clone, Copy)]
pub enum LeadershipState {
    Leader,
    Follower,
}

#[derive(Clone, Copy)]
pub enum HeartbeatOutcome {
    Ok,
    Error,
}

pub fn record_election_attempt(node_id: &str) {
    COORDINATOR_METRICS
        .election_attempts
        .add(1, &[KeyValue::new("node_id", node_id.to_string())]);
}

pub fn record_election_result(node_id: &str, result: ElectionResult) {
    COORDINATOR_METRICS.election_results.add(
        1,
        &[
            KeyValue::new("node_id", node_id.to_string()),
            KeyValue::new("result", election_result_value(result)),
        ],
    );
}

pub fn record_leadership_transition(node_id: &str, state: LeadershipState) {
    COORDINATOR_METRICS.leadership_transitions.add(
        1,
        &[
            KeyValue::new("node_id", node_id.to_string()),
            KeyValue::new("state", leadership_state_value(state)),
        ],
    );
}

pub fn record_heartbeat_outcome(node_id: &str, outcome: HeartbeatOutcome) {
    COORDINATOR_METRICS.heartbeat_results.add(
        1,
        &[
            KeyValue::new("node_id", node_id.to_string()),
            KeyValue::new("outcome", heartbeat_outcome_value(outcome)),
        ],
    );
}

fn election_result_value(result: ElectionResult) -> &'static str {
    match result {
        ElectionResult::Retained => "retained",
        ElectionResult::HeartbeatRefresh => "heartbeat_refresh",
        ElectionResult::PeerHealthy => "peer_healthy",
        ElectionResult::Won => "won",
        ElectionResult::Contended => "contended",
        ElectionResult::Initialized => "initialized",
        ElectionResult::Error => "error",
    }
}

fn leadership_state_value(state: LeadershipState) -> &'static str {
    match state {
        LeadershipState::Leader => "leader",
        LeadershipState::Follower => "follower",
    }
}

fn heartbeat_outcome_value(outcome: HeartbeatOutcome) -> &'static str {
    match outcome {
        HeartbeatOutcome::Ok => "ok",
        HeartbeatOutcome::Error => "error",
    }
}
