use std::fmt;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use async_nats::jetstream::{self, consumer, stream};
use futures::StreamExt;
use tempfile::{NamedTempFile, TempDir};
use tokio::sync::broadcast;
use tokio::time::timeout;

use horology_kernel::events::jetstream::{spawn_forwarder, JetStreamForwarderConfig};
use horology_kernel::{EventEnvelope, EventSigner, TimerEvent, TimerInstance, TimerStatus};
use uuid::Uuid;

const SUBJECT: &str = "MINOOTS_TIMER.events";
const STREAM: &str = "MINOOTS_TIMER";

#[tokio::test]
async fn jetstream_forwarder_publishes_to_real_server() -> Result<()> {
    let server = match NatsServer::spawn() {
        Ok(server) => server,
        Err(ServerSpawnError::BinaryUnavailable) => {
            eprintln!("skipping jetstream integration test: nats-server binary unavailable");
            return Ok(());
        }
        Err(other) => return Err(anyhow!(other)),
    };

    let client = async_nats::connect(server.client_url())
        .await
        .context("connect to nats")?;
    let jetstream = jetstream::new(client.clone());

    jetstream
        .get_or_create_stream(stream::Config {
            name: STREAM.to_string(),
            subjects: vec![SUBJECT.to_string()],
            ..Default::default()
        })
        .await
        .context("ensure jetstream stream")?;

    let (sender, receiver) = broadcast::channel(16);
    let forwarder = spawn_forwarder(
        JetStreamForwarderConfig {
            servers: server.client_url().to_string(),
            subject: SUBJECT.to_string(),
            stream: Some(STREAM.to_string()),
        },
        receiver,
    )
    .await
    .context("spawn jetstream forwarder")?;

    let stream = jetstream
        .get_stream(STREAM)
        .await
        .context("fetch stream info")?;
    let consumer = stream
        .get_or_create_consumer(
            "integration",
            consumer::pull::Config {
                durable_name: Some("integration".into()),
                ack_policy: consumer::AckPolicy::Explicit,
                ..Default::default()
            },
        )
        .await
        .context("create durable consumer")?;

    let timer = TimerInstance {
        id: Uuid::new_v4(),
        tenant_id: "tenant-integration".into(),
        requested_by: "jetstream-harness".into(),
        name: "integration".into(),
        duration_ms: 1_000,
        created_at: chrono::Utc::now(),
        fire_at: chrono::Utc::now() + chrono::Duration::milliseconds(1_000),
        status: TimerStatus::Scheduled,
        metadata: None,
        labels: Default::default(),
        action_bundle: None,
        agent_binding: None,
        fired_at: None,
        cancelled_at: None,
        cancel_reason: None,
        cancelled_by: None,
        settled_at: None,
        failure_reason: None,
        state_version: 0,
        jitter_ms: None,
    };
    let signer = EventSigner::insecure_dev();
    let envelope = signer
        .sign_event(TimerEvent::Scheduled(timer))
        .context("sign envelope")?;
    sender
        .send(envelope.clone())
        .expect("forward envelope to jetstream task");
    drop(sender);

    let mut messages = consumer
        .messages()
        .await
        .context("open consumer message stream")?
        .take(1);

    let message = timeout(Duration::from_secs(5), messages.next())
        .await
        .context("await jetstream delivery")?
        .context("message expected")?
        .context("jetstream poll error")?;

    let payload: EventEnvelope =
        serde_json::from_slice(&message.payload).context("decode envelope payload")?;
    assert_eq!(payload.event_type(), envelope.event_type());
    assert_eq!(payload.tenant_id, envelope.tenant_id);
    signer
        .verify(&payload)
        .expect("forwarded envelope must retain valid signature");

    message.ack().await.expect("ack jetstream message");

    forwarder.await.expect("forwarder task join");

    Ok(())
}

#[derive(Debug)]
enum ServerSpawnError {
    BinaryUnavailable,
    Io(std::io::Error),
    StartTimeout,
    EarlyExit(Option<i32>),
}

impl fmt::Display for ServerSpawnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServerSpawnError::BinaryUnavailable => write!(f, "nats-server binary not available"),
            ServerSpawnError::Io(error) => write!(f, "io error: {error}"),
            ServerSpawnError::StartTimeout => write!(f, "nats-server did not start before timeout"),
            ServerSpawnError::EarlyExit(code) => {
                write!(f, "nats-server exited prematurely with status {:?}", code)
            }
        }
    }
}

impl std::error::Error for ServerSpawnError {}

impl From<std::io::Error> for ServerSpawnError {
    fn from(value: std::io::Error) -> Self {
        ServerSpawnError::Io(value)
    }
}

struct NatsServer {
    child: Child,
    _config: NamedTempFile,
    _store_dir: TempDir,
    addr: SocketAddr,
}

impl NatsServer {
    fn spawn() -> Result<Self, ServerSpawnError> {
        let bin = locate_binary()?;
        let addr = allocate_addr()?;
        let store_dir = TempDir::new()?;
        let mut config = NamedTempFile::new()?;
        write_config(config.as_file_mut(), addr.port(), store_dir.path())?;

        let mut child = Command::new(bin)
            .arg("-c")
            .arg(config.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        wait_for_start(addr.port(), &mut child)?;

        Ok(Self {
            child,
            _config: config,
            _store_dir: store_dir,
            addr,
        })
    }

    fn client_url(&self) -> String {
        format!("{}:{}", self.addr.ip(), self.addr.port())
    }
}

impl Drop for NatsServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn locate_binary() -> Result<PathBuf, ServerSpawnError> {
    if let Ok(path) = std::env::var("NATS_SERVER_BIN") {
        return Ok(PathBuf::from(path));
    }

    if let Ok(path) = which::which("nats-server") {
        return Ok(path);
    }

    Err(ServerSpawnError::BinaryUnavailable)
}

fn allocate_addr() -> Result<SocketAddr, ServerSpawnError> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    drop(listener);
    Ok(addr)
}

fn write_config(
    file: &mut std::fs::File,
    port: u16,
    store_dir: &Path,
) -> Result<(), ServerSpawnError> {
    use std::io::Write;

    writeln!(
        file,
        "server_name: integration\nport: {port}\njetstream {{\n  store_dir: \"{}\"\n  max_file_store: 128MB\n  max_memory_store: 64MB\n}}",
        store_dir.display()
    )?;
    Ok(())
}

fn wait_for_start(port: u16, child: &mut Child) -> Result<(), ServerSpawnError> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err(ServerSpawnError::StartTimeout);
        }

        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(_) => return Ok(()),
            Err(_) => {
                if let Some(status) = child.try_wait().map_err(ServerSpawnError::Io)? {
                    return Err(ServerSpawnError::EarlyExit(status.code()));
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}
