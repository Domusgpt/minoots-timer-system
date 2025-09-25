# 🤖 AI Agent Integration Guide

**MINOOTS Timer System for Autonomous Agents & AI Workflows**

Perfect for AI agents that need reliable timing, delays, and timeout handling.

---

## 🎯 Why AI Agents Need MINOOTS

### Common AI Agent Timing Challenges:
- ⏰ **Task timeouts** - Stop runaway processes
- 🔄 **Retry delays** - Wait before retrying failed operations
- 📅 **Scheduled actions** - Trigger periodic tasks
- 🚨 **Watchdog timers** - Detect stuck/crashed agents
- ⏸️ **Rate limiting** - Delay between API calls
- 🎭 **Multi-agent coordination** - Synchronize agent activities

### MINOOTS Solutions:
- ✅ **Sub-millisecond scheduling** - Ultra-fast timer creation
- ✅ **Webhook notifications** - Instant callback to your agent
- ✅ **High concurrency** - 100k+ timers per instance
- ✅ **Reliable delivery** - Rust-powered core, no missed timers
- ✅ **Simple API** - One HTTP call creates timer

---

## 🚀 Quick Agent Examples

### Python AI Agent with Timeout
```python
import requests
import time
from typing import Optional

class AIAgent:
    def __init__(self, agent_id: str, api_key: str):
        self.agent_id = agent_id
        self.api_key = api_key
        self.timer_base_url = "http://localhost:3000"

    def create_timeout_timer(self, task_id: str, timeout_seconds: int,
                           webhook_url: str) -> Optional[str]:
        """Create a timeout timer for a long-running task"""

        response = requests.post(f"{self.timer_base_url}/timers",
            headers={"X-API-Key": self.api_key},
            json={
                "tenantId": self.agent_id,
                "requestedBy": f"agent-{self.agent_id}",
                "name": f"timeout-{task_id}",
                "duration": f"{timeout_seconds}s",
                "metadata": {
                    "task_id": task_id,
                    "agent_id": self.agent_id,
                    "timeout_type": "task_timeout"
                },
                "actionBundle": {
                    "actions": [{
                        "type": "webhook",
                        "url": webhook_url,
                        "data": {
                            "event": "task_timeout",
                            "task_id": task_id,
                            "agent_id": self.agent_id,
                            "action": "force_stop"
                        }
                    }]
                }
            }
        )

        if response.status_code == 201:
            timer_data = response.json()
            print(f"✅ Timeout timer created: {timer_data['timer']['id']}")
            return timer_data['timer']['id']
        else:
            print(f"❌ Failed to create timer: {response.text}")
            return None

    def cancel_timeout_timer(self, timer_id: str) -> bool:
        """Cancel a timeout timer when task completes normally"""

        response = requests.post(f"{self.timer_base_url}/timers/{timer_id}/cancel",
            headers={"X-API-Key": self.api_key},
            json={
                "tenantId": self.agent_id,
                "reason": "Task completed successfully",
                "requestedBy": f"agent-{self.agent_id}"
            }
        )

        return response.status_code == 200

    def long_running_task_with_timeout(self, task_id: str, timeout_minutes: int):
        """Execute a task with automatic timeout protection"""

        webhook_url = f"https://your-agent-system.com/timeout/{self.agent_id}"
        timer_id = self.create_timeout_timer(task_id, timeout_minutes * 60, webhook_url)

        try:
            # Simulate long-running AI task
            print(f"🤖 Starting task {task_id} with {timeout_minutes}min timeout")

            # Your AI processing here...
            # model.generate(), database.query(), api.call(), etc.
            time.sleep(5)  # Simulated work

            print(f"✅ Task {task_id} completed successfully")

            # Cancel timeout since task finished
            if timer_id:
                self.cancel_timeout_timer(timer_id)

        except Exception as e:
            print(f"❌ Task {task_id} failed: {e}")
            # Timer will still fire and trigger cleanup

# Usage
agent = AIAgent(agent_id="gpt-worker-1", api_key="mnt_demo_key_pro")
agent.long_running_task_with_timeout("analyze-dataset-001", timeout_minutes=15)
```

