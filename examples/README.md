# 💡 MINOOTS EXAMPLES

**Real-world examples and use cases for the MINOOTS Timer Infrastructure.**

---

## 🏗️ DEVELOPMENT & CI/CD

### Build Timeout Timer
Prevent runaway builds by setting automatic timeouts.

```javascript
// Build timeout - cancel builds that run too long
const buildTimer = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.MINOOTS_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Build Timeout Protection',
    duration: '15m',
    events: {
      on_expire: {
        webhook: 'https://ci.yourcompany.com/build-timeout',
        data: {
          buildId: process.env.BUILD_ID,
          action: 'cancel_build',
          repository: process.env.REPO_NAME
        }
      }
    }
  })
});

// Cancel timer when build completes successfully
if (buildSucceeded) {
  await fetch(`https://api-m3waemr5lq-uc.a.run.app/timers/${timer.id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': process.env.MINOOTS_API_KEY },
    body: JSON.stringify({ reason: 'Build completed successfully' })
  });
}
```

### Deployment Window Enforcement
```bash
#!/bin/bash
# Only allow deployments during business hours

# Create 8-hour deployment window timer
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Deployment Window",
    "duration": "8h",
    "events": {
      "on_expire": {
        "webhook": "https://ops.yourcompany.com/close-deployment-window"
      }
    }
  }'

echo "Deployment window open until 6 PM"
```

### Code Review Escalation
```python
import requests
import os

# 24-hour code review timer with escalation
def create_review_timer(pr_number, reviewer_emails):
    return requests.post(
        'https://api-m3waemr5lq-uc.a.run.app/timers',
        headers={
            'x-api-key': os.getenv('MINOOTS_API_KEY'),
            'Content-Type': 'application/json'
        },
        json={
            'name': f'Code Review PR #{pr_number}',
            'duration': '24h',
            'events': {
                'on_progress': {
                    'webhook': 'https://github-bot.yourcompany.com/review-reminder',
                    'intervals': ['50%', '75%', '90%']  # 12h, 18h, 21.6h reminders
                },
                'on_expire': {
                    'webhook': 'https://github-bot.yourcompany.com/escalate-review',
                    'data': {
                        'pr_number': pr_number,
                        'reviewers': reviewer_emails,
                        'action': 'escalate_to_tech_lead'
                    }
                }
            }
        }
    )
```

---

## 🤖 AI AGENT WORKFLOWS

### Rate Limit Coordination
```javascript
// Handle API rate limits gracefully
class APIRateLimitManager {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api-m3waemr5lq-uc.a.run.app';
  }

  async handleRateLimit(service, resetTime) {
    const waitDuration = Math.ceil((resetTime - Date.now()) / 1000);
    
    const timer = await fetch(`${this.baseUrl}/timers`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `${service} Rate Limit Reset`,
        duration: `${waitDuration}s`,
        events: {
          on_expire: {
            webhook: 'https://your-agent.com/resume-api-calls',
            data: { service, originalRequest: 'retry_last_operation' }
          }
        }
      })
    });

    console.log(`Rate limited by ${service}. Waiting ${waitDuration}s for reset.`);
  }
}

// Usage in your AI agent
const rateLimitManager = new APIRateLimitManager(process.env.MINOOTS_API_KEY);
await rateLimitManager.handleRateLimit('github', 1642248000);
```

### Multi-Agent Task Coordination
```python
# Coordinate multiple AI agents with timers
class AgentCoordinator:
    def __init__(self, minoots_api_key):
        self.api_key = minoots_api_key
        self.base_url = 'https://api-m3waemr5lq-uc.a.run.app'
    
    def start_parallel_tasks(self, tasks):
        for task in tasks:
            # Create timer for each agent task
            requests.post(
                f'{self.base_url}/timers',
                headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
                json={
                    'name': f'Agent Task: {task["name"]}',
                    'duration': task['max_duration'],
                    'events': {
                        'on_expire': {
                            'webhook': 'https://coordinator.yourcompany.com/task-timeout',
                            'data': {
                                'task_id': task['id'],
                                'agent_id': task['agent'],
                                'action': 'force_completion'
                            }
                        }
                    }
                }
            )
    
    def signal_task_complete(self, timer_id):
        # Cancel timer when agent completes early
        requests.delete(
            f'{self.base_url}/timers/{timer_id}',
            headers={'x-api-key': self.api_key},
            json={'reason': 'Task completed successfully'}
        )
