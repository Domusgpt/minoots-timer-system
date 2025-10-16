use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use horology_kernel::replication::{RaftClusterSettings, RaftSupervisor};
use openraft::BasicNode;

async fn wait_for_condition<F>(timeout: Duration, mut condition: F) -> bool
where
    F: FnMut() -> bool,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn build_peers(entries: &[(u64, u16)]) -> HashMap<u64, BasicNode> {
    let mut peers = HashMap::new();
    for (id, port) in entries {
        peers.insert(
            *id,
            BasicNode {
                addr: format!("http://127.0.0.1:{port}"),
                ..Default::default()
            },
        );
    }
    peers
}

fn socket(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}

fn allocate_port() -> u16 {
    std::net::TcpListener::bind((IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .expect("bind ephemeral port")
        .local_addr()
        .expect("read ephemeral addr")
        .port()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn elects_and_fails_over_between_supervisors() {
    let port_a = allocate_port();
    let port_b = allocate_port();
    let port_c = allocate_port();
    let base_peers = build_peers(&[(1, port_a), (2, port_b), (3, port_c)]);

    let settings_a = RaftClusterSettings {
        node_id: 1,
        rpc_addr: socket(port_a),
        peers: base_peers.clone(),
        election_timeout_min_ms: 150,
        election_timeout_max_ms: 300,
        heartbeat_interval_ms: 60,
    };

    let settings_b = RaftClusterSettings {
        node_id: 2,
        rpc_addr: socket(port_b),
        peers: base_peers.clone(),
        election_timeout_min_ms: 150,
        election_timeout_max_ms: 300,
        heartbeat_interval_ms: 60,
    };

    let settings_c = RaftClusterSettings {
        node_id: 3,
        rpc_addr: socket(port_c),
        peers: base_peers,
        election_timeout_min_ms: 150,
        election_timeout_max_ms: 300,
        heartbeat_interval_ms: 60,
    };

    let (supervisor_a, leader_a) = RaftSupervisor::start(settings_a)
        .await
        .expect("start supervisor a");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let (supervisor_b, leader_b) = RaftSupervisor::start(settings_b)
        .await
        .expect("start supervisor b");

    let (supervisor_c, leader_c) = RaftSupervisor::start(settings_c)
        .await
        .expect("start supervisor c");

    let mut nodes = vec![
        (1_u64, supervisor_a, leader_a),
        (2_u64, supervisor_b, leader_b),
        (3_u64, supervisor_c, leader_c),
    ];

    let leader_established = wait_for_condition(Duration::from_secs(10), || {
        nodes
            .iter()
            .filter(|(_, _, handle)| handle.is_leader())
            .count()
            == 1
    })
    .await;
    assert!(leader_established, "cluster never elected a single leader");

    let leader_index = nodes
        .iter()
        .position(|(_, _, handle)| handle.is_leader())
        .expect("leader index");

    let (leader_id, leader_supervisor, leader_handle) = nodes.remove(leader_index);
    leader_supervisor
        .shutdown()
        .await
        .expect("shutdown leader supervisor");
    drop(leader_handle);

    let failover = wait_for_condition(Duration::from_secs(10), || {
        nodes
            .iter()
            .filter(|(_, _, handle)| handle.is_leader())
            .count()
            == 1
    })
    .await;
    assert!(
        failover,
        "remaining nodes did not assume leadership after shutting down {leader_id}"
    );

    let remaining_leader_count = nodes
        .iter()
        .filter(|(_, _, handle)| handle.is_leader())
        .count();
    assert_eq!(
        remaining_leader_count, 1,
        "unexpected leader count after failover"
    );

    for (id, supervisor, handle) in nodes {
        supervisor
            .shutdown()
            .await
            .unwrap_or_else(|_| panic!("shutdown supervisor {id}"));
        drop(handle);
    }
}