### Node.js Agent Coordination
```javascript
class MultiAgentCoordinator {
    constructor(coordinatorId, apiKey) {
        this.coordinatorId = coordinatorId;
        this.apiKey = apiKey;
        this.timerBaseUrl = "http://localhost:3000";
    }

    async synchronizeAgents(agentIds, delaySeconds, callbackUrl) {
        /**
         * Create synchronized timers for multiple agents
         * All agents will receive webhook at the same time
         */

        const timers = [];

        for (const agentId of agentIds) {
            const response = await fetch(`${this.timerBaseUrl}/timers`, {
                method: 'POST',
                headers: {
                    'X-API-Key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: this.coordinatorId,
                    requestedBy: `coordinator-${this.coordinatorId}`,
                    name: `sync-${agentId}-${Date.now()}`,
                    duration: `${delaySeconds}s`,
                    metadata: {
                        sync_group: "multi-agent-task",
                        target_agent: agentId,
                        coordinator: this.coordinatorId
                    },
                    actionBundle: {
                        actions: [{
                            type: 'webhook',
                            url: `${callbackUrl}?agent=${agentId}`,
                            data: {
                                event: 'synchronized_start',
                                agent_id: agentId,
                                coordinator_id: this.coordinatorId,
                                sync_time: new Date(Date.now() + delaySeconds * 1000).toISOString()
                            }
                        }]
                    }
                })
            });

            if (response.ok) {
                const timerData = await response.json();
                timers.push({
                    agentId,
                    timerId: timerData.timer.id,
                    fireAt: timerData.timer.fireAt
                });
                console.log(`✅ Sync timer created for agent ${agentId}`);
            }
        }

        console.log(`🤝 ${timers.length} agents will synchronize in ${delaySeconds} seconds`);
        return timers;
    }

    async createRetryDelay(taskId, retryAttempt, baseDelaySeconds, callbackUrl) {
        /**
         * Exponential backoff retry timer
         */

        const delaySeconds = baseDelaySeconds * Math.pow(2, retryAttempt - 1);

        const response = await fetch(`${this.timerBaseUrl}/timers`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tenantId: this.coordinatorId,
                requestedBy: `retry-coordinator`,
                name: `retry-${taskId}-attempt-${retryAttempt}`,
                duration: `${delaySeconds}s`,
                metadata: {
                    task_id: taskId,
                    retry_attempt: retryAttempt,
                    delay_seconds: delaySeconds,
                    retry_type: "exponential_backoff"
                },
                actionBundle: {
                    actions: [{
                        type: 'webhook',
                        url: `${callbackUrl}?task=${taskId}&attempt=${retryAttempt}`,
                        data: {
                            event: 'retry_ready',
                            task_id: taskId,
                            retry_attempt: retryAttempt,
                            next_delay: baseDelaySeconds * Math.pow(2, retryAttempt)
                        }
                    }]
                }
            })
        });

        if (response.ok) {
            const timerData = await response.json();
            console.log(`⏳ Retry ${retryAttempt} for ${taskId} in ${delaySeconds}s`);
            return timerData.timer.id;
        }

        return null;
    }
}

// Usage
const coordinator = new MultiAgentCoordinator("main-coordinator", "mnt_demo_key_pro");

// Synchronize 3 agents to start work together in 30 seconds
coordinator.synchronizeAgents(
    ["agent-1", "agent-2", "agent-3"],
    30,
    "https://your-system.com/agent/sync-start"
);

// Create retry delay with exponential backoff
coordinator.createRetryDelay(
    "data-processing-task",
    3,  // 3rd retry attempt
    5,  // base delay 5 seconds -> 5 * 2^2 = 20 seconds
    "https://your-system.com/task/retry"
);
```