```

### Long-Running Process Monitoring
```bash
#!/bin/bash
# Monitor long-running AI training jobs

TRAINING_JOB_ID="training_$(date +%s)"

# Create 6-hour training timeout timer
TIMER_RESPONSE=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"AI Training Job Timeout\",
    \"duration\": \"6h\",
    \"events\": {
      \"on_progress\": {
        \"webhook\": \"https://ml-ops.yourcompany.com/training-progress\",
        \"intervals\": [\"25%\", \"50%\", \"75%\"]
      },
      \"on_expire\": {
        \"webhook\": \"https://ml-ops.yourcompany.com/training-timeout\",
        \"data\": {
          \"job_id\": \"$TRAINING_JOB_ID\",
          \"action\": \"terminate_job\"
        }
      }
    }
  }")

TIMER_ID=$(echo $TIMER_RESPONSE | jq -r '.timer.id')
echo "Training job $TRAINING_JOB_ID started with timer $TIMER_ID"

# Start training job
python train_model.py --job-id $TRAINING_JOB_ID

# Cancel timer when training completes
curl -X DELETE https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -d '{"reason": "Training completed successfully"}'
```

---

## 👥 TEAM COORDINATION

### Sprint Management
```javascript
// Create sprint timers with team notifications
class SprintManager {
  constructor(teamWebhook, minootsApiKey) {
    this.teamWebhook = teamWebhook;
    this.apiKey = minootsApiKey;
  }

  async startSprint(sprintName, duration = '2w') {
    // Main sprint timer
    const sprintTimer = await this.createTimer({
      name: `${sprintName} Sprint`,
      duration: duration,
      events: {
        on_progress: {
          webhook: this.teamWebhook,
          intervals: ['25%', '50%', '75%', '90%']
        },
        on_expire: {
          webhook: this.teamWebhook,
          message: `🏁 ${sprintName} sprint completed! Time for retrospective.`
        }
      }
    });

    // Daily standup reminders
    for (let day = 1; day <= 10; day++) {
      await this.createTimer({
        name: `Standup Reminder Day ${day}`,
        duration: `${day * 24}h`,
        events: {
          on_expire: {
            webhook: this.teamWebhook,
            message: `🗣️ Daily standup in 30 minutes!`
          }
        }
      });
    }

    return sprintTimer;
  }

  async createTimer(config) {
    const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    return response.json();
  }
}

// Usage
const sprintManager = new SprintManager(
  'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
  process.env.MINOOTS_API_KEY
);

sprintManager.startSprint('Q1 Feature Development', '2w');
```

### Meeting Management
```python
import requests
from datetime import datetime, timedelta

class MeetingManager:
    def __init__(self, minoots_api_key, slack_webhook):
        self.api_key = minoots_api_key
        self.slack_webhook = slack_webhook
        self.base_url = 'https://api-m3waemr5lq-uc.a.run.app'
    
    def schedule_meeting_timers(self, meeting_name, segments):
        """
        Schedule timers for meeting segments with transitions.
        
        segments = [
            {'name': 'Introductions', 'duration': '10m'},
            {'name': 'Main Discussion', 'duration': '45m'},
            {'name': 'Action Items', 'duration': '15m'}
        ]
        """
        total_time = 0
        
        for i, segment in enumerate(segments):
            # Timer for segment completion
            requests.post(
                f'{self.base_url}/timers',
                headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
                json={
                    'name': f'{meeting_name}: {segment["name"]}',
                    'duration': segment['duration'],
                    'events': {
                        'on_expire': {
                            'webhook': self.slack_webhook,
                            'message': f'⏰ {segment["name"]} time is up! Moving to next segment.'
                        }
                    }
                }
            )
            
            # 2-minute warning timer
            warning_duration = self._subtract_time(segment['duration'], '2m')
            if warning_duration > 0:
                requests.post(
                    f'{self.base_url}/timers',
                    headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
                    json={
                        'name': f'{meeting_name}: {segment["name"]} Warning',
                        'duration': f'{warning_duration}s',
                        'events': {
                            'on_expire': {
                                'webhook': self.slack_webhook,
                                'message': f'⚠️ 2 minutes left for {segment["name"]}'
                            }
                        }
                    }
                )
```

### On-Call Escalation
```bash
#!/bin/bash
# Automated on-call escalation system

