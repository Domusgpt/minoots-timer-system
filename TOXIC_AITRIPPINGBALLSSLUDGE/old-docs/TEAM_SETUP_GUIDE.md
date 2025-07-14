# 👥 MINOOTS TEAM SETUP GUIDE

**Transform your individual MINOOTS account into a collaborative team workspace.**

---

## 🚀 QUICK START (5 MINUTES)

### Step 1: Upgrade to Team Tier
1. **Visit**: [minoots.com/pricing](https://minoots.com/pricing)
2. **Click**: "Upgrade to Team" ($69/month)
3. **Complete**: Payment setup
4. **Receive**: Team features activated immediately

### Step 2: Create Your Organization
```bash
# API Call to create organization
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp Development Team",
    "slug": "acme-dev"
  }'
```

**Response:**
```json
{
  "success": true,
  "organization": {
    "id": "org_abc123",
    "name": "Acme Corp Development Team",
    "slug": "acme-dev",
    "members": {
      "user_your_id": "owner"
    }
  }
}
```

### Step 3: Invite Team Members
```bash
# Invite a developer
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/invite \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "developer@acme.com",
    "role": "editor"
  }'
```

---

## 🎯 TEAM ROLES EXPLAINED

### 🔍 **Viewer**
**Perfect for**: Stakeholders, clients, project managers
- ✅ View all timers and projects
- ✅ Receive notifications
- ✅ Access team dashboard
- ❌ Cannot create or modify anything

### ✏️ **Editor**
**Perfect for**: Developers, active contributors
- ✅ Everything Viewer can do
- ✅ Create and edit timers
- ✅ Join project collaborations
- ❌ Cannot delete timers or manage team

### 🎛️ **Manager**
**Perfect for**: Project leads, team coordinators
- ✅ Everything Editor can do
- ✅ Delete timers and cancel operations
- ✅ Create and manage projects
- ✅ Set project permissions
- ❌ Cannot manage team members

### 👨‍💼 **Admin**
**Perfect for**: Technical leads, department heads
- ✅ Everything Manager can do
- ✅ Invite and remove team members
- ✅ Change user roles
- ✅ Access usage analytics
- ❌ Cannot access billing or delete organization

### 👑 **Owner**
**Perfect for**: Business owners, account managers
- ✅ Everything Admin can do
- ✅ Billing and subscription management
- ✅ Organization settings
- ✅ Delete organization (careful!)

---

## 📁 PROJECT MANAGEMENT

### Creating Projects
Projects group related timers and define collaboration scope.

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/projects \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mobile App Launch",
    "description": "Timer coordination for iOS/Android release",
    "settings": {
      "defaultTimerDuration": "2h",
      "autoTagging": true
    },
    "access": {
      "user_dev1": "manager",
      "user_dev2": "editor"
    }
  }'
```

### Project Benefits
- **Organized Timers**: Group by feature, sprint, or milestone
- **Team Coordination**: Shared visibility and collaboration
- **Permission Control**: Project-specific access levels
- **Analytics**: Project-level usage and performance metrics

---

## ⏲️ COLLABORATIVE TIMERS

### Creating Team Timers
```javascript
// Create timer within project context
const teamTimer = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${firebaseToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Sprint Planning Session',
    duration: '2h',
    organizationId: 'org_abc123',
    projectId: 'proj_mobile_launch',
    events: {
      on_expire: {
        webhook: 'https://slack.com/webhook/dev-team',
        message: '🏁 Sprint planning session completed!'
      }
    }
  })
});
```

### Team Notifications
```bash
# Broadcast message to team
curl -X POST https://api-m3waemr5lq-uc.a.run.app/teams/dev-team/broadcast \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Deployment window starts in 30 minutes",
    "webhook": "https://slack.com/webhook/dev-team"
  }'
```

---

## 🔐 SECURITY & PERMISSIONS

### API Key Management
Team accounts get organization-level API keys:

```bash
# Generate team API key
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Production Key",
    "organizationId": "org_abc123",
    "permissions": ["create_timers", "manage_projects"]
  }'