### Rust Agent Integration
```rust
use serde_json::json;
use tokio::time::{sleep, Duration};

struct RustAIAgent {
    agent_id: String,
    api_key: String,
    timer_base_url: String,
    client: reqwest::Client,
}

impl RustAIAgent {
    fn new(agent_id: String, api_key: String) -> Self {
        Self {
            agent_id,
            api_key,
            timer_base_url: "http://localhost:3000".to_string(),
            client: reqwest::Client::new(),
        }
    }

    async fn create_watchdog_timer(&self, check_interval_seconds: u64,
                                 webhook_url: &str) -> Result<String, Box<dyn std::error::Error>> {
        let response = self.client
            .post(&format!("{}/timers", self.timer_base_url))
            .header("X-API-Key", &self.api_key)
            .json(&json!({
                "tenantId": self.agent_id,
                "requestedBy": format!("watchdog-{}", self.agent_id),
                "name": format!("watchdog-{}-{}", self.agent_id, chrono::Utc::now().timestamp()),
                "duration": format!("{}s", check_interval_seconds),
                "metadata": {
                    "watchdog": true,
                    "agent_id": self.agent_id,
                    "check_interval": check_interval_seconds
                },
                "actionBundle": {
                    "actions": [{
                        "type": "webhook",
                        "url": webhook_url,
                        "data": {
                            "event": "watchdog_check",
                            "agent_id": self.agent_id,
                            "expected_response": "agent_alive",
                            "timeout_action": "restart_agent"
                        }
                    }]
                }
            }))
            .send()
            .await?;

        if response.status().is_success() {
            let timer_data: serde_json::Value = response.json().await?;
            let timer_id = timer_data["timer"]["id"].as_str().unwrap().to_string();
            println!("🐕 Watchdog timer created: {}", timer_id);
            Ok(timer_id)
        } else {
            Err(format!("Failed to create watchdog timer: {}", response.status()).into())
        }
    }

    async fn create_rate_limit_delay(&self, api_name: &str, delay_ms: u64) -> Result<String, Box<dyn std::error::Error>> {
        let response = self.client
            .post(&format!("{}/timers", self.timer_base_url))
            .header("X-API-Key", &self.api_key)
            .json(&json!({
                "tenantId": self.agent_id,
                "requestedBy": format!("rate-limiter-{}", self.agent_id),
                "name": format!("rate-limit-{}-{}", api_name, chrono::Utc::now().timestamp_millis()),
                "duration": format!("{}ms", delay_ms),
                "metadata": {
                    "rate_limiting": true,
                    "api_name": api_name,
                    "agent_id": self.agent_id
                },
                "actionBundle": {
                    "actions": [{
                        "type": "webhook",
                        "url": &format!("https://your-agent.com/{}/rate-limit-ready", self.agent_id),
                        "data": {
                            "event": "rate_limit_ready",
                            "api_name": api_name,
                            "agent_id": self.agent_id,
                            "can_proceed": true
                        }
                    }]
                }
            }))
            .send()
            .await?;

        if response.status().is_success() {
            let timer_data: serde_json::Value = response.json().await?;
            Ok(timer_data["timer"]["id"].as_str().unwrap().to_string())
        } else {
            Err(format!("Failed to create rate limit timer: {}", response.status()).into())
        }
    }

    async fn controlled_api_calls(&self, api_calls: Vec<&str>, delay_between_ms: u64) {
        println!("🚀 Starting controlled API calls with {}ms delays", delay_between_ms);

        for (i, api_call) in api_calls.iter().enumerate() {
            if i > 0 {
                // Create delay timer before next API call
                let timer_id = self.create_rate_limit_delay(api_call, delay_between_ms).await;

                if let Ok(id) = timer_id {
                    println!("⏳ Waiting {}ms before calling {}", delay_between_ms, api_call);
                    // In real implementation, you'd wait for webhook callback
                    // For demo, we'll just sleep
                    sleep(Duration::from_millis(delay_between_ms)).await;
                }
            }

            // Make your API call here
            println!("📡 Making API call to: {}", api_call);
            // your_api_client.call(api_call).await;
        }

        println!("✅ All API calls completed with rate limiting");
    }
}

// Usage
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let agent = RustAIAgent::new(
        "rust-agent-001".to_string(),
        "mnt_demo_key_pro".to_string()
    );

    // Create watchdog timer (check every 60 seconds)
    agent.create_watchdog_timer(60, "https://monitoring.com/watchdog/rust-agent-001").await?;

    // Execute API calls with rate limiting
    agent.controlled_api_calls(
        vec!["openai.com/completions", "anthropic.com/messages", "cohere.ai/generate"],
        2000  // 2 second delay between calls
    ).await;

    Ok(())
}
```

---

## 🔄 Common Agent Patterns

