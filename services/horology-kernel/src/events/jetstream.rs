use anyhow::{anyhow, Context, Result};
use async_nats::jetstream::{
    self,
    context::{GetStreamError, PublishError as JetStreamAckError},
};
use async_trait::async_trait;
use tokio::{sync::broadcast, task::JoinHandle};
use tracing::{error, info, warn};

use crate::EventEnvelope;

#[derive(Clone, Debug)]
pub struct JetStreamForwarderConfig {
    pub servers: String,
    pub subject: String,
    pub stream: Option<String>,
}

pub async fn spawn_forwarder(
    config: JetStreamForwarderConfig,
    receiver: broadcast::Receiver<EventEnvelope>,
) -> Result<JoinHandle<()>> {
    let connection = async_nats::connect(&config.servers)
        .await
        .with_context(|| format!("failed to connect to NATS at {}", config.servers))?;
    let jetstream = jetstream::new(connection.clone());
    let subject = config.subject;
    let stream = config.stream.clone();
    let client = RealJetStreamClient::new(connection, jetstream);

    Ok(spawn_forwarder_with_client(
        subject, stream, receiver, client,
    ))
}

fn spawn_forwarder_with_client<C>(
    subject: String,
    stream: Option<String>,
    receiver: broadcast::Receiver<EventEnvelope>,
    client: C,
) -> JoinHandle<()>
where
    C: JetStreamClient + Send + Sync + 'static,
{
    tokio::spawn(async move {
        if let Some(stream_name) = stream.as_deref() {
            match client.ensure_stream(stream_name).await {
                Ok(_) => info!(
                    stream = %stream_name,
                    subject = %subject,
                    "JetStream forwarder connected"
                ),
                Err(error) => warn!(
                    ?error,
                    stream = %stream_name,
                    subject = %subject,
                    "Failed to fetch JetStream stream info"
                ),
            }
        } else {
            info!(subject = %subject, "JetStream forwarder connected (stream not specified)");
        }

        let mut receiver = receiver;
        loop {
            match receiver.recv().await {
                Ok(envelope) => match encode_envelope(&envelope) {
                    Ok(payload) => match client.publish(&subject, payload).await {
                        Ok(()) => {}
                        Err(PublishError::Ack(error)) => {
                            warn!(?error, subject = %subject, "JetStream publish ack failed");
                        }
                        Err(PublishError::Request(error)) => {
                            error!(?error, subject = %subject, "Failed to publish timer envelope to JetStream");
                        }
                    },
                    Err(error) => {
                        error!(?error, subject = %subject, "Failed to encode timer envelope for JetStream");
                    }
                },
                Err(broadcast::error::RecvError::Closed) => {
                    info!(subject = %subject, "JetStream forwarder exiting; channel closed");
                    break;
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(skipped, subject = %subject, "JetStream forwarder lagged; skipping envelopes");
                }
            }
        }
    })
}

#[async_trait]
trait JetStreamClient {
    async fn ensure_stream(&self, stream: &str) -> Result<(), EnsureStreamError>;
    async fn publish(&self, subject: &str, payload: Vec<u8>) -> Result<(), PublishError>;
}

#[derive(Clone)]
struct RealJetStreamClient {
    #[allow(dead_code)]
    connection: async_nats::Client,
    context: jetstream::Context,
}

impl RealJetStreamClient {
    fn new(connection: async_nats::Client, context: jetstream::Context) -> Self {
        Self {
            connection,
            context,
        }
    }
}

#[async_trait]
impl JetStreamClient for RealJetStreamClient {
    async fn ensure_stream(&self, stream: &str) -> Result<(), EnsureStreamError> {
        self.context.get_stream(stream).await?;
        Ok(())
    }

