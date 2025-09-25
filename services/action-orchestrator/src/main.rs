use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TimerEvent {
    #[serde(rename = "type")]
    event_type: String,
    timer_id: String,
    tenant_id: String,
    name: String,
    fired_at: DateTime<Utc>,
    actions: Vec<TimerAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TimerAction {
    #[serde(rename = "type")]
    action_type: String,
    url: Option<String>,
    command: Option<String>,
    data: serde_json::Value,
}

#[derive(Clone)]
struct ActionOrchestrator {
    client: reqwest::Client,
}

impl ActionOrchestrator {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self { client }
    }

    async fn execute_webhook(&self, url: &str, event: &TimerEvent) -> Result<()> {
        let payload = serde_json::json!({
            "event": "timer.fired",
            "timer_id": event.timer_id,
            "tenant_id": event.tenant_id,
            "timer_name": event.name,
            "fired_at": event.fired_at,
            "data": event
        });

        info!("Executing webhook: {} for timer {}", url, event.timer_id);

        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "MINOOTS-ActionOrchestrator/1.0")
            .json(&payload)
            .send()
            .await
            .context("Failed to send webhook request")?;

        let status = response.status();

        if status.is_success() {
            info!("Webhook successful: {} (status: {})", url, status);
        } else {
            let body = response.text().await.unwrap_or_default();
            warn!("Webhook failed: {} (status: {}, body: {})", url, status, body);
        }

        Ok(())
    }

    async fn execute_command(&self, command: &str, event: &TimerEvent) -> Result<()> {
        // 🚨 SECURITY: Command execution is DISABLED by default to prevent injection attacks
        // To enable commands, set MINOOTS_ALLOW_COMMANDS=true environment variable
        // and implement proper command validation/sandboxing

        if std::env::var("MINOOTS_ALLOW_COMMANDS").is_err() {
            warn!("Command execution disabled for security. Command was: {}", command);
            return Err(anyhow::anyhow!(
                "Command execution disabled. Set MINOOTS_ALLOW_COMMANDS=true to enable (NOT recommended in production)"
            ));
        }

        // Additional security validation
        if command.contains("rm ") || command.contains("sudo ") || command.contains("curl ")
           || command.contains("wget ") || command.contains(">/") || command.contains("&")
           || command.contains("|") || command.contains(";") {
            warn!("Command contains potentially dangerous operations: {}", command);
            return Err(anyhow::anyhow!("Command contains forbidden operations"));
        }

        info!("⚠️  SECURITY WARNING: Executing command: {} for timer {}", command, event.timer_id);

        // Use a more restricted approach - only allow specific whitelisted commands
        let allowed_commands = ["echo", "date", "sleep"];
        let cmd_parts: Vec<&str> = command.split_whitespace().collect();
        if cmd_parts.is_empty() || !allowed_commands.contains(&cmd_parts[0]) {
            warn!("Command not in whitelist: {}", command);
            return Err(anyhow::anyhow!("Command not in allowed whitelist"));
        }

        let output = tokio::process::Command::new(cmd_parts[0])
            .args(&cmd_parts[1..])
            .env("TIMER_ID", &event.timer_id)
            .env("TIMER_NAME", &event.name)
            .env("TENANT_ID", &event.tenant_id)
            .env("FIRED_AT", event.fired_at.to_rfc3339())
            .output()
            .await
            .context("Failed to execute command")?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            info!("Command successful: {} (output: {})", command, stdout.trim());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("Command failed: {} (stderr: {})", command, stderr);
        }

        Ok(())
    }

    async fn process_actions(&self, event: TimerEvent) {
        info!("Processing {} actions for timer {}", event.actions.len(), event.timer_id);

        for action in &event.actions {
            let result = match action.action_type.as_str() {
                "webhook" => {
                    if let Some(url) = &action.url {
                        self.execute_webhook(url, &event).await
                    } else {
                        warn!("Webhook action missing URL for timer {}", event.timer_id);
                        continue;
                    }
                }
                "command" => {
                    if let Some(command) = &action.command {
                        self.execute_command(command, &event).await
                    } else {
                        warn!("Command action missing command for timer {}", event.timer_id);
                        continue;
                    }
                }
                _ => {
                    warn!("Unknown action type: {} for timer {}", action.action_type, event.timer_id);
                    continue;
                }
            };

            if let Err(e) = result {
                error!("Action execution failed: {} (timer: {})", e, event.timer_id);
                // TODO: Add retry logic here
            }
        }

        info!("Completed processing actions for timer {}", event.timer_id);
    }
}

async fn simulate_timer_events(orchestrator: ActionOrchestrator) {
    info!("Starting timer event simulation...");

    let mut interval = tokio::time::interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        // Simulate a timer event
        let event = TimerEvent {
            event_type: "timer.fired".to_string(),
            timer_id: Uuid::new_v4().to_string(),
            tenant_id: "demo".to_string(),
            name: "demo-timer".to_string(),
            fired_at: Utc::now(),
            actions: vec![
                TimerAction {
                    action_type: "webhook".to_string(),
                    url: Some("https://webhook.site/your-webhook-url".to_string()),
                    command: None,
                    data: serde_json::json!({"message": "Timer fired successfully!"}),
                },
                // Command execution disabled by default for security
                // TimerAction {
                //     action_type: "command".to_string(),
                //     url: None,
                //     command: Some("echo Timer completed".to_string()),
                //     data: serde_json::json!({}),
                // },
            ],
        };

        orchestrator.process_actions(event).await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    info!("Starting MINOOTS Action Orchestrator");

    let orchestrator = ActionOrchestrator::new();

    // TODO: Replace simulation with actual kernel event subscription
    if std::env::var("DEMO_MODE").is_ok() {
        info!("Running in demo mode - simulating timer events");
        simulate_timer_events(orchestrator).await;
    } else {
        info!("Production mode - connecting to horology kernel");
        // TODO: Implement gRPC client to subscribe to kernel events
        loop {
            info!("Waiting for kernel events...");
            sleep(Duration::from_secs(60)).await;
        }
    }

    Ok(())
}