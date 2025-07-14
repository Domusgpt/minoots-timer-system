# Team Features Guide

**Organization and project management for teams**

## Overview

Team features require **Team tier** subscription (verified at line 464). These features enable multi-user collaboration through organizations and projects.

## Organizations

### Create Organization
**Requires**: Team tier + 'create organizations' permission

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "slug": "my-company",
    "settings": {}
  }'
```

### List Organizations
Shows organizations user has access to.

```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/organizations
```

Response:
```json
{
  "success": true,
  "organizations": [
    {
      "id": "org_123",
      "name": "My Company",
      "role": "admin",
      "slug": "my-company"
    }
  ],
  "count": 1
}
```

### Get Organization Details
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/organizations/org_123
```

## User Management

### Invite User to Organization
**⚠️ BROKEN ENDPOINT**: This feature is BROKEN!

```bash
# THIS WILL CRASH THE API:
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_123/invite \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "role": "editor"
  }'
```

**Problem**: API calls `inviteUserToOrganization()` method that doesn't exist in FirestoreSchema.js.
**Result**: Returns 500 error when attempted.

**Available Roles** (from RoleDefinitions.js):
- `viewer` - Read-only access
- `editor` - Create/edit resources
- `manager` - Manage projects
- `admin` - Manage users
- `owner` - Full control

## Projects

### Create Project
**Requires**: Manager role or higher in organization

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_123/projects \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API",
    "description": "Main production environment",
    "settings": {},
    "access": {}
  }'
```

### List Organization Projects
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/organizations/org_123/projects
```

## Timer Scoping

Timers can be scoped to organizations and projects:

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Org timer",
    "duration": "5m",
    "organizationId": "org_123",
    "projectId": "project_456"
  }'
```

**Access Control**: 
- Users can only see timers from their organizations
- Timer filtering checks organization membership (lines 291-296)

## Team Broadcasts

Send messages to all team members:

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/teams/dev_team/broadcast \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Deployment starting in 5 minutes",
    "data": { "deploymentId": "dep_789" }
  }'
```

**Note**: Requires 'manage teams' permission.

## RBAC Integration

Team features use Role-Based Access Control:

1. **Custom Claims**: Roles stored in Firebase Custom Claims for fast access
2. **Firestore Backup**: Full permissions in Firestore for complex queries
3. **Permission Checking**: <20ms with JWT claims, <100ms with Firestore
4. **Automatic Sync**: Role changes sync via Cloud Function triggers

## Implementation Status

**Verified from code**:
- ✅ Organization CRUD endpoints exist
- ✅ Project management endpoints exist  
- ⚠️ User invitation endpoint BROKEN (calls non-existent method)
- ✅ Team broadcast endpoint exists
- ✅ RBAC middleware integrated

**BROKEN Features**:
- ❌ User invitations (API crashes - missing method)
- ❓ Invitation acceptance flow (probably doesn't exist)
- ❓ Email sending for invitations (definitely not implemented)

**Unknown/Unverified**:
- ❓ Organization deletion
- ❓ User removal from organizations
- ❓ Project deletion

## Limitations

1. **No organization switching**: Must authenticate per organization
2. **No cross-org timers**: Timers belong to single organization
3. **No team analytics**: Usage stats not aggregated by team
4. **No audit logs**: Actions not tracked for compliance
5. **Basic roles only**: No custom role creation

---

**Changes from Previous Versions:**
- ✅ **Verified endpoints**: All organization/project endpoints confirmed
- ✅ **Real role hierarchy**: Actual roles from RoleDefinitions.js
- ✅ **Implementation gaps**: Marked unverified features
- ✅ **RBAC integration**: Explained Custom Claims system
- ✅ **Access control**: Timer filtering logic verified