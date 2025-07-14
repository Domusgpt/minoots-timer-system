# MINOOTS Timer System

**An independent timer system for autonomous agents and workflows, built on Firebase and Google Cloud Functions.**

MINOOTS provides a robust and scalable API for creating, managing, and monitoring timers. It is designed to be a reliable backend for AI agents, automated workflows, and any application requiring precise time-based event triggering, such as handling rate limiting, scheduling, or coordinating multi-step processes.

## ✨ Features

*   **Timer Management**: Create, retrieve, list, and delete timers with flexible durations.
*   **Webhook Notifications**: Trigger HTTP POST requests to a specified URL when a timer expires.
*   **Role-Based Access Control (RBAC)**: Secure API endpoints with a granular permission system for users and organizations (Team Tier and above).
*   **Tier-Based Rate Limiting**: Dynamic rate limits applied based on user subscription tiers.
*   **API Key Authentication**: Simple and secure access to the API using unique API keys.
*   **Node.js SDK**: An easy-to-use SDK for Node.js integration.
*   **Claude Desktop Integration**: An MCP server allows Claude to interact with the timer system directly.

## 🚀 Quick Start in 3 Steps

### Step 1: Get Your API Key

You will need an API key to interact with the system. API keys are generated via the `/account/api-keys` endpoint after you have authenticated. For now, please refer to your account dashboard or contact support for API key generation.

### Step 2: Create Your First Timer

Use `cURL` to create a 30-second timer. Replace `YOUR_API_KEY` with your key and update the `webhook` URL to a service like [webhook.site](https://webhook.site) to inspect the results.

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer from MINOOTS is complete!"
      }
    }
  }'
```

### Step 3: Receive Webhook Notification

When your timer expires, MINOOTS will send an HTTP POST request to the webhook URL you provided. The payload will contain detailed information about the expired timer.

## 📚 Documentation

*   [API Quickstart Guide](./API_QUICKSTART.md): Get running in 5 minutes.
*   [Full API Reference](./API_REFERENCE.md): Complete endpoint documentation.
*   [Node.js SDK Guide](./SDK_GUIDE.md): Detailed guide for using the Node.js SDK.
*   [Webhook Integration Guide](./WEBHOOKS.md): Learn how to handle webhook events.
*   [Claude Integration](./CLAUDE_INTEGRATION.md): Connect MINOOTS to Claude Desktop.



## 📞 Support

For any questions or issues, please refer to the project's GitHub repository.

```