INCIDENT_ID="INC-$(date +%Y%m%d-%H%M%S)"
PRIMARY_ONCALL="john@company.com"
SECONDARY_ONCALL="jane@company.com"
MANAGER="manager@company.com"

# Level 1: Primary on-call (15 minutes)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"L1 Escalation - $INCIDENT_ID\",
    \"duration\": \"15m\",
    \"events\": {
      \"on_expire\": {
        \"webhook\": \"https://pagerduty.yourcompany.com/escalate\",
        \"data\": {
          \"incident_id\": \"$INCIDENT_ID\",
          \"level\": 2,
          \"notify\": \"$SECONDARY_ONCALL\"
        }
      }
    }
  }"

# Level 2: Secondary on-call (20 minutes)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"L2 Escalation - $INCIDENT_ID\",
    \"duration\": \"35m\",
    \"events\": {
      \"on_expire\": {
        \"webhook\": \"https://pagerduty.yourcompany.com/escalate\",
        \"data\": {
          \"incident_id\": \"$INCIDENT_ID\",
          \"level\": 3,
          \"notify\": \"$MANAGER\",
          \"severity\": \"critical\"
        }
      }
    }
  }"

echo "Incident $INCIDENT_ID escalation timers created"
```

---

## 📊 MONITORING & OPERATIONS

### SLA Monitoring
```python
import requests
import time

class SLAMonitor:
    def __init__(self, minoots_api_key):
        self.api_key = minoots_api_key
        self.base_url = 'https://api-m3waemr5lq-uc.a.run.app'
    
    def monitor_api_sla(self, service_name, max_response_time_ms=500):
        """Monitor API response time and alert if SLA is breached."""
        
        # Create 5-minute monitoring window
        timer_response = requests.post(
            f'{self.base_url}/timers',
            headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
            json={
                'name': f'SLA Monitor: {service_name}',
                'duration': '5m',
                'events': {
                    'on_expire': {
                        'webhook': 'https://monitoring.yourcompany.com/sla-check',
                        'data': {
                            'service': service_name,
                            'threshold_ms': max_response_time_ms,
                            'action': 'evaluate_sla_breach'
                        }
                    }
                }
            }
        )
        
        return timer_response.json()['timer']['id']
    
    def create_incident_timer(self, incident_id, severity='medium'):
        """Create incident resolution timer based on severity."""
        
        resolution_times = {
            'critical': '1h',
            'high': '4h',
            'medium': '24h',
            'low': '72h'
        }
        
        requests.post(
            f'{self.base_url}/timers',
            headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
            json={
                'name': f'Incident Resolution: {incident_id}',
                'duration': resolution_times[severity],
                'events': {
                    'on_progress': {
                        'webhook': 'https://incident-management.yourcompany.com/progress',
                        'intervals': ['50%', '75%', '90%']
                    },
                    'on_expire': {
                        'webhook': 'https://incident-management.yourcompany.com/sla-breach',
                        'data': {
                            'incident_id': incident_id,
                            'severity': severity,
                            'action': 'escalate_sla_breach'
                        }
                    }
                }
            }
        )

# Usage
sla_monitor = SLAMonitor(os.getenv('MINOOTS_API_KEY'))
timer_id = sla_monitor.monitor_api_sla('user-auth-service', 200)
```

### Backup Verification
```bash
#!/bin/bash
# Verify backup completion within expected timeframe

DATABASE_NAME="production_db"
BACKUP_START_TIME=$(date +%s)

# Create 2-hour backup timeout timer
TIMER_RESPONSE=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Database Backup Timeout - $DATABASE_NAME\",
    \"duration\": \"2h\",
    \"events\": {
      \"on_expire\": {
        \"webhook\": \"https://ops.yourcompany.com/backup-timeout\",
        \"data\": {
          \"database\": \"$DATABASE_NAME\",
          \"backup_start\": $BACKUP_START_TIME,
          \"action\": \"investigate_backup_failure\"
        }
      }
    }
  }")

TIMER_ID=$(echo $TIMER_RESPONSE | jq -r '.timer.id')

# Start backup process
pg_dump $DATABASE_NAME > /backups/daily_backup_$(date +%Y%m%d).sql

# Verify backup completed successfully
if [ $? -eq 0 ]; then
  # Cancel timeout timer
  curl -X DELETE https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID \
    -H "x-api-key: $MINOOTS_API_KEY" \
    -d '{"reason": "Backup completed successfully"}'
  
  echo "Backup completed and verified"
else
  echo "Backup failed - timeout timer still active"
fi
```

### Maintenance Window Management
```javascript
// Coordinate maintenance windows across services
class MaintenanceManager {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api-m3waemr5lq-uc.a.run.app';
  }

  async scheduleMaintenanceWindow(services, duration = '4h') {
    const windowStart = new Date();
    const timers = [];

    // Main maintenance window timer
    const mainTimer = await this.createTimer({
      name: 'Maintenance Window',
      duration: duration,
      events: {
        on_expire: {
          webhook: 'https://ops.yourcompany.com/maintenance-complete',
          message: '✅ Maintenance window completed. All services should be restored.'
        }
      }
    });

    // Service-specific timers
    for (const service of services) {
      const serviceTimer = await this.createTimer({
        name: `${service.name} Maintenance`,
        duration: service.estimatedDuration || '2h',
        events: {
          on_expire: {
            webhook: 'https://ops.yourcompany.com/service-maintenance-timeout',
            data: {
              service: service.name,
              action: 'escalate_maintenance_delay'
            }
          }
        }
      });
      
      timers.push(serviceTimer);
    }

    // 30-minute warning timer
    const warningTimer = await this.createTimer({
      name: 'Maintenance Window Warning',
      duration: this.subtractTime(duration, '30m'),
      events: {
        on_expire: {
          webhook: 'https://status.yourcompany.com/maintenance-warning',
          message: '⚠️ 30 minutes remaining in maintenance window'
        }
      }
    });

    return { mainTimer, serviceTimers: timers, warningTimer };
  }

  async createTimer(config) {
    const response = await fetch(`${this.baseUrl}/timers`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    return response.json();
  }
}

// Usage
const maintenanceManager = new MaintenanceManager(process.env.MINOOTS_API_KEY);

maintenanceManager.scheduleMaintenanceWindow([
  { name: 'User Authentication Service', estimatedDuration: '1h' },
  { name: 'Database Cluster', estimatedDuration: '3h' },
  { name: 'Load Balancer Update', estimatedDuration: '30m' }
], '4h');
```

---

## 🎮 PRODUCTIVITY & PERSONAL

### Pomodoro Technique
```python
import requests
import os

class PomodoroTimer:
    def __init__(self, minoots_api_key):
        self.api_key = minoots_api_key
        self.base_url = 'https://api-m3waemr5lq-uc.a.run.app'
        self.webhook_url = 'https://your-app.com/pomodoro-webhook'
    
    def start_pomodoro_session(self, session_name, cycles=4):
        """Start a complete pomodoro session with work/break cycles."""
        
        timers = []
        
        for cycle in range(cycles):
            # Work timer (25 minutes)
            work_timer = self.create_timer({
                'name': f'{session_name} - Work {cycle + 1}',
                'duration': '25m',
                'events': {
                    'on_expire': {
                        'webhook': self.webhook_url,
                        'message': f'🍅 Work session {cycle + 1} complete! Time for a break.',
                        'data': {'type': 'work_complete', 'cycle': cycle + 1}
                    }
                }
            })
            
            # Break timer (5 minutes, or 30 for final break)
            break_duration = '30m' if cycle == cycles - 1 else '5m'
            break_type = 'Long break' if cycle == cycles - 1 else 'Short break'
            
            break_timer = self.create_timer({
                'name': f'{session_name} - {break_type} {cycle + 1}',
                'duration': break_duration,
                'events': {
                    'on_expire': {
                        'webhook': self.webhook_url,
                        'message': f'⏰ {break_type} over! Ready for next work session.',
                        'data': {'type': 'break_complete', 'cycle': cycle + 1}
                    }
                }
            })
            
            timers.extend([work_timer, break_timer])
        
        return timers
    
    def create_timer(self, config):
        response = requests.post(
            f'{self.base_url}/timers',
            headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'},
            json=config
        )
        return response.json()

# Usage
pomodoro = PomodoroTimer(os.getenv('MINOOTS_API_KEY'))
timers = pomodoro.start_pomodoro_session('Deep Work - Feature Development', 4)
```

### Habit Tracking
```javascript
// Daily habit reminder system
class HabitTracker {
  constructor(apiKey, notificationWebhook) {
    this.apiKey = apiKey;
    this.webhook = notificationWebhook;
    this.baseUrl = 'https://api-m3waemr5lq-uc.a.run.app';
  }

  async setupDailyHabits(habits) {
    const timers = [];
    
    for (const habit of habits) {
      const timer = await this.createTimer({
        name: `Daily Habit: ${habit.name}`,
        duration: habit.reminderTime, // e.g., "8h" for 8 AM reminder
        events: {
          on_expire: {
            webhook: this.webhook,
            message: `🎯 Time for your daily habit: ${habit.name}`,
            data: {
              habit: habit.name,
              streak: habit.currentStreak || 0,
              target: habit.dailyTarget
            }
          }
        }
      });
      
      timers.push(timer);
    }
    
    return timers;
  }

  async createTimer(config) {
    const response = await fetch(`${this.baseUrl}/timers`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    return response.json();
  }
}

// Usage
const habitTracker = new HabitTracker(
  process.env.MINOOTS_API_KEY,
  'https://your-app.com/habit-reminder'
);

habitTracker.setupDailyHabits([
  { name: 'Morning Exercise', reminderTime: '7h', dailyTarget: '30 minutes' },
  { name: 'Reading', reminderTime: '20h', dailyTarget: '20 pages' },
  { name: 'Meditation', reminderTime: '6h30m', dailyTarget: '10 minutes' }
]);
```

### Study Session Management
```bash
#!/bin/bash
# Create study session with breaks and review periods

SUBJECT="$1"
STUDY_DURATION="$2"
BREAK_DURATION="$3"

if [ -z "$SUBJECT" ] || [ -z "$STUDY_DURATION" ] || [ -z "$BREAK_DURATION" ]; then
  echo "Usage: $0 <subject> <study_duration> <break_duration>"
  echo "Example: $0 'Machine Learning' '50m' '10m'"
  exit 1
fi

# Main study timer
STUDY_TIMER=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Study Session: $SUBJECT\",
    \"duration\": \"$STUDY_DURATION\",
    \"events\": {
      \"on_progress\": {
        \"webhook\": \"https://study-app.com/progress\",
        \"intervals\": [\"25%\", \"50%\", \"75%\"]
      },
      \"on_expire\": {
        \"webhook\": \"https://study-app.com/study-complete\",
        \"message\": \"📚 Study session for $SUBJECT completed! Time for a break.\",
        \"data\": {
          \"subject\": \"$SUBJECT\",
          \"duration\": \"$STUDY_DURATION\"
        }
      }
    }
  }")

# Break timer
BREAK_TIMER=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Break after $SUBJECT\",
    \"duration\": \"$BREAK_DURATION\",
    \"events\": {
      \"on_expire\": {
        \"webhook\": \"https://study-app.com/break-complete\",
        \"message\": \"⏰ Break time over! Ready for the next session?\",
        \"data\": {
          \"previous_subject\": \"$SUBJECT\"
        }
      }
    }
  }")

echo "Study session created for $SUBJECT"
echo "Study timer: $(echo $STUDY_TIMER | jq -r '.timer.id')"
echo "Break timer: $(echo $BREAK_TIMER | jq -r '.timer.id')"
```

---

## 🔧 UTILITY FUNCTIONS

### Duration Helper
```javascript
// Utility functions for duration calculations
class DurationHelper {
  static parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error('Invalid duration format');
    
    const [, value, unit] = match;
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    
    return parseInt(value) * multipliers[unit];
  }
  
  static formatDuration(milliseconds) {
    const units = [
      { label: 'd', value: 86400000 },
      { label: 'h', value: 3600000 },
      { label: 'm', value: 60000 },
      { label: 's', value: 1000 }
    ];
    
    for (const unit of units) {
      if (milliseconds >= unit.value) {
        return Math.floor(milliseconds / unit.value) + unit.label;
      }
    }
    
    return '0s';
  }
  
  static addTime(duration1, duration2) {
    const ms1 = this.parseDuration(duration1);
    const ms2 = this.parseDuration(duration2);
    return this.formatDuration(ms1 + ms2);
  }
  
  static subtractTime(duration1, duration2) {
    const ms1 = this.parseDuration(duration1);
    const ms2 = this.parseDuration(duration2);
    return this.formatDuration(Math.max(0, ms1 - ms2));
  }
}

// Usage
console.log(DurationHelper.addTime('1h', '30m'));      // "90m"
console.log(DurationHelper.subtractTime('2h', '15m')); // "105m"
```

### Webhook Tester
```python
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading

class WebhookTester:
    def __init__(self, port=8080):
        self.port = port
        self.received_webhooks = []
        self.server = None
        
    def start_webhook_server(self):
        """Start a local webhook server for testing."""
        
        class WebhookHandler(BaseHTTPRequestHandler):
            def do_POST(handler_self):
                content_length = int(handler_self.headers['Content-Length'])
                post_data = handler_self.rfile.read(content_length)
                
                webhook_data = json.loads(post_data.decode('utf-8'))
                self.received_webhooks.append(webhook_data)
                
                print(f"Received webhook: {webhook_data}")
                
                handler_self.send_response(200)
                handler_self.send_header('Content-type', 'application/json')
                handler_self.end_headers()
                handler_self.wfile.write(b'{"status": "received"}')
        
        self.server = HTTPServer(('localhost', self.port), WebhookHandler)
        server_thread = threading.Thread(target=self.server.serve_forever)
        server_thread.daemon = True
        server_thread.start()
        
        print(f"Webhook server started on http://localhost:{self.port}")
        return f"http://localhost:{self.port}"
    
    def create_test_timer(self, minoots_api_key, duration='30s'):
        """Create a test timer that will call our webhook server."""
        
        webhook_url = self.start_webhook_server()
        
        response = requests.post(
            'https://api-m3waemr5lq-uc.a.run.app/timers',
            headers={'x-api-key': minoots_api_key, 'Content-Type': 'application/json'},
            json={
                'name': 'Webhook Test Timer',
                'duration': duration,
                'events': {
                    'on_expire': {
                        'webhook': webhook_url,
                        'message': 'Test webhook delivered successfully!',
                        'data': {'test': True, 'timestamp': '2024-01-15T10:30:00Z'}
                    }
                }
            }
        )
        
        return response.json()
    
    def wait_for_webhooks(self, timeout=60):
        """Wait for webhooks to be received."""
        import time
        
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.received_webhooks:
                return self.received_webhooks
            time.sleep(1)
        
        return []
    
    def stop_server(self):
        if self.server:
            self.server.shutdown()

# Usage
tester = WebhookTester()
timer = tester.create_test_timer(os.getenv('MINOOTS_API_KEY'), '10s')
print(f"Created test timer: {timer['timer']['id']}")

webhooks = tester.wait_for_webhooks(15)
print(f"Received {len(webhooks)} webhooks")
tester.stop_server()
```

---

## 📝 BEST PRACTICES

### Error Handling
```javascript
async function createTimerWithRetry(config, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.MINOOTS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`API Error: ${error.error.message}`);
      }
      
      return await response.json();
      
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to create timer after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}
```

### Environment Configuration
```bash
# .env file for MINOOTS configuration
MINOOTS_API_KEY=mnt_live_your_production_key
MINOOTS_TEST_API_KEY=mnt_test_your_test_key
MINOOTS_BASE_URL=https://api-m3waemr5lq-uc.a.run.app
MINOOTS_WEBHOOK_SECRET=your_webhook_verification_secret

# Webhook endpoints
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK
PAGERDUTY_WEBHOOK_URL=https://events.pagerduty.com/integration/YOUR/INTEGRATION/KEY

# Application-specific
DEFAULT_TIMER_DURATION=30m
MAX_CONCURRENT_TIMERS=10
ENABLE_TIMER_LOGGING=true
```

### Webhook Security
```python
import hmac
import hashlib

def verify_webhook_signature(payload, signature, secret):
    """Verify MINOOTS webhook signature for security."""
    
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(f"sha256={expected_signature}", signature)

# Flask webhook endpoint example
@app.route('/minoots-webhook', methods=['POST'])
def handle_minoots_webhook():
    payload = request.get_data(as_text=True)
    signature = request.headers.get('X-MINOOTS-Signature')
    
    if not verify_webhook_signature(payload, signature, WEBHOOK_SECRET):
        return 'Invalid signature', 401
    
    webhook_data = request.get_json()
    
    # Process webhook...
    if webhook_data['event'] == 'timer_expired':
        handle_timer_expiration(webhook_data['timer'])
    
    return 'OK', 200
```

---

**🚀 Ready to implement? Start with the [API Quickstart Guide](../docs/API_QUICKSTART.md) and choose the examples that match your use case.**

**Need help? Email [support@minoots.com](mailto:support@minoots.com) with your specific requirements.**