    async fn publish(&self, subject: &str, payload: Vec<u8>) -> Result<(), PublishError> {
        let ack = self
            .context
            .publish(subject.to_string(), payload.into())
            .await?;
        ack.await?;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
enum EnsureStreamError {
    #[error("failed to fetch stream info")]
    Fetch(#[from] GetStreamError),
}

#[derive(Debug, thiserror::Error)]
enum PublishError {
    #[error("publish request failed")]
    Request(#[from] async_nats::Error),
    #[error("publish ack failed")]
    Ack(#[from] JetStreamAckError),
}

fn encode_envelope(envelope: &EventEnvelope) -> Result<Vec<u8>> {
    serde_json::to_vec(envelope)
        .map_err(|error| anyhow!("failed to serialize event envelope: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EventSigner, TimerEvent, TimerInstance, TimerStatus};
    use chrono::{TimeZone, Utc};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{Mutex, Notify};
    use tokio::time::timeout;
    use uuid::Uuid;

    #[tokio::test]
    async fn encode_envelope_produces_canonical_json() {
        let timer = TimerInstance {
            id: Uuid::nil(),
            tenant_id: "tenant".into(),
            requested_by: "tester".into(),
            name: "sample".into(),
            duration_ms: 1000,
            created_at: Utc.timestamp_nanos(0),
            fire_at: Utc.timestamp_nanos(1_000_000_000),
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
            graph_root_id: None,
            graph_node_id: None,
            temporal_graph: None,
            jitter_policy: None,
        };
        let signer = EventSigner::insecure_dev();
        let envelope = signer
            .sign_event(TimerEvent::Scheduled(timer))
            .expect("sign envelope");

        let bytes = encode_envelope(&envelope).expect("serialize envelope");
        let decoded: serde_json::Value = serde_json::from_slice(&bytes).expect("valid json");
        assert_eq!(decoded["tenant_id"], "tenant");
        assert_eq!(decoded["signature_version"], "v1-hmac-sha256");
        assert_eq!(
            decoded["event"]["type"],
            serde_json::Value::String("Scheduled".into())
        );
    }

    #[tokio::test]
    async fn forwarder_publishes_envelopes_via_client() {
        let client = RecordingClient::new();
        let (sender, receiver) = broadcast::channel(16);
        let subject = "MINOOTS_TIMER.events".to_string();
        let stream_name = "MINOOTS_TIMER".to_string();
        let handle = spawn_forwarder_with_client(
            subject.clone(),
            Some(stream_name.clone()),
            receiver,
            client.clone(),
        );

        let timer = TimerInstance {
            id: Uuid::nil(),
            tenant_id: "tenant".into(),
            requested_by: "tester".into(),
            name: "sample".into(),
            duration_ms: 1000,
            created_at: Utc.timestamp_nanos(0),
            fire_at: Utc.timestamp_nanos(1_000_000_000),
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
            graph_root_id: None,
            graph_node_id: None,
            temporal_graph: None,
            jitter_policy: None,
        };
        let signer = EventSigner::insecure_dev();
        let envelope = signer
            .sign_event(TimerEvent::Scheduled(timer))
            .expect("sign envelope");
        sender.send(envelope).expect("forward envelope");

        timeout(Duration::from_secs(1), client.wait_for_publish())
            .await
            .expect("forwarder to publish");
        let published = client.published().await;
        assert_eq!(published.len(), 1);
        assert_eq!(published[0].0, subject);
        let decoded: EventEnvelope =
            serde_json::from_slice(&published[0].1).expect("valid envelope payload");
        assert_eq!(decoded.signature_version, "v1-hmac-sha256");

        let ensured = client.ensured_streams().await;
        assert_eq!(ensured, vec![stream_name]);

        drop(sender);
        timeout(Duration::from_secs(1), handle)
            .await
            .expect("forwarder to exit")
            .expect("forwarder task panicked");
    }

    #[derive(Clone)]
    struct RecordingClient {
        published: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
        ensured: Arc<Mutex<Vec<String>>>,
        notify: Arc<Notify>,
    }

    impl RecordingClient {
        fn new() -> Self {
            Self {
                published: Arc::new(Mutex::new(Vec::new())),
                ensured: Arc::new(Mutex::new(Vec::new())),
                notify: Arc::new(Notify::new()),
            }
        }

        async fn wait_for_publish(&self) {
            self.notify.notified().await;
        }

        async fn published(&self) -> Vec<(String, Vec<u8>)> {
            self.published.lock().await.clone()
        }

        async fn ensured_streams(&self) -> Vec<String> {
            self.ensured.lock().await.clone()
        }
    }

    #[async_trait]
    impl JetStreamClient for RecordingClient {
        async fn ensure_stream(&self, stream: &str) -> Result<(), EnsureStreamError> {
            self.ensured.lock().await.push(stream.to_string());
            Ok(())
        }

        async fn publish(&self, subject: &str, payload: Vec<u8>) -> Result<(), PublishError> {
            self.published
                .lock()
                .await
                .push((subject.to_string(), payload));
            self.notify.notify_one();
            Ok(())
        }
    }
}
