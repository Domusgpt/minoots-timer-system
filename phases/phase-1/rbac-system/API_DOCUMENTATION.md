# 🔌 MINOOTS ENTERPRISE API DOCUMENTATION

**Complete API reference for the MINOOTS Enterprise RBAC system. This document covers all endpoints, authentication methods, request/response formats, and integration examples.**

---

## 📚 TABLE OF CONTENTS

- [🚀 Quick Start](#-quick-start)
- [🔐 Authentication](#-authentication)
- [⏲️ Timer Operations](#️-timer-operations)
- [👥 Team Management](#-team-management)
- [🏢 Organization Management](#-organization-management)
- [📊 Projects & Collaboration](#-projects--collaboration)
- [💰 Billing & Subscriptions](#-billing--subscriptions)
- [📈 Analytics & Usage](#-analytics--usage)
- [🔔 Webhooks & Events](#-webhooks--events)
- [❌ Error Handling](#-error-handling)
- [📝 Rate Limiting](#-rate-limiting)
- [🧪 Testing & Examples](#-testing--examples)

---

## 🚀 Quick Start

### Base URL
```
https://api-m3waemr5lq-uc.a.run.app
```

### Authentication Test
```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/health \
  -H "x-api-key: your_api_key_here"
```

### Create Your First Timer
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "30m"
  }'
```

---

## 🔐 Authentication

### Method 1: API Keys (Recommended)

#### Headers Required
```http
x-api-key: mnt_live_1234567890abcdef
```

#### Getting API Keys
```http
POST /account/api-keys
Authorization: Bearer {firebase_token}
Content-Type: application/json

{
  "name": "Production Server Key"
}
```

#### Response
```json
{
  "success": true,
  "apiKey": "mnt_live_1234567890abcdef",
  "keyId": "key_abc123",
  "name": "Production Server Key",
  "created": "2024-01-15T10:30:00Z",
  "permissions": ["create_timers", "manage_projects"],
  "warning": "Save this API key - it will not be shown again!"
}
```

### Method 2: Firebase Auth Tokens

#### Headers Required
```http
Authorization: Bearer {firebase_id_token}
```

#### Getting Firebase Tokens
```javascript
// Frontend JavaScript
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();
const userCredential = await signInWithEmailAndPassword(auth, email, password);
const token = await userCredential.user.getIdToken();
```

### Method 3: Organization API Keys

#### For Team-Level Operations
```http
x-api-key: mnt_org_live_9876543210fedcba
```

#### Creating Organization Keys
```http
POST /organizations/{orgId}/api-keys
Authorization: Bearer {firebase_token}
Content-Type: application/json

{
  "name": "Team Integration Key",
  "permissions": ["manage_projects", "invite_users"],
  "expiresIn": "1year"
}
```

---

## ⏲️ Timer Operations

### Create Timer

#### Endpoint
```http
POST /timers
```

#### Request Body
```json
{
  "name": "Timer Name",
  "duration": "30m",
  "description": "Optional description",
  "projectId": "proj_123",
  "organizationId": "org_456",
  "events": {
    "on_expire": {
      "webhook": "https://yourapp.com/webhook",
      "message": "Timer completed!",
      "data": {
        "buildId": "build_123",
        "environment": "production"
      }
    },
    "on_progress": {
      "webhook": "https://yourapp.com/progress",
      "intervals": ["25%", "50%", "75%"]
    }
  },
  "metadata": {
    "priority": "high",
    "tags": ["deployment", "critical"],
    "assignedTo": "user_789"
  },
  "settings": {
    "pausable": false,
    "extendable": true,
    "notifyTeam": true
  }
}
```

#### Duration Formats
```json
{
  "duration": "30s",        // 30 seconds
  "duration": "15m",        // 15 minutes  
  "duration": "2h",         // 2 hours
  "duration": "1d",         // 1 day
  "duration": 1800000       // milliseconds (30 minutes)
}
```

#### Response
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "name": "Timer Name",
    "duration": 1800000,
    "startTime": 1642742400000,
    "endTime": 1642744200000,
    "status": "running",
    "progress": 0,
    "timeRemaining": 1800000,
    "createdBy": "user_123",
    "projectId": "proj_123",
    "organizationId": "org_456",
    "access": {
      "user_123": "owner",
      "user_456": "collaborator"
    },
    "events": {
      "on_expire": {
        "webhook": "https://yourapp.com/webhook",
        "message": "Timer completed!"
      }
    },
    "metadata": {
      "priority": "high",
      "tags": ["deployment", "critical"]
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  },
  "usage": {
    "daily": {
      "used": 15,
      "limit": 100,
      "remaining": 85
    },
    "concurrent": {
      "current": 3,
      "limit": 5,
      "remaining": 2
    }
  }
}
```

### List Timers

#### Endpoint
```http
GET /timers
```

#### Query Parameters
```http
GET /timers?status=running&projectId=proj_123&limit=25&offset=0
```

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `status` | string | Filter by status: `running`, `expired`, `cancelled`, `paused` | all |
| `projectId` | string | Filter by project ID | all |
| `organizationId` | string | Filter by organization ID | all |
| `createdBy` | string | Filter by creator user ID | all |
| `tags` | string | Comma-separated tags to filter by | all |
| `priority` | string | Filter by priority: `low`, `normal`, `high`, `critical` | all |
| `limit` | integer | Maximum results to return (1-100) | 50 |
| `offset` | integer | Pagination offset | 0 |
| `sortBy` | string | Sort field: `created`, `name`, `endTime`, `progress` | created |
| `sortOrder` | string | Sort direction: `asc`, `desc` | desc |

#### Response
```json
{
  "success": true,
  "timers": [
    {
      "id": "timer_abc123",
      "name": "Timer Name",
      "status": "running",
      "progress": 0.45,
      "timeRemaining": 990000,
      "endTime": 1642744200000,
      "projectId": "proj_123",
      "createdBy": "user_123",
      "metadata": {
        "priority": "high",
        "tags": ["deployment"]
      }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 25,
    "offset": 0,
    "hasMore": true
  },
  "filters": {
    "status": "running",
    "projectId": "proj_123"
  }
}
```

### Get Timer Details

#### Endpoint
```http
GET /timers/{timerId}
```

#### Response
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "name": "Build Process Timer",
    "description": "Coordinating deployment pipeline",
    "duration": 1800000,
    "startTime": 1642742400000,
    "endTime": 1642744200000,
    "status": "running",
    "progress": 0.45,
    "timeRemaining": 990000,
    "createdBy": "user_123",
    "projectId": "proj_123",
    "organizationId": "org_456",
    "access": {
      "user_123": "owner",
      "user_456": "collaborator",
      "user_789": "viewer"
    },
    "events": {
      "on_expire": {
        "webhook": "https://api.company.com/deploy-complete",
        "message": "Deployment timer expired",
        "data": {
          "buildId": "build_123",
          "environment": "production"
        }
      },
      "on_progress": {
        "webhook": "https://api.company.com/deploy-progress",
        "intervals": ["25%", "50%", "75%"],
        "lastTriggered": "50%"
      }
    },
    "metadata": {
      "priority": "high",
      "tags": ["deployment", "critical", "auto"],
      "assignedTo": "user_789",
      "department": "engineering",
      "costCenter": "cc_456"
    },
    "settings": {
      "pausable": false,
      "extendable": true,
      "notifyTeam": true,
      "autoArchive": true
    },
    "history": [
      {
        "action": "created",
        "timestamp": "2024-01-15T10:30:00Z",
        "userId": "user_123"
      },
      {
        "action": "shared",
        "timestamp": "2024-01-15T10:32:00Z",
        "userId": "user_123",
        "details": {
          "sharedWith": "user_456",
          "role": "collaborator"
        }
      }
    ],
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:32:00Z"
  },
  "permissions": {
    "canEdit": true,
    "canDelete": true,
    "canShare": true,
    "canExtend": true
  }
}
```

### Update Timer

#### Endpoint
```http
PUT /timers/{timerId}
```

#### Request Body
```json
{
  "name": "Updated Timer Name",
  "description": "Updated description",
  "events": {
    "on_expire": {
      "webhook": "https://newwebhook.com",
      "message": "Updated completion message"
    }
  },
  "metadata": {
    "priority": "critical",
    "tags": ["urgent", "deployment"],
    "assignedTo": "user_999"
  }
}
```

#### Response
```json
{
  "success": true,
  "timer": {
    // Updated timer object
  },
  "changes": [
    {
      "field": "name",
      "oldValue": "Old Timer Name",
      "newValue": "Updated Timer Name"
    },
    {
      "field": "metadata.priority",
      "oldValue": "high",
      "newValue": "critical"
    }
  ]
}
```

### Extend Timer

#### Endpoint
```http
POST /timers/{timerId}/extend
```

#### Request Body
```json
{
  "duration": "15m",           // Add 15 minutes
  "reason": "Build taking longer than expected",
  "notifyTeam": true
}
```

#### Response
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "originalEndTime": 1642744200000,
    "newEndTime": 1642745100000,
    "extensionDuration": 900000,
    "timeRemaining": 1890000
  },
  "history": {
    "extendedBy": "user_123",
    "reason": "Build taking longer than expected",
    "timestamp": "2024-01-15T10:45:00Z"
  }
}
```

### Cancel Timer

#### Endpoint
```http
DELETE /timers/{timerId}
```

#### Request Body (Optional)
```json
{
  "reason": "Deployment cancelled",
  "notifyTeam": true
}
```

#### Response
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "status": "cancelled",
    "cancelledAt": "2024-01-15T10:45:00Z",
    "cancelledBy": "user_123",
    "reason": "Deployment cancelled"
  }
}
```

---

## 👥 Team Management

### Get User Profile

#### Endpoint
```http
GET /account/profile
```

#### Response
```json
{
  "success": true,
  "user": {
    "id": "user_123",
    "email": "john@company.com",
    "name": "John Doe",
    "tier": "team",
    "organizations": [
      {
        "id": "org_456",
        "name": "Acme Corp",
        "role": "admin",
        "joinedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "subscription": {
      "tier": "team",
      "status": "active",
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "cancelAtPeriodEnd": false
    },
    "limits": {
      "concurrentTimers": -1,
      "monthlyTimers": -1,
      "apiRequestsPerMinute": 100,
      "organizations": 5,
      "projectsPerOrg": 25
    },
    "usage": {
      "timersThisMonth": 45,
      "apiRequestsToday": 1250,
      "organizationsCreated": 2
    },
    "permissions": [
      "create_timers",
      "manage_organizations",
      "mcp_integration",
      "advanced_webhooks"
    ],
    "createdAt": "2024-01-01T00:00:00Z",
    "lastSeen": "2024-01-15T10:30:00Z"
  }
}
```

### List Team Members

#### Endpoint
```http
GET /organizations/{orgId}/members
```

#### Response
```json
{
  "success": true,
  "organization": {
    "id": "org_456",
    "name": "Acme Corp Development",
    "memberCount": 12
  },
  "members": [
    {
      "id": "user_123",
      "email": "john@company.com",
      "name": "John Doe",
      "role": "owner",
      "joinedAt": "2024-01-01T00:00:00Z",
      "lastSeen": "2024-01-15T10:30:00Z",
      "status": "active",
      "permissions": ["all"],
      "projects": [
        {
          "id": "proj_123",
          "name": "Web App",
          "role": "manager"
        }
      ]
    },
    {
      "id": "user_456",
      "email": "jane@company.com",
      "name": "Jane Smith",
      "role": "admin",
      "joinedAt": "2024-01-05T00:00:00Z",
      "lastSeen": "2024-01-15T09:15:00Z",
      "status": "active",
      "permissions": ["manage_members", "manage_projects"],
      "projects": [
        {
          "id": "proj_123",
          "name": "Web App",
          "role": "editor"
        },
        {
          "id": "proj_789",
          "name": "Mobile App",
          "role": "manager"
        }
      ]
    }
  ],
  "roles": {
    "owner": 1,
    "admin": 2,
    "manager": 4,
    "editor": 3,
    "viewer": 2
  }
}
```

### Invite User

#### Endpoint
```http
POST /organizations/{orgId}/invite
```

#### Request Body
```json
{
  "email": "newuser@company.com",
  "role": "editor",
  "projectIds": ["proj_123", "proj_789"],
  "message": "Welcome to our development team!",
  "permissions": {
    "proj_123": "manager",
    "proj_789": "editor"
  },
  "expiresIn": "7days"
}
```

#### Response
```json
{
  "success": true,
  "invitation": {
    "id": "inv_abc123",
    "email": "newuser@company.com",
    "role": "editor",
    "organizationId": "org_456",
    "invitedBy": "user_123",
    "status": "pending",
    "expiresAt": "2024-01-22T10:30:00Z",
    "inviteUrl": "https://minoots.com/invite/abc123",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Update User Role

#### Endpoint
```http
PUT /organizations/{orgId}/members/{userId}
```

#### Request Body
```json
{
  "role": "manager",
  "reason": "Promotion to team lead",
  "notifyUser": true
}
```

#### Response
```json
{
  "success": true,
  "member": {
    "id": "user_456",
    "email": "jane@company.com",
    "oldRole": "editor",
    "newRole": "manager",
    "updatedAt": "2024-01-15T10:30:00Z",
    "updatedBy": "user_123"
  }
}
```

### Remove User

#### Endpoint
```http
DELETE /organizations/{orgId}/members/{userId}
```

#### Request Body
```json
{
  "reason": "Employee departure",
  "transferTimersTo": "user_789",
  "notifyUser": true
}
```

#### Response
```json
{
  "success": true,
  "removed": {
    "userId": "user_456",
    "email": "jane@company.com",
    "role": "editor",
    "timersTransferred": 15,
    "transferredTo": "user_789",
    "removedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 🏢 Organization Management

### Create Organization

#### Endpoint
```http
POST /organizations
```

#### Request Body
```json
{
  "name": "Acme Corp Development",
  "slug": "acme-dev",
  "description": "Development team timer coordination",
  "settings": {
    "defaultTimerDuration": "2h",
    "allowGuestAccess": false,
    "requireApprovalForInvites": true,
    "webhookRetryCount": 3,
    "autoArchiveTimers": true,
    "timezones": ["America/New_York", "Europe/London"],
    "workingHours": {
      "start": "09:00",
      "end": "17:00",
      "timezone": "America/New_York"
    }
  },
  "billing": {
    "tier": "team",
    "billingEmail": "billing@company.com",
    "purchaseOrderRequired": false
  }
}
```

#### Response
```json
{
  "success": true,
  "organization": {
    "id": "org_456",
    "name": "Acme Corp Development",
    "slug": "acme-dev",
    "description": "Development team timer coordination",
    "tier": "team",
    "members": {
      "user_123": "owner"
    },
    "memberCount": 1,
    "projects": [],
    "settings": {
      "defaultTimerDuration": "2h",
      "allowGuestAccess": false,
      "requireApprovalForInvites": true,
      "webhookRetryCount": 3,
      "autoArchiveTimers": true,
      "timezones": ["America/New_York", "Europe/London"],
      "workingHours": {
        "start": "09:00",
        "end": "17:00",
        "timezone": "America/New_York"
      }
    },
    "limits": {
      "maxMembers": 50,
      "maxProjects": 25,
      "maxTimersPerProject": -1
    },
    "usage": {
      "members": 1,
      "projects": 0,
      "timersThisMonth": 0
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Get Organization Details

#### Endpoint
```http
GET /organizations/{orgId}
```

#### Response
```json
{
  "success": true,
  "organization": {
    "id": "org_456",
    "name": "Acme Corp Development",
    "slug": "acme-dev",
    "description": "Development team timer coordination",
    "tier": "team",
    "memberCount": 12,
    "projectCount": 5,
    "settings": {
      "defaultTimerDuration": "2h",
      "allowGuestAccess": false,
      "requireApprovalForInvites": true
    },
    "billing": {
      "tier": "team",
      "status": "active",
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "nextInvoiceDate": "2024-02-15T00:00:00Z",
      "amount": 69,
      "currency": "USD"
    },
    "limits": {
      "maxMembers": 50,
      "maxProjects": 25,
      "currentMembers": 12,
      "currentProjects": 5
    },
    "features": {
      "sso": false,
      "auditLogs": true,
      "customIntegrations": false,
      "prioritySupport": true
    },
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  },
  "permissions": {
    "canEdit": true,
    "canDelete": true,
    "canManageMembers": true,
    "canManageBilling": true
  }
}
```

### Update Organization

#### Endpoint
```http
PUT /organizations/{orgId}
```

#### Request Body
```json
{
  "name": "Acme Corporation Engineering",
  "description": "Updated description",
  "settings": {
    "defaultTimerDuration": "90m",
    "allowGuestAccess": true,
    "webhookRetryCount": 5
  }
}
```

### Delete Organization

#### Endpoint
```http
DELETE /organizations/{orgId}
```

#### Request Body
```json
{
  "confirmationText": "DELETE",
  "transferDataTo": "user_789",
  "reason": "Company restructure"
}
```

#### Response
```json
{
  "success": true,
  "deleted": {
    "organizationId": "org_456",
    "name": "Acme Corp Development",
    "timersArchived": 150,
    "projectsArchived": 5,
    "membersRemoved": 12,
    "dataTransferredTo": "user_789",
    "deletedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 📊 Projects & Collaboration

### Create Project

#### Endpoint
```http
POST /organizations/{orgId}/projects
```

#### Request Body
```json
{
  "name": "Mobile App Development",
  "description": "Timer coordination for mobile app release",
  "settings": {
    "defaultTimerDuration": "45m",
    "autoTagging": true,
    "notificationWebhook": "https://hooks.slack.com/webhook",
    "allowExternalCollaborators": false,
    "requireApprovalForTimers": false
  },
  "access": {
    "user_123": "manager",
    "user_456": "editor",
    "user_789": "viewer"
  },
  "metadata": {
    "department": "engineering",
    "priority": "high",
    "deadline": "2024-03-01T00:00:00Z",
    "budget": 50000,
    "tags": ["mobile", "ios", "android"]
  }
}
```

#### Response
```json
{
  "success": true,
  "project": {
    "id": "proj_123",
    "name": "Mobile App Development",
    "description": "Timer coordination for mobile app release",
    "organizationId": "org_456",
    "access": {
      "user_123": "manager",
      "user_456": "editor",
      "user_789": "viewer"
    },
    "settings": {
      "defaultTimerDuration": "45m",
      "autoTagging": true,
      "notificationWebhook": "https://hooks.slack.com/webhook",
      "allowExternalCollaborators": false,
      "requireApprovalForTimers": false
    },
    "timers": [],
    "timerCount": 0,
    "metadata": {
      "department": "engineering",
      "priority": "high",
      "deadline": "2024-03-01T00:00:00Z",
      "budget": 50000,
      "tags": ["mobile", "ios", "android"],
      "color": "#3498db",
      "archived": false
    },
    "stats": {
      "totalTimers": 0,
      "activeTimers": 0,
      "completedTimers": 0,
      "totalDuration": 0
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### List Projects

#### Endpoint
```http
GET /organizations/{orgId}/projects
```

#### Query Parameters
```http
GET /organizations/{orgId}/projects?archived=false&department=engineering&limit=25
```

#### Response
```json
{
  "success": true,
  "organization": {
    "id": "org_456",
    "name": "Acme Corp Development"
  },
  "projects": [
    {
      "id": "proj_123",
      "name": "Mobile App Development",
      "description": "Timer coordination for mobile app release",
      "access": {
        "user_123": "manager"
      },
      "timerCount": 25,
      "activeTimers": 8,
      "metadata": {
        "priority": "high",
        "department": "engineering",
        "tags": ["mobile", "ios", "android"]
      },
      "stats": {
        "totalDuration": 18000000,
        "avgDuration": 720000,
        "completionRate": 0.85
      },
      "createdAt": "2024-01-10T00:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 25,
    "offset": 0
  }
}
```

### Share Project

#### Endpoint
```http
POST /projects/{projectId}/share
```

#### Request Body
```json
{
  "users": [
    {
      "userId": "user_999",
      "role": "editor"
    },
    {
      "email": "external@partner.com",
      "role": "viewer",
      "temporary": true,
      "expiresAt": "2024-02-15T00:00:00Z"
    }
  ],
  "message": "Sharing project for collaboration",
  "notifyUsers": true
}
```

#### Response
```json
{
  "success": true,
  "shared": [
    {
      "userId": "user_999",
      "role": "editor",
      "status": "added"
    },
    {
      "email": "external@partner.com",
      "role": "viewer",
      "status": "invited",
      "inviteId": "inv_ext123",
      "expiresAt": "2024-02-15T00:00:00Z"
    }
  ]
}
```

---

## 💰 Billing & Subscriptions

### Get Subscription Details

#### Endpoint
```http
GET /billing/subscription
```

#### Response
```json
{
  "success": true,
  "subscription": {
    "id": "sub_abc123",
    "status": "active",
    "tier": "team",
    "plan": {
      "id": "plan_team_monthly",
      "name": "Team Monthly",
      "amount": 69,
      "currency": "USD",
      "interval": "month"
    },
    "currentPeriodStart": "2024-01-15T00:00:00Z",
    "currentPeriodEnd": "2024-02-15T00:00:00Z",
    "cancelAtPeriodEnd": false,
    "trialEnd": null,
    "discount": {
      "amount": 10,
      "type": "percent",
      "code": "NEWTEAM10"
    }
  },
  "billing": {
    "email": "billing@company.com",
    "nextInvoiceDate": "2024-02-15T00:00:00Z",
    "nextInvoiceAmount": 6210,
    "paymentMethod": {
      "type": "card",
      "last4": "4242",
      "brand": "visa",
      "expiryMonth": 12,
      "expiryYear": 2025
    }
  },
  "usage": {
    "currentPeriod": {
      "timersCreated": 245,
      "apiRequests": 15420,
      "storageUsed": "2.3GB"
    },
    "limits": {
      "timersPerMonth": -1,
      "apiRequestsPerMinute": 100,
      "storageLimit": "10GB"
    }
  }
}
```

### Create Checkout Session

#### Endpoint
```http
POST /billing/create-checkout
```

#### Request Body
```json
{
  "priceId": "price_team_monthly",
  "quantity": 1,
  "successUrl": "https://yourapp.com/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://yourapp.com/cancel",
  "metadata": {
    "organizationId": "org_456",
    "upgradeReason": "team_growth"
  },
  "discountCode": "NEWTEAM10",
  "allowPromotionCodes": true
}
```

#### Response
```json
{
  "success": true,
  "checkout": {
    "sessionId": "cs_test_abc123",
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_abc123",
    "expiresAt": "2024-01-15T11:30:00Z"
  }
}
```

### Access Billing Portal

#### Endpoint
```http
POST /billing/portal
```

#### Request Body
```json
{
  "returnUrl": "https://yourapp.com/account/billing"
}
```

#### Response
```json
{
  "success": true,
  "portalUrl": "https://billing.stripe.com/session/abc123",
  "expiresAt": "2024-01-15T11:30:00Z"
}
```

### Get Invoice History

#### Endpoint
```http
GET /billing/invoices
```

#### Response
```json
{
  "success": true,
  "invoices": [
    {
      "id": "in_abc123",
      "number": "MINOOTS-001",
      "status": "paid",
      "amount": 6900,
      "currency": "USD",
      "periodStart": "2024-01-15T00:00:00Z",
      "periodEnd": "2024-02-15T00:00:00Z",
      "paidAt": "2024-01-15T10:30:00Z",
      "dueDate": "2024-01-15T00:00:00Z",
      "downloadUrl": "https://invoice.stripe.com/abc123.pdf",
      "lineItems": [
        {
          "description": "MINOOTS Team Plan",
          "amount": 6900,
          "quantity": 1
        }
      ]
    }
  ]
}
```

---

## 📈 Analytics & Usage

### Get Usage Statistics

#### Endpoint
```http
GET /account/usage
```

#### Query Parameters
```http
GET /account/usage?days=30&granularity=daily&timezone=America/New_York
```

#### Response
```json
{
  "success": true,
  "period": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-15T23:59:59Z",
    "days": 30
  },
  "summary": {
    "totalTimers": 245,
    "totalDuration": 180000000,
    "avgDuration": 734693,
    "completionRate": 0.87,
    "apiRequests": 15420,
    "webhookDeliveries": 1230
  },
  "daily": [
    {
      "date": "2024-01-15",
      "timers": 12,
      "duration": 8640000,
      "apiRequests": 850,
      "webhooks": 65
    }
  ],
  "breakdown": {
    "byProject": [
      {
        "projectId": "proj_123",
        "name": "Mobile App",
        "timers": 45,
        "duration": 32400000,
        "percentage": 0.18
      }
    ],
    "byUser": [
      {
        "userId": "user_123",
        "name": "John Doe",
        "timers": 35,
        "duration": 25200000,
        "percentage": 0.14
      }
    ],
    "byStatus": {
      "completed": 213,
      "cancelled": 15,
      "expired": 17
    }
  },
  "limits": {
    "tier": "team",
    "monthly": {
      "timers": -1,
      "apiRequests": 100000,
      "used": {
        "timers": 245,
        "apiRequests": 15420
      }
    }
  }
}
```

### Get Organization Analytics

#### Endpoint
```http
GET /organizations/{orgId}/analytics
```

#### Response
```json
{
  "success": true,
  "organization": {
    "id": "org_456",
    "name": "Acme Corp Development"
  },
  "analytics": {
    "summary": {
      "totalMembers": 12,
      "activeMembers": 10,
      "totalProjects": 5,
      "activeProjects": 4,
      "totalTimers": 345,
      "activeTimers": 25
    },
    "productivity": {
      "avgTimersPerMember": 28.75,
      "avgProjectsPerMember": 2.3,
      "teamEfficiency": 0.89,
      "collaborationScore": 0.76
    },
    "trends": {
      "timerGrowth": 0.15,
      "memberGrowth": 0.08,
      "usageGrowth": 0.23
    },
    "topPerformers": {
      "mostActiveUsers": [
        {
          "userId": "user_123",
          "name": "John Doe",
          "timers": 45,
          "projects": 3
        }
      ],
      "mostActiveProjects": [
        {
          "projectId": "proj_123",
          "name": "Mobile App",
          "timers": 85,
          "members": 6
        }
      ]
    }
  }
}
```

---

## 🔔 Webhooks & Events

### Webhook Event Types

#### Timer Events
| Event | Description | Payload |
|-------|-------------|---------|
| `timer.created` | Timer was created | Timer object |
| `timer.started` | Timer started running | Timer object |
| `timer.progress` | Timer reached milestone | Timer object + progress |
| `timer.expired` | Timer reached end time | Timer object |
| `timer.cancelled` | Timer was cancelled | Timer object + reason |
| `timer.extended` | Timer duration extended | Timer object + extension |

#### Team Events
| Event | Description | Payload |
|-------|-------------|---------|
| `member.invited` | User invited to organization | Invitation object |
| `member.joined` | User joined organization | Member object |
| `member.role_changed` | User role updated | Member object + old/new roles |
| `member.removed` | User removed from organization | Member object + reason |

#### Project Events
| Event | Description | Payload |
|-------|-------------|---------|
| `project.created` | Project was created | Project object |
| `project.shared` | Project shared with users | Project object + shared users |
| `project.archived` | Project was archived | Project object |

### Webhook Configuration

#### Setting Up Webhooks
```http
POST /webhooks
Authorization: Bearer token
Content-Type: application/json

{
  "url": "https://yourapp.com/webhooks/minoots",
  "events": [
    "timer.expired",
    "timer.cancelled",
    "member.joined"
  ],
  "secret": "your_webhook_secret",
  "active": true,
  "metadata": {
    "environment": "production",
    "version": "v1"
  }
}
```

#### Webhook Payload Format
```json
{
  "id": "evt_abc123",
  "type": "timer.expired",
  "data": {
    "timer": {
      "id": "timer_abc123",
      "name": "Build Process",
      "status": "expired",
      "duration": 1800000,
      "projectId": "proj_123",
      "organizationId": "org_456"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z",
  "webhook": {
    "id": "hook_abc123",
    "attempt": 1,
    "maxAttempts": 3
  }
}
```

#### Webhook Security

##### Verifying Webhook Signatures
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware
app.post('/webhooks/minoots', express.raw({type: 'application/json'}), (req, res) => {
  const signature = req.headers['x-minoots-signature'];
  const isValid = verifyWebhookSignature(req.body, signature, WEBHOOK_SECRET);
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
  const event = JSON.parse(req.body);
  handleWebhook(event);
  
  res.status(200).send('OK');
});
```

---

## ❌ Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "error": {
    "type": "validation_error",
    "message": "Invalid timer duration",
    "code": "INVALID_DURATION",
    "details": {
      "field": "duration",
      "value": "invalid",
      "expected": "String in format '30s', '15m', '2h' or milliseconds"
    },
    "requestId": "req_abc123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request format or parameters |
| 401 | Unauthorized | Authentication required or invalid |
| 403 | Forbidden | Permission denied |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Resource already exists or conflict |
| 422 | Unprocessable Entity | Valid format but logical errors |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error |
| 503 | Service Unavailable | Temporary service disruption |

### Common Error Types

#### Authentication Errors
```json
{
  "success": false,
  "error": {
    "type": "authentication_error",
    "message": "Invalid API key",
    "code": "INVALID_API_KEY",
    "details": {
      "keyPrefix": "mnt_live_****",
      "reason": "Key not found or revoked"
    }
  }
}
```

#### Permission Errors
```json
{
  "success": false,
  "error": {
    "type": "permission_error",
    "message": "Insufficient permissions to delete timer",
    "code": "INSUFFICIENT_PERMISSIONS",
    "details": {
      "required": "owner or manager role",
      "current": "viewer",
      "upgradeUrl": "https://minoots.com/pricing"
    }
  }
}
```

#### Rate Limit Errors
```json
{
  "success": false,
  "error": {
    "type": "rate_limit_error",
    "message": "API rate limit exceeded",
    "code": "RATE_LIMIT_EXCEEDED",
    "details": {
      "limit": 100,
      "used": 100,
      "resetAt": "2024-01-15T11:00:00Z",
      "retryAfter": 300
    }
  }
}
```

#### Validation Errors
```json
{
  "success": false,
  "error": {
    "type": "validation_error",
    "message": "Multiple validation errors",
    "code": "VALIDATION_FAILED",
    "details": {
      "errors": [
        {
          "field": "name",
          "message": "Timer name is required",
          "code": "REQUIRED"
        },
        {
          "field": "duration",
          "message": "Duration must be between 1 second and 7 days",
          "code": "OUT_OF_RANGE",
          "min": "1s",
          "max": "7d"
        }
      ]
    }
  }
}
```

---

## 📝 Rate Limiting

### Rate Limit Headers

All API responses include rate limiting headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1642744200
X-RateLimit-Tier: team
```

### Rate Limits by Tier

| Tier | General API | Timer Creation | Organization Management |
|------|-------------|----------------|-------------------------|
| Free | 10/minute | 2/minute | Not available |
| Pro | 100/minute | 20/minute | Not available |
| Team | 500/minute | 100/minute | 10/minute |
| Enterprise | 2000/minute | 500/minute | 50/minute |

### Rate Limit Burst Allowance

- **Burst Window**: 1 minute
- **Burst Multiplier**: 2x normal limit
- **Reset**: Gradual refill over 5 minutes

### Handling Rate Limits

```javascript
async function makeRequest(url, options) {
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const resetTime = response.headers.get('X-RateLimit-Reset');
    
    console.log(`Rate limited. Retry after ${retryAfter}s`);
    
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return makeRequest(url, options);
  }
  
  return response;
}
```

---

## 🧪 Testing & Examples

### Postman Collection

#### Download Collection
```bash
curl -o minoots-api.json https://api-m3waemr5lq-uc.a.run.app/docs/postman-collection
```

#### Environment Variables
```json
{
  "MINOOTS_API_BASE": "https://api-m3waemr5lq-uc.a.run.app",
  "MINOOTS_API_KEY": "mnt_live_your_key_here",
  "FIREBASE_TOKEN": "your_firebase_token_here",
  "ORG_ID": "org_456",
  "PROJECT_ID": "proj_123"
}
```

### cURL Examples

#### Complete Timer Workflow
```bash
# 1. Create timer
TIMER_ID=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Deployment Timer",
    "duration": "30m",
    "events": {
      "on_expire": {
        "webhook": "https://hooks.slack.com/your-webhook"
      }
    }
  }' | jq -r '.timer.id')

# 2. Check timer status
curl -s -X GET https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID \
  -H "x-api-key: $MINOOTS_API_KEY" | jq '.timer.progress'

# 3. Extend timer if needed
curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID/extend \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "15m",
    "reason": "Need more time for testing"
  }'

# 4. Cancel timer if needed
curl -s -X DELETE https://api-m3waemr5lq-uc.a.run.app/timers/$TIMER_ID \
  -H "x-api-key: $MINOOTS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Deployment cancelled"
  }'
```

#### Team Management Workflow
```bash
# 1. Create organization
ORG_ID=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/organizations \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Organization",
    "settings": {
      "defaultTimerDuration": "1h"
    }
  }' | jq -r '.organization.id')

# 2. Create project
PROJECT_ID=$(curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/$ORG_ID/projects \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Project",
    "description": "Project for testing"
  }' | jq -r '.project.id')

# 3. Invite team member
curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/$ORG_ID/invite \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teammate@company.com",
    "role": "editor",
    "projectIds": ["'$PROJECT_ID'"]
  }'

# 4. Create timer in project
curl -s -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Sprint Timer",
    "duration": "2h",
    "projectId": "'$PROJECT_ID'",
    "organizationId": "'$ORG_ID'"
  }'
```

### SDKs and Libraries

#### Official Node.js SDK
```bash
npm install @minoots/sdk
```

```javascript
const { MinootsClient } = require('@minoots/sdk');

const minoots = new MinootsClient({
  apiKey: process.env.MINOOTS_API_KEY
});

// Create and monitor timer
const timer = await minoots.timers.create({
  name: 'Build Process',
  duration: '15m',
  events: {
    on_expire: {
      webhook: 'https://ci.yourcompany.com/build-complete'
    }
  }
});

console.log(`Timer created: ${timer.id}`);
```

#### Python Library (Community)
```bash
pip install minoots-python
```

```python
from minoots import MinootsClient

client = MinootsClient(api_key=os.getenv('MINOOTS_API_KEY'))

timer = client.timers.create(
    name='Data Processing',
    duration='2h',
    webhook='https://analytics.company.com/job-complete'
)

print(f"Timer created: {timer.id}")
```

### Testing Checklist

#### API Integration Testing
- [ ] Authentication with API keys works
- [ ] Authentication with Firebase tokens works
- [ ] Rate limiting is enforced correctly
- [ ] Error responses include proper details
- [ ] Webhooks are delivered reliably

#### Team Feature Testing
- [ ] Organization creation and management
- [ ] User invitation and role assignment
- [ ] Project creation and sharing
- [ ] Permission enforcement at all levels
- [ ] Billing integration and upgrades

#### Performance Testing
- [ ] API response times under load
- [ ] Permission check latency
- [ ] Webhook delivery performance
- [ ] Database query optimization
- [ ] Concurrent user handling

---

**🚀 This API documentation provides everything needed to integrate with MINOOTS Enterprise RBAC system. For additional support, contact our developer team at api@minoots.com**