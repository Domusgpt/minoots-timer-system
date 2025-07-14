# 📱 SLACK INTEGRATION GUIDE

**Connect MINOOTS with Slack for seamless team notifications and timer management.**

## 🚀 QUICK SETUP

### Step 1: Create Slack Webhook
1. **Go to**: [Slack App Directory](https://slack.com/apps/A0F7XDUAZ-incoming-webhooks)
2. **Add to Slack**: Choose your workspace
3. **Select Channel**: Pick default notification channel
4. **Copy Webhook URL**: Save for MINOOTS configuration

### Step 2: Configure MINOOTS Timer
```javascript
const slackTimer = await minoots.timers.create({
  name: 'Sprint Planning Session',
  duration: '2h',
  events: {
    on_expire: {
      webhook: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
      message: '🏁 Sprint planning completed! Time for standup.',
      data: {
        channel: '#dev-team',
        username: 'MINOOTS Timer',
        icon_emoji: ':stopwatch:'
      }
    }
  }
});
```

## 📱 SLACK MESSAGE FORMATS

### Basic Timer Notification
```json
{
  "text": "🏁 Sprint planning completed! Time for standup.",
  "channel": "#dev-team",
  "username": "MINOOTS Timer",
  "icon_emoji": ":stopwatch:"
}
```

### Rich Message with Attachments
```javascript
const richNotification = {
  webhook: 'https://hooks.slack.com/services/YOUR/WEBHOOK',
  data: {
    channel: '#dev-team',
    username: 'MINOOTS Timer',
    attachments: [{
      color: 'good',
      title: '⏰ Timer Completed',
      title_link: 'https://minoots.com/dashboard',
      text: 'Sprint planning session has ended',
      fields: [
        {
          title: 'Duration',
          value: '2 hours',
          short: true
        },
        {
          title: 'Next Action',
          value: 'Daily standup',
          short: true
        }
      ],
      footer: 'MINOOTS Timer System',
      ts: Math.floor(Date.now() / 1000)
    }]
  }
};
```

### Progress Notifications
```javascript
const progressTimer = await minoots.timers.create({
  name: 'Development Sprint',
  duration: '2w',
  events: {
    on_progress: {
      webhook: 'https://hooks.slack.com/services/YOUR/WEBHOOK',
      intervals: ['25%', '50%', '75%'],
      data: {
        channel: '#dev-updates',
        text: '📊 Sprint Progress Update',
        attachments: [{
          color: 'warning',
          text: 'Sprint is {progress}% complete'
        }]
      }
    }
  }
});
```

## 🎯 TEAM COORDINATION PATTERNS

### Daily Standup Timer
```javascript
const dailyStandup = await minoots.timers.create({
  name: 'Daily Standup',
  duration: '15m',
  events: {
    on_expire: {
      webhook: SLACK_WEBHOOK,
      data: {
        channel: '#standup',
        text: '✅ Standup time complete!',
        attachments: [{
          color: 'good',
          text: 'Time to wrap up and share async updates',
          actions: [{
            type: 'button',
            text: 'Share Update',
            url: 'https://standup-app.com/share'
          }]
        }]
      }
    }
  }
});
```

### Code Review Reminders
```javascript
const reviewReminder = await minoots.timers.create({
  name: 'Code Review Reminder',
  duration: '24h',
  events: {
    on_expire: {
      webhook: SLACK_WEBHOOK,
      data: {
        channel: '#code-review',
        text: '🔍 Code review pending!',
        attachments: [{
          color: 'warning',
          text: 'PR has been waiting for review for 24 hours',
          fields: [{
            title: 'Pull Request',
            value: '<https://github.com/company/repo/pull/123|#123: Add user authentication>',
            short: false
          }]
        }]
      }
    }
  }
});
```

### Deployment Notifications
```javascript
const deploymentWindow = await minoots.timers.create({
  name: 'Deployment Window',
  duration: '30m',
  events: {
    on_progress: {
      webhook: SLACK_WEBHOOK,
      intervals: ['50%', '75%', '90%'],
      data: {
        channel: '#deployments',
        text: '🚀 Deployment window progress: {progress}%'
      }
    },
    on_expire: {
      webhook: SLACK_WEBHOOK,
      data: {
        channel: '#deployments',
        text: '⏰ Deployment window closing!',
        attachments: [{
          color: 'danger',
          text: 'Deployment window has ended. Verify all systems are stable.',
          actions: [{
            type: 'button',
            text: 'Check Status',
            url: 'https://status.company.com'
          }]
        }]
      }
    }
  }
});
```

## 🔔 ADVANCED SLACK FEATURES

### Interactive Buttons
```javascript
const interactiveTimer = {
  webhook: SLACK_WEBHOOK,
  data: {
    channel: '#dev-team',
    text: '🏗️ Build completed!',
    attachments: [{
      color: 'good',
      text: 'Build finished successfully. Choose next action:',
      callback_id: 'build_complete',
      actions: [
        {
          name: 'deploy',
          text: 'Deploy to Staging',
          type: 'button',
          value: 'deploy_staging',
          style: 'primary'
        },
        {
          name: 'test',
          text: 'Run Tests',
          type: 'button', 
          value: 'run_tests'
        },
        {
          name: 'cancel',
          text: 'Cancel',
          type: 'button',
          style: 'danger'
        }
      ]
    }]
  }
};
```

### Thread Replies
```javascript
const threadUpdate = {
  webhook: SLACK_WEBHOOK,
  data: {
    channel: '#dev-team',
    text: '📊 Sprint progress update',
    thread_ts: '1642248000.123456', // Reply to existing message
    attachments: [{
      color: 'good',
      text: 'Sprint is now 75% complete'
    }]
  }
};
```

### Direct Messages
```javascript
const dmNotification = {
  webhook: SLACK_WEBHOOK,
  data: {
    channel: '@john.doe', // Direct message to user
    text: '⚠️ Your timer for code review has expired',
    attachments: [{
      color: 'warning',
      text: 'Please review the pending pull request'
    }]
  }
};
```

## 🛠️ SLACK BOT INTEGRATION

### Custom MINOOTS Slack Bot
```javascript
// Slack Bot that responds to MINOOTS commands
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Listen for /timer slash command
app.command('/timer', async ({ command, ack, respond }) => {
  await ack();
  
  const [duration, ...nameParts] = command.text.split(' ');
  const name = nameParts.join(' ') || 'Slack Timer';
  
  try {
    const timer = await minoots.timers.create({
      name,
      duration,
      events: {
        on_expire: {
          webhook: process.env.SLACK_WEBHOOK,
          data: {
            channel: command.channel_id,
            text: `⏰ Timer "${name}" completed!`,
            user: command.user_id
          }
        }
      }
    });
    
    await respond({
      text: `✅ Timer set for ${duration}`,
      response_type: 'in_channel'
    });
  } catch (error) {
    await respond({
      text: `❌ Error creating timer: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});
```

### Timer Status Commands
```javascript
// Check timer status via Slack
app.command('/timer-status', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    const timers = await minoots.timers.list({ status: 'running' });
    
    if (timers.length === 0) {
      await respond({
        text: '📭 No active timers',
        response_type: 'ephemeral'
      });
      return;
    }
    
    const attachments = timers.map(timer => ({
      color: 'good',
      title: timer.name,
      text: `${Math.round(timer.progress * 100)}% complete`,
      fields: [{
        title: 'Time Remaining',
        value: formatDuration(timer.timeRemaining),
        short: true
      }]
    }));
    
    await respond({
      text: '⏲️ Active Timers',
      attachments,
      response_type: 'ephemeral'
    });
  } catch (error) {
    await respond({
      text: `❌ Error fetching timers: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});
```

## 📊 TEAM DASHBOARD INTEGRATION

### Slack Workflow Builder
```yaml
# Slack Workflow for MINOOTS Timer Creation
name: "Create MINOOTS Timer"
trigger:
  type: "shortcut"
  name: "Start Timer"
  description: "Create a new MINOOTS timer"

steps:
  - id: "timer_form"
    type: "form"
    title: "Timer Details"
    fields:
      - id: "timer_name"
        type: "text"
        label: "Timer Name"
        required: true
      - id: "duration"
        type: "select"
        label: "Duration"
        options:
          - "15m"
          - "30m" 
          - "1h"
          - "2h"
          - "4h"
      - id: "channel"
        type: "channels_select"
        label: "Notification Channel"
        
  - id: "create_timer"
    type: "webhook"
    url: "https://your-app.com/slack/create-timer"
    method: "POST"
    body:
      timer_name: "{{timer_form.timer_name}}"
      duration: "{{timer_form.duration}}"
      channel: "{{timer_form.channel}}"
      user: "{{user.id}}"
```

### Channel-Specific Timers
```javascript
// Different timer types for different channels
const channelTimers = {
  '#standup': {
    defaultDuration: '15m',
    template: '🗣️ Standup timer for {duration}'
  },
  '#deployment': {
    defaultDuration: '30m',
    template: '🚀 Deployment window: {duration}',
    urgency: 'high'
  },
  '#code-review': {
    defaultDuration: '24h',
    template: '🔍 Code review timer: {duration}',
    escalation: true
  }
};
```

## 🔧 TROUBLESHOOTING

### Common Issues

#### Webhook Not Firing
```javascript
// Test webhook manually
const testWebhook = async () => {
  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Test message from MINOOTS',
        channel: '#test'
      })
    });
    
    if (!response.ok) {
      console.error('Webhook test failed:', response.status);
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
};
```

#### Message Formatting Issues
```javascript
// Validate Slack message format
const validateSlackMessage = (message) => {
  if (!message.text && !message.attachments) {
    throw new Error('Message must have text or attachments');
  }
  
  if (message.text && message.text.length > 4000) {
    throw new Error('Message text too long (max 4000 characters)');
  }
  
  if (message.attachments && message.attachments.length > 20) {
    throw new Error('Too many attachments (max 20)');
  }
};
```

### Best Practices
- ✅ Use appropriate channels for different notification types
- ✅ Include relevant context in messages (project, duration, etc.)
- ✅ Add action buttons for common follow-up tasks
- ✅ Use thread replies for progress updates
- ✅ Test webhooks before production deployment
- ✅ Handle webhook failures gracefully
- ✅ Respect Slack rate limits (1 message per second)