```

### Permission Inheritance
- **Organization Level**: Access to all org resources
- **Project Level**: Specific project permissions
- **Timer Level**: Individual timer collaboration

### Security Best Practices
- ✅ Use role-based permissions (don't make everyone Admin)
- ✅ Create project-specific access when possible
- ✅ Regularly audit team member access
- ✅ Use separate API keys for different environments
- ✅ Monitor usage analytics for unusual activity

---

## 📊 USAGE ANALYTICS

### Team Dashboard
Access your team metrics:
```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/usage \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

**Response includes:**
- Timer creation by team member
- Project activity and performance
- API usage and rate limiting
- Billing and subscription status

### Key Metrics to Monitor
- **Active Timers**: Current team workload
- **Completion Rates**: Project delivery performance
- **Collaboration Index**: Cross-team timer sharing
- **API Efficiency**: Response times and usage patterns

---

## 🚨 TROUBLESHOOTING

### Common Issues

#### "Organization not found"
- **Cause**: User not added to organization
- **Fix**: Admin must invite user with proper email

#### "Permission denied"
- **Cause**: User role insufficient for action
- **Fix**: Admin upgrades user role or owner adjusts permissions

#### "Tier upgrade required"
- **Cause**: Free/Pro user trying to access Team features
- **Fix**: Upgrade to Team tier ($69/month)

#### "API key invalid"
- **Cause**: Using individual API key for team operations
- **Fix**: Generate organization-level API key

### Getting Help
1. **Check logs**: Organization audit trail in dashboard
2. **Contact support**: [support@minoots.com](mailto:support@minoots.com)
3. **Review permissions**: User role vs required action
4. **API reference**: [Complete documentation](./API_REFERENCE.md)

---

## 🎯 COMMON WORKFLOWS

### Daily Standup Coordination
```javascript
// 15-minute standup timer with team notification
const standupTimer = {
  name: 'Daily Standup',
  duration: '15m',
  organizationId: 'org_abc123',
  events: {
    on_expire: {
      webhook: 'https://slack.com/webhook/standup-complete',
      message: '✅ Standup time completed - async updates now!'
    }
  }
};
```

### Sprint Management
```javascript
// 2-week sprint with milestone notifications
const sprintTimer = {
  name: 'Q1 Sprint 3',
  duration: '14d',
  projectId: 'proj_q1_features',
  events: {
    on_progress: {
      webhook: 'https://slack.com/webhook/sprint-progress',
      intervals: ['25%', '50%', '75%', '90%']
    },
    on_expire: {
      webhook: 'https://slack.com/webhook/sprint-complete',
      message: '🏁 Sprint completed! Time for retrospective.'
    }
  }
};
```

### Deployment Windows
```javascript
// 4-hour deployment window with escalation
const deploymentWindow = {
  name: 'Production Deployment Window',
  duration: '4h',
  organizationId: 'org_abc123',
  metadata: {
    priority: 'critical',
    escalationPolicy: 'immediate'
  },
  events: {
    on_expire: {
      webhook: 'https://pagerduty.com/webhook/deployment-timeout',
      message: '🚨 Deployment window exceeded - investigate immediately'
    }
  }
};
```

---

## 💰 BILLING & UPGRADES

### Team Tier Benefits
- **Unlimited timers** (no daily/monthly limits)
- **Unlimited team members** (up to 50 users)
- **5 organizations** per account
- **25 projects** per organization
- **Advanced webhooks** with retry logic
- **Priority support** (chat + phone)
- **90-day analytics** and audit trails

### Cost Management
- **Fixed pricing**: $69/month regardless of usage
- **No per-user fees**: Add unlimited team members
- **No overage charges**: Unlimited timers and API calls
- **Annual discount**: 2 months free with yearly billing

### Enterprise Upgrade
**When you need Enterprise tier:**
- More than 5 organizations
- More than 50 team members
- SSO integration (SAML, OIDC)
- Custom deployment options
- SLA guarantees (99.99% uptime)
- Dedicated support manager

**Contact**: [enterprise@minoots.com](mailto:enterprise@minoots.com)

---

**🚀 Ready to transform your timer workflows? [Upgrade to Team tier](https://minoots.com/pricing) and start collaborating in minutes!**