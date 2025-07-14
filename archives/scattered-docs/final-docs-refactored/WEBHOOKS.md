# 🔔 WEBHOOK INTEGRATION GUIDE

**Receive basic notifications when your timers expire.**

---

## 🚀 QUICK START

### Basic Webhook Setup
When creating a timer, you can specify a `webhook` URL in the `on_expire` event. MINOOTS will send an HTTP POST request to this URL when the timer reaches its expiration.

```javascript
const timer = await minoots.timers.create({
  name: 'My Webhook Timer',
  duration: '1m',
  events: {
    on_expire: {
      webhook: 'https://webhook.site/your-unique-url', // Replace with your endpoint
      message: 'This message will be included in the webhook payload.',
      data: { customField: 'customValue' } // Optional custom data
    }
  }
});
```

### Webhook Payload
When your timer expires, MINOOTS will send a `POST` request to the specified `webhook` URL with a JSON payload containing the timer details and any custom `message` or `data` you provided.

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123def456",
    "name": "My Webhook Timer",
    "agentId": "sdk_agent",
    "duration": 60000,
    "startTime": 1705324200000,
    "endTime": 1705324260000,
    "status": "expired",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "This message will be included in the webhook payload.",
        "data": {
          "customField": "customValue"
        }
      }
    },
    "metadata": {
      "createdBy": "user_firebase_uid",
      "userTier": "free",
      "permissionSource": "custom_claims"
    },
    "organizationId": "optional_organization_id",
    "projectId": "optional_project_id",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:31:00.000Z"
  },
  "message": "This message will be included in the webhook payload."
}
```

---

## 🎯 WEBHOOK BEHAVIOR

*   **Fire-and-Forget**: MINOOTS sends the webhook request once. There is no built-in retry mechanism if your endpoint is unavailable or returns an error.
*   **No Signature Verification**: Webhook requests from MINOOTS do not include a signature for verification. You should implement your own security measures if your webhook endpoint requires it.
*   **HTTPS Recommended**: While not strictly enforced by MINOOTS, it is highly recommended to use HTTPS for your webhook URLs to ensure secure communication.

---

## 🧪 TESTING WEBHOOKS

### Using webhook.site
For quick testing and debugging, you can use [webhook.site](https://webhook.site) to generate a unique URL that captures incoming webhook requests.

```bash
# Create a 30-second timer that posts to webhook.site
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Webhook Test Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

---

**Important**: The MINOOTS webhook system is currently basic. For advanced features like retries, custom headers, or complex payload transformations, you will need to implement these on your own server or use a third-party webhook service.