### 1. **Task Timeout Pattern**
```python
def ai_task_with_timeout(task_func, timeout_seconds, webhook_url):
    timer_id = create_timeout_timer(timeout_seconds, webhook_url)

    try:
        result = task_func()
        cancel_timer(timer_id)  # Task completed successfully
        return result
    except Exception as e:
        # Timer will still fire and trigger cleanup
        raise e
```

### 2. **Retry with Exponential Backoff**
```javascript
async function retryWithBackoff(operation, maxRetries, baseDelay, webhookUrl) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) throw error;

            const delaySeconds = baseDelay * Math.pow(2, attempt - 1);
            await createRetryTimer(delaySeconds, webhookUrl);
            // Wait for webhook callback before next attempt
        }
    }
}
```

### 3. **Multi-Agent Synchronization**
```python
def synchronize_agents(agent_ids, sync_delay_seconds):
    sync_time = datetime.now() + timedelta(seconds=sync_delay_seconds)

    for agent_id in agent_ids:
        create_sync_timer(
            agent_id=agent_id,
            fire_time=sync_time,
            webhook_url=f"https://agents.com/{agent_id}/start"
        )
```

### 4. **Watchdog/Health Check**
```rust
async fn start_watchdog(agent_id: &str, check_interval: Duration) {
    loop {
        create_watchdog_timer(
            check_interval.as_secs(),
            &format!("https://monitoring.com/check/{}", agent_id)
        ).await;

        // Wait for the interval, then create next watchdog
        tokio::time::sleep(check_interval).await;
    }
}
```

### 5. **Rate Limiting**
```python
class RateLimitedAgent:
    def __init__(self):
        self.last_api_call = None
        self.min_delay_seconds = 1.0

    async def api_call_with_limit(self, endpoint, data):
        if self.last_api_call:
            time_since = time.time() - self.last_api_call
            if time_since < self.min_delay_seconds:
                delay_needed = self.min_delay_seconds - time_since
                await self.create_delay_timer(delay_needed)

        # Make API call
        result = await api_client.post(endpoint, data)
        self.last_api_call = time.time()
        return result
```

---

## 🎛️ Advanced Integration Patterns

### Agent State Machine with Timers
```python
class StateMachineAgent:
    def __init__(self, agent_id):
        self.agent_id = agent_id
        self.state = "idle"
        self.state_timers = {}

    def transition_to_state(self, new_state, timeout_seconds=None):
        # Cancel any existing state timer
        if self.state in self.state_timers:
            cancel_timer(self.state_timers[self.state])

        self.state = new_state

        # Set timeout for new state
        if timeout_seconds:
            timer_id = create_state_timeout_timer(
                state=new_state,
                timeout=timeout_seconds,
                webhook=f"https://agent.com/{self.agent_id}/state-timeout"
            )
            self.state_timers[new_state] = timer_id

    def handle_state_timeout(self, timed_out_state):
        if self.state == timed_out_state:
            # Handle timeout - maybe retry or transition to error state
            self.transition_to_state("error", timeout_seconds=60)
```

### Distributed Agent Coordination
```javascript
class DistributedTaskManager {
    async coordinateTask(taskId, agentIds, phases) {
        const coordination = {
            taskId,
            agents: agentIds,
            currentPhase: 0,
            phases
        };

        // Phase 1: Initialize all agents simultaneously
        await this.synchronizeAgents(agentIds, phases[0].delay,
                                   `https://coordinator.com/task/${taskId}/phase/0`);

        // Schedule subsequent phases
        let totalDelay = phases[0].delay;
        for (let i = 1; i < phases.length; i++) {
            totalDelay += phases[i].delay;

            await createTimer({
                name: `task-${taskId}-phase-${i}`,
                duration: `${totalDelay}s`,
                webhook: `https://coordinator.com/task/${taskId}/phase/${i}`
            });
        }

        return coordination;
    }
}
```

---

## 📊 Monitoring Agent Timer Usage

### Track Timer Metrics
```python
class AgentTimerMetrics:
    def __init__(self, agent_id):
        self.agent_id = agent_id
        self.active_timers = {}
        self.completed_timers = []

    def track_timer_creation(self, timer_id, purpose, duration):
        self.active_timers[timer_id] = {
            'purpose': purpose,
            'created_at': datetime.now(),
            'duration': duration,
            'status': 'active'
        }

    def track_timer_completion(self, timer_id, completed_normally=True):
        if timer_id in self.active_timers:
            timer = self.active_timers.pop(timer_id)
            timer['completed_at'] = datetime.now()
            timer['completed_normally'] = completed_normally
            self.completed_timers.append(timer)

    def get_metrics(self):
        return {
            'agent_id': self.agent_id,
            'active_timers': len(self.active_timers),
            'completed_timers': len(self.completed_timers),
            'success_rate': self._calculate_success_rate(),
            'average_duration': self._calculate_avg_duration()
        }
```

### Health Dashboard Endpoint
```python
from flask import Flask, jsonify

app = Flask(__name__)
agent_metrics = AgentTimerMetrics("my-agent")

@app.route('/agent/health')
def agent_health():
    # Check recent timer activity
    recent_activity = len([t for t in agent_metrics.completed_timers
                          if (datetime.now() - t['completed_at']).seconds < 300])

    return jsonify({
        'status': 'healthy' if recent_activity > 0 else 'stale',
        'metrics': agent_metrics.get_metrics(),
        'last_activity': max([t['completed_at'] for t in agent_metrics.completed_timers]) if agent_metrics.completed_timers else None
    })
```

---

## 🚀 Production Deployment for AI Agents

### Environment Variables
```bash
# Agent-specific configuration
export AGENT_ID="production-agent-001"
export MINOOTS_API_KEY="mnt_your_production_key_here"
export MINOOTS_BASE_URL="https://minoots.your-company.com"
export AGENT_WEBHOOK_BASE="https://agents.your-company.com"

# Timer defaults
export DEFAULT_TIMEOUT_SECONDS="300"
export DEFAULT_RETRY_ATTEMPTS="3"
export WATCHDOG_INTERVAL_SECONDS="60"
```

### Docker Compose for Agent + MINOOTS
```yaml
version: '3.8'
services:
  minoots-system:
    # Use the full MINOOTS system
    extends:
      file: minoots-timer-system/docker-compose.yml

  your-ai-agent:
    build: ./your-agent
    environment:
      - AGENT_ID=production-agent-001
      - MINOOTS_API_KEY=mnt_your_production_key
      - MINOOTS_BASE_URL=http://minoots-system:3000
    depends_on:
      - minoots-system
```

### Agent Deployment Script
```bash
#!/bin/bash
# deploy-agent.sh

echo "🚀 Deploying AI Agent with MINOOTS integration"

# Start MINOOTS system
docker-compose -f minoots-timer-system/docker-compose.yml up -d

# Wait for system to be ready
sleep 10

# Test MINOOTS connectivity
curl -f -H "X-API-Key: $MINOOTS_API_KEY" \
     http://localhost:3000/healthz || exit 1

# Start AI agent
docker-compose -f agent-compose.yml up -d

echo "✅ Agent deployment complete"
echo "📊 Monitor at: http://localhost:3000/healthz"
echo "🤖 Agent status: curl http://localhost:8080/agent/health"
```

---

## 🔧 Troubleshooting Agent Integration

### Common Issues

**Timers not firing?**
```bash
# Check action orchestrator logs
docker-compose logs -f action-orchestrator | grep "your-agent-id"

# Verify webhook URL is reachable
curl -f https://your-agent.com/webhook/test
```

**Webhook delivery failures?**
```bash
# Check webhook response codes in logs
docker-compose logs action-orchestrator | grep "Webhook failed"

# Test webhook manually
curl -X POST https://your-agent.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"test","timer_id":"test"}'
```

**Rate limiting issues?**
```python
# Upgrade API key tier or implement request batching
def batch_timer_requests(timer_configs, batch_size=10):
    for i in range(0, len(timer_configs), batch_size):
        batch = timer_configs[i:i+batch_size]
        for config in batch:
            create_timer(config)
        time.sleep(1)  # Pause between batches
```

---

## 📚 Additional Resources

- **API Reference**: See `QUICK_START_GUIDE.md`
- **Security**: See `SECURITY.md`
- **Architecture**: See `DEPLOYMENT_COMPLETE.md`
- **Examples**: Check `examples/` directory
- **Community**: [GitHub Discussions](https://github.com/Domusgpt/minoots-timer-system/discussions)

---

**Build reliable, timeout-aware AI agents with MINOOTS! 🤖⏰**