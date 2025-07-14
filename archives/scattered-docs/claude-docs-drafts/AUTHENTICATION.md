# Authentication Guide

**How authentication works in MINOOTS**

## Overview

MINOOTS uses Firebase Authentication with API key-based access for programmatic usage. Users authenticate with Firebase, then use API keys for timer operations.

## API Key Authentication

### Using API Keys

Include your API key in the Authorization header:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers
```

### API Key Format

API keys are bearer tokens that identify your user account and provide access to timer operations.

```
Authorization: Bearer sk_test_abc123def456...
```

## Authentication Flow

1. **User Account** - Created via Firebase Auth
2. **API Key Generation** - Generate keys for programmatic access
3. **API Requests** - Include API key in Authorization header

## Creating API Keys

*Note: The exact process for creating API keys needs to be documented based on the actual implementation*

### Via API (if endpoint exists)

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App Key"
  }'
```

### Response

```json
{
  "id": "key_123",
  "key": "sk_test_abc123def456...",
  "name": "My App Key",
  "keyPreview": "sk_test_abc123...456",
  "createdAt": "2025-01-13T23:45:00Z"
}
```

## Managing API Keys

### List Your API Keys

```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/account/api-keys
```

### Revoke an API Key

```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/account/api-keys/key_123
```

## Role-Based Access Control (RBAC)

MINOOTS implements RBAC for organization and team features.

### User Roles

#### Organization Roles
- **OWNER** - Full control over organization
- **ADMIN** - Manage members and projects  
- **MANAGER** - Manage projects and timers
- **EDITOR** - Create and modify timers
- **VIEWER** - Read-only access

#### Project Roles
- **owner** - Full control over project
- **editor** - Create and modify project timers
- **viewer** - Read-only access to project

### Permission Checks

The API automatically enforces permissions based on:
- User's organization role
- User's project-specific permissions
- Timer ownership and access settings

## Security Best Practices

### API Key Security
- **Never commit API keys to code repositories**
- **Use environment variables** for API keys
- **Rotate keys regularly**
- **Use separate keys for different environments**

### Environment Variables

```bash
# .env file
MINOOTS_API_KEY=sk_test_your_api_key_here
MINOOTS_API_URL=https://api-m3waemr5lq-uc.a.run.app
```

```javascript
// Node.js usage
const client = new MinootsClient({
  apiKey: process.env.MINOOTS_API_KEY
});
```

### Key Rotation

```javascript
// Example key rotation workflow
async function rotateApiKey() {
  // Create new key
  const newKey = await createApiKey({ name: 'Rotated Key' });
  
  // Update application config
  updateEnvironmentVariable('MINOOTS_API_KEY', newKey.key);
  
  // Test new key works
  await testApiKey(newKey.key);
  
  // Revoke old key
  await revokeApiKey(oldKeyId);
}
```

## Error Handling

### Authentication Errors

```json
{
  "success": false,
  "error": "Invalid API key"
}
```

Common authentication error codes:
- **401 Unauthorized** - Invalid or missing API key
- **403 Forbidden** - Valid key but insufficient permissions
- **429 Too Many Requests** - Rate limit exceeded

### Handling Auth Errors

```javascript
async function makeAuthenticatedRequest() {
  try {
    const response = await client.createTimer(timerData);
    return response;
  } catch (error) {
    if (error.status === 401) {
      // API key is invalid - rotate or refresh
      console.error('Authentication failed - check API key');
    } else if (error.status === 403) {
      // Permission denied - check user role
      console.error('Insufficient permissions');
    } else if (error.status === 429) {
      // Rate limited - wait and retry
      console.error('Rate limited - retry after:', error.retryAfter);
    }
    throw error;
  }
}
```

## Team Authentication

### Organization Access

When working with team features, permissions are checked against:

1. **User's organization role**
2. **Project-specific permissions**
3. **Timer ownership and access settings**

### Creating Team Timers

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "1h",
    "name": "Team standup reminder",
    "organizationId": "org_123",
    "projectId": "project_456"
  }'
```

### Permission Validation

The API validates:
- User has permission to create timers in the organization
- User has access to the specified project
- Timer creation doesn't exceed organization limits

## Firebase Integration

### Firebase Auth Tokens

For direct Firebase integration, you can use Firebase auth tokens:

```javascript
import { getAuth } from 'firebase/auth';

const auth = getAuth();
const user = auth.currentUser;

if (user) {
  const token = await user.getIdToken();
  
  // Use token for authenticated requests
  const response = await fetch('/api/timers', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
}
```

### Custom Claims

MINOOTS uses Firebase Custom Claims for RBAC:

```javascript
// Custom claims structure (automatically managed)
{
  "organizations": {
    "org_123": {
      "role": "ADMIN",
      "permissions": ["create_timers", "manage_members"]
    }
  },
  "projects": {
    "project_456": {
      "role": "editor",
      "organizationId": "org_123"
    }
  }
}
```

## Rate Limiting

API requests are rate limited based on your tier:

- **Free tier**: 10 requests per minute
- **Pro tier**: Higher limits (when configured)

Rate limit headers:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1642123456
```

When rate limited:
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```