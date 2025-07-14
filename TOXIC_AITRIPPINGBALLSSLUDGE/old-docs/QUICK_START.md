# ⚡ QUICK START GUIDE

**Get MINOOTS running in 5 minutes or less.**

## 🎯 GET YOUR API KEY (1 MINUTE)

### Option 1: Free Tier (No Credit Card)
1. **Visit**: https://dashboard.minoots.com/signup
2. **Sign up** with email or Google/GitHub
3. **Copy your API key** from the dashboard
4. **Done!** You get 5 concurrent timers, 100/month

### Option 2: Instant Pro Access (Credit Card)
1. **Visit**: https://dashboard.minoots.com/signup?tier=pro
2. **Sign up** and add payment method
3. **Get unlimited timers** immediately
4. **$19/month**, cancel anytime

## 🚀 FIRST TIMER IN 30 SECONDS

### Using cURL (Any Platform)
```bash
# Create a 5-minute timer
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "5m"
  }'
```

### Using Node.js
```javascript
// Install SDK: npm install @minoots/timer-sdk
const { TimerClient } = require('@minoots/timer-sdk');

const minoots = new TimerClient('YOUR_API_KEY');

const timer = await minoots.create({
  name: 'My First Timer',
  duration: '5m'
});

console.log(`Timer created: ${timer.id}`);
```

### Using Python
```python
# pip install requests
import requests

response = requests.post('https://api-m3waemr5lq-uc.a.run.app/timers', 
  headers={
    'x-api-key': 'YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  json={
    'name': 'My First Timer',
    'duration': '5m'
  }
)

timer = response.json()
print(f"Timer created: {timer['timer']['id']}")
```

## 📱 COMMON USE CASES (2 MINUTES EACH)

### 1. Meeting Timer with Slack Notification
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Standup",
    "duration": "15m",
    "events": {
      "on_expire": {
        "webhook": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
        "message": "🏁 Standup complete! Time to wrap up."
      }
    }
  }'
```

### 2. Pomodoro Work Session
```javascript
const minoots = new TimerClient('YOUR_API_KEY');

// 25-minute work session
const workTimer = await minoots.create({
  name: 'Pomodoro Work Session',
  duration: '25m',
  events: {
    on_expire: {
      webhook: 'https://your-app.com/pomodoro-break'
    }
  }
});

console.log('Work session started! Focus time begins now.');
```

### 3. Deployment Window
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Deployment Window",
    "duration": "30m",
    "events": {
      "on_progress": {
        "intervals": ["50%", "75%", "90%"],
        "webhook": "https://your-monitoring-system.com/deployment-progress"
      },
      "on_expire": {
        "webhook": "https://your-monitoring-system.com/deployment-complete"
      }
    }
  }'
```

### 4. AI Agent Coordination
```javascript
// For Claude/ChatGPT agents to coordinate work
const coordinationTimer = await minoots.create({
  name: 'AI Agent Task Timeout',
  duration: '2h',
  events: {
    on_expire: {
      webhook: 'https://your-agent-system.com/task-timeout'
    }
  }
});

// Agent can check progress
const status = await minoots.get(coordinationTimer.id);
console.log(`Task ${Math.round(status.progress * 100)}% complete`);
```

## 🔔 WEBHOOK SETUP (30 SECONDS)

### Slack Webhook
1. **Go to**: https://slack.com/apps/A0F7XDUAZ-incoming-webhooks
2. **Add to Slack** and select channel
3. **Copy webhook URL**
4. **Use in timer events**:
```json
{
  "on_expire": {
    "webhook": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
    "data": {
      "channel": "#dev-team",
      "text": "⏰ Timer expired!",
      "username": "MINOOTS Timer"
    }
  }
}
```

### Discord Webhook
1. **Server Settings** → **Integrations** → **Webhooks**
2. **Create Webhook** and copy URL
3. **Use in timer**:
```json
{
  "on_expire": {
    "webhook": "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL",
    "data": {
      "content": "🏁 Timer completed!",
      "username": "MINOOTS"
    }
  }
}
```

### Custom Webhook (Your App)
```javascript
// Your webhook endpoint
app.post('/minoots-webhook', (req, res) => {
  const { event, timer } = req.body;
  
  if (event === 'timer_expired') {
    console.log(`Timer "${timer.name}" completed!`);
    // Your custom logic here
  }
  
  res.json({ received: true });
});
```

## 🤖 CLAUDE AGENT INTEGRATION (MCP)

### 1. Install MCP Server
```bash
git clone https://github.com/minoots/mcp-server
cd mcp-server
npm install
```

### 2. Configure Claude
```json
// Add to ~/.claude/mcp_servers.json
{
  "minoots": {
    "command": "node",
    "args": ["/path/to/mcp-server/index.js"],
    "env": {
      "MINOOTS_API_KEY": "YOUR_API_KEY"
    }
  }
}
```

### 3. Use in Claude
```
Create a 30-minute timer for this coding session and notify me when it's done.
```

Claude will automatically use MINOOTS to create and manage the timer!

## 📊 MONITORING & PROGRESS

### Check Timer Status
```bash
# List all timers
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers

# Get specific timer
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/TIMER_ID

# Check progress
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-m3waemr5lq-uc.a.run.app/timers/TIMER_ID" | \
  jq '.timer.progress'
```

### Real-time Progress (JavaScript)
```javascript
const monitorTimer = async (timerId) => {
  const checkProgress = setInterval(async () => {
    const timer = await minoots.get(timerId);
    const percent = Math.round(timer.progress * 100);
    
    console.log(`Timer progress: ${percent}%`);
    
    if (timer.status === 'expired') {
      console.log('Timer completed!');
      clearInterval(checkProgress);
    }
  }, 5000); // Check every 5 seconds
};
```

## 🎛️ DURATION FORMATS

### Simple Formats
```javascript
const durations = [
  '30s',        // 30 seconds
  '5m',         // 5 minutes
  '2h',         // 2 hours
  '1d',         // 1 day
  '1w',         // 1 week
];
```

### Complex Formats
```javascript
const complexDurations = [
  '1h 30m',           // 1 hour 30 minutes
  '2d 4h 15m',        // 2 days 4 hours 15 minutes
  '1w 2d 3h 30m 45s', // 1 week 2 days 3 hours 30 minutes 45 seconds
];
```

### Milliseconds
```javascript
const milliseconds = [
  60000,        // 1 minute (number)
  '300000',     // 5 minutes (string)
  3600000,      // 1 hour
];
```

## 🚨 QUICK TROUBLESHOOTING

### API Key Issues
```bash
# Test your API key
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/users/me

# Should return your user info, not 401 error
```

### Webhook Not Working
```bash
# Test webhook manually
curl -X POST YOUR_WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Should return 200 OK
```

### Timer Not Expiring
```bash
# Check system time
date

# Check timer status
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/TIMER_ID
```

## 🎯 NEXT STEPS

### 1. Read Full Documentation
- **API Reference**: [docs/API_REFERENCE.md](./API_REFERENCE.md)
- **Team Setup**: [docs/TEAM_SETUP_GUIDE.md](./TEAM_SETUP_GUIDE.md)
- **Webhooks**: [docs/WEBHOOKS.md](./WEBHOOKS.md)

### 2. Join the Community
- **GitHub**: https://github.com/minoots/timer-system
- **Discord**: https://discord.gg/minoots
- **Forum**: https://community.minoots.com

### 3. Upgrade Your Plan
- **Pro**: $19/month for unlimited timers
- **Team**: $49/month for organization features
- **Enterprise**: Custom pricing for SSO, SLA, support

### 4. Advanced Features
- **Organization Management**: Invite team members
- **Project-based Timers**: Organize by project
- **Advanced Webhooks**: Custom retry logic
- **Analytics**: Timer usage insights

## 💡 PRO TIPS

### Batch Operations
```javascript
// Create multiple timers at once
const timers = await Promise.all([
  minoots.create({ name: 'Task 1', duration: '30m' }),
  minoots.create({ name: 'Task 2', duration: '45m' }),
  minoots.create({ name: 'Task 3', duration: '1h' })
]);

console.log(`Created ${timers.length} timers`);
```

### Environment Variables
```bash
# Set up environment variables
export MINOOTS_API_KEY="your_api_key"
export MINOOTS_WEBHOOK_URL="your_webhook_url"

# Use in scripts
curl -H "x-api-key: $MINOOTS_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers
```

### Error Handling
```javascript
try {
  const timer = await minoots.create({
    name: 'Important Timer',
    duration: '1h'
  });
  console.log('Timer created successfully');
} catch (error) {
  if (error.status === 403) {
    console.log('Upgrade to Pro for unlimited timers');
  } else {
    console.error('Timer creation failed:', error.message);
  }
}
```

## ⚡ SPEED RUN (ALL FEATURES IN 5 MINUTES)

```bash
# 1. Create basic timer (30 seconds)
export API_KEY="your_api_key"
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Speed Run Timer", "duration": "2m"}'

# 2. Create timer with webhook (1 minute)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Webhook Timer",
    "duration": "1m",
    "events": {
      "on_expire": {
        "webhook": "https://httpbin.org/post",
        "data": {"message": "Timer completed!"}
      }
    }
  }'

# 3. List all timers (10 seconds)
curl -H "x-api-key: $API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers

# 4. Get specific timer (10 seconds)
TIMER_ID="timer_from_previous_response"
curl -H "x-api-key: $API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID

# 5. Create quick timer (20 seconds)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/quick/wait \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"duration": "30s"}'

# 6. Delete timer (10 seconds)
curl -X DELETE -H "x-api-key: $API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID

# 7. Check account status (10 seconds)
curl -H "x-api-key: $API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/users/me
```

**Total time**: 4 minutes 30 seconds ⚡

---

**You're now ready to use MINOOTS!** 🎉

Need help? Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) or contact support@minoots.com