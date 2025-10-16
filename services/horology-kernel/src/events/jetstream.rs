use anyhow::{anyhow, Context, Result};
use async_nats::jetstream;
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

    let handle = tokio::spawn(async move {
        let mut receiver = receiver;
        let connection = connection; // keep connection alive for task lifetime
        let jetstream = jetstream;
        if let Some(stream_name) = stream.clone() {
            match jetstream.get_stream(&stream_name).await {
                Ok(_) => {
                    info!(stream = %stream_name, subject = %subject, "JetStream forwarder connected")
                }
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

        loop {
            match receiver.recv().await {
                Ok(envelope) => match encode_envelope(&envelope) {
                    Ok(payload) => match jetstream.publish(subject.clone(), payload.into()).await {
                        Ok(ack) => {
                            if let Err(error) = ack.await {
                                warn!(?error, subject = %subject, "JetStream publish ack failed");
                            }
                        }
                        Err(error) => {
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

        drop(connection);
    });

    Ok(handle)
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
}
