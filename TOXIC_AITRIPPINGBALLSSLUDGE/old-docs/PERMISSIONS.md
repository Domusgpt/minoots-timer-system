# 🔐 PERMISSION MANAGEMENT GUIDE

**Complete guide to role-based permissions in MINOOTS teams and organizations.**

## 🎯 PERMISSION HIERARCHY

### System-Level Permissions (Tier-Based)
```javascript
// Free Tier
{
  "create_timers": "limited", // 5 concurrent, 100/month
  "use_webhooks": "basic",
  "api_access": "limited",
  "history_days": 7
}

// Pro Tier ($19/month)
{
  "create_timers": "unlimited",
  "use_webhooks": "advanced",
  "mcp_integration": true,
  "api_access": "unlimited",
  "history_days": 90
}

// Team Tier ($69/month)
{
  "create_organizations": true,
  "manage_team_members": true,
  "shared_projects": true,
  "team_analytics": true,
  "priority_support": true
}

// Enterprise Tier (Custom)
{
  "sso_integration": true,
  "custom_deployment": true,
  "sla_guarantees": true,
  "dedicated_support": true
}
```

### Organization-Level Roles

#### 👑 OWNER
**Full Control**: Billing, organization deletion, all management
```javascript
{
  "permissions": [
    "manage_billing",
    "delete_organization", 
    "manage_all_members",
    "create_projects",
    "manage_settings",
    "view_analytics",
    "create_api_keys"
  ],
  "inherits": ["admin", "manager", "editor", "viewer"]
}
```

#### 👨‍💼 ADMIN  
**Team Management**: User roles, organization settings
```javascript
{
  "permissions": [
    "manage_members",
    "change_user_roles", 
    "manage_projects",
    "view_analytics",
    "manage_settings"
  ],
  "inherits": ["manager", "editor", "viewer"],
  "cannot": ["manage_billing", "delete_organization"]
}
```

#### 🎛️ MANAGER
**Project Leadership**: Project creation, team coordination
```javascript
{
  "permissions": [
    "create_projects",
    "delete_timers",
    "manage_project_access",
    "view_team_timers"
  ],
  "inherits": ["editor", "viewer"],
  "cannot": ["manage_members", "change_roles"]
}
```

#### ✏️ EDITOR
**Active Contributor**: Create and modify timers
```javascript
{
  "permissions": [
    "create_timers",
    "edit_own_timers",
    "collaborate_on_timers",
    "use_webhooks"
  ],
  "inherits": ["viewer"],
  "cannot": ["delete_timers", "manage_projects"]
}
```

#### 🔍 VIEWER
**Observer Access**: Read-only team visibility
```javascript
{
  "permissions": [
    "view_timers",
    "view_projects", 
    "receive_notifications"
  ],
  "cannot": ["create_anything", "modify_anything"]
}
```

## 📁 PROJECT-LEVEL PERMISSIONS

### Project Access Control
```javascript
// Project with mixed permissions
{
  "projectId": "proj_mobile_app",
  "access": {
    "user_lead": "owner",      // Full project control
    "user_dev1": "editor",     // Can create/edit timers
    "user_dev2": "editor",     // Can create/edit timers  
    "user_qa": "viewer",       // Can see progress
    "user_pm": "manager"       // Can delete timers
  }
}
```

### Permission Inheritance
```
Organization Role + Project Role = Effective Permissions

Examples:
- Org Admin + Project Viewer = Admin (org role wins)
- Org Editor + Project Manager = Manager (higher project role)
- Org Viewer + Project Editor = Editor (project grants more access)
```

## ⏲️ TIMER-LEVEL PERMISSIONS

### Timer Access Rules
```javascript
// Timer ownership and collaboration
{
  "timerId": "timer_123",
  "createdBy": "user_dev1",
  "organizationId": "org_abc",
  "projectId": "proj_mobile", 
  "access": {
    "user_dev1": "owner",      // Creator has full control
    "user_dev2": "collaborator" // Can edit this specific timer
  }
}
```

### Access Calculation
```javascript
function calculateTimerAccess(user, timer) {
  // 1. Timer creator always has access
  if (timer.createdBy === user.id) {
    return "owner";
  }
  
  // 2. Check explicit timer-level access
  if (timer.access[user.id]) {
    return timer.access[user.id];
  }
  
  // 3. Check project-level access
  if (timer.projectId && user.projects[timer.projectId]) {
    return user.projects[timer.projectId];
  }
  
  // 4. Check organization-level access
  if (timer.organizationId && user.organizations[timer.organizationId]) {
    const orgRole = user.organizations[timer.organizationId];
    return mapOrgRoleToTimerAccess(orgRole);
  }
  
  // 5. Default: no access
  return null;
}
```

## 🔄 PERMISSION CHECKING FLOW

### API Permission Validation
```javascript
// Real implementation in auth middleware
const checkPermission = async (userId, action, resourceType, resourceId) => {
  // 1. Get user's Custom Claims (fast check)
  const claims = await getUserClaims(userId);
  
  // 2. Check system-level permissions first
  if (hasSystemPermission(claims.tier, action, resourceType)) {
    return { allowed: true, source: 'system_tier' };
  }
  
  // 3. Check organization-level permissions
  if (resourceId && claims.organizations) {
    const orgAccess = findOrganizationAccess(claims.organizations, resourceId);
    if (orgAccess && hasOrgPermission(orgAccess.role, action, resourceType)) {
      return { allowed: true, source: 'organization_role' };
    }
  }
  
  // 4. Check resource-specific permissions (Firestore lookup)
  if (resourceId) {
    const resourceAccess = await getResourceAccess(resourceType, resourceId, userId);
    if (resourceAccess && hasResourcePermission(resourceAccess, action)) {
      return { allowed: true, source: 'resource_specific' };
    }
  }
  
  return { 
    allowed: false, 
    reason: 'insufficient_permissions',
    required: { action, resourceType }
  };
};
```

## 🛡️ SECURITY BOUNDARIES

### Cross-Organization Isolation
```javascript
// Users cannot access other organizations' resources
const enforceOrganizationBoundary = (user, resource) => {
  if (resource.organizationId && !user.organizations[resource.organizationId]) {
    throw new Error('Cross-organization access denied');
  }
};
```

### Privilege Escalation Prevention
```javascript
// Users cannot assign roles higher than their own
const validateRoleAssignment = (assignerRole, targetRole) => {
  const roleHierarchy = {
    'viewer': 1, 'editor': 2, 'manager': 3, 'admin': 4, 'owner': 5
  };
  
  if (roleHierarchy[targetRole] >= roleHierarchy[assignerRole]) {
    throw new Error('Cannot assign role equal or higher than your own');
  }
};
```

## 📊 PERMISSION AUDITING

### Audit Log Structure
```javascript
{
  "type": "permission_change",
  "timestamp": "2024-01-15T10:30:00Z",
  "actor": {
    "userId": "user_admin",
    "role": "admin"
  },
  "target": {
    "userId": "user_dev1", 
    "previousRole": "editor",
    "newRole": "manager"
  },
  "resource": {
    "type": "organization",
    "id": "org_abc123"
  },
  "metadata": {
    "reason": "Promoted to project lead",
    "source": "dashboard_ui"
  }
}
```

### Permission Review Queries
```javascript
// Get all users with admin+ access to organization
const getHighPrivilegeUsers = async (organizationId) => {
  return await db.collection('organizations')
    .doc(organizationId)
    .get()
    .then(doc => {
      const members = doc.data().members;
      return Object.entries(members)
        .filter(([userId, role]) => ['admin', 'owner'].includes(role))
        .map(([userId, role]) => ({ userId, role }));
    });
};
```

## 🔧 PERMISSION MANAGEMENT APIs

### Change User Role
```bash
curl -X PUT https://api-m3waemr5lq-uc.a.run.app/organizations/org_123/members/user_456 \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "manager",
    "reason": "Promoted to team lead"
  }'
```

### Grant Project Access
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/projects/proj_123/access \
  -H "Authorization: Bearer MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_789",
    "role": "editor",
    "expiresAt": "2024-12-31T23:59:59Z"
  }'
```

### Remove Organization Access
```bash
curl -X DELETE https://api-m3waemr5lq-uc.a.run.app/organizations/org_123/members/user_456 \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{
    "reason": "Left company"
  }'
```

## 🎯 BEST PRACTICES

### Role Assignment Guidelines
- ✅ **Principle of Least Privilege**: Give minimum required access
- ✅ **Regular Reviews**: Audit permissions quarterly  
- ✅ **Time-Limited Access**: Set expiration dates for contractors
- ✅ **Clear Responsibility**: Document who can change roles
- ✅ **Separation of Duties**: No single person has all permissions

### Common Permission Patterns
```javascript
// Development Team Structure
{
  "tech_lead": "admin",        // Can manage team
  "senior_devs": "manager",    // Can create projects
  "developers": "editor",      // Can create timers
  "qa_team": "viewer",         // Can see progress
  "product_manager": "viewer"  // Can see metrics
}

// Project-Specific Access
{
  "project_owner": "owner",    // Full project control
  "contributors": "editor",    // Can add timers
  "stakeholders": "viewer"     // Can see status
}
```

### Security Checklist
- [ ] All roles follow least privilege principle
- [ ] No shared accounts or API keys
- [ ] Regular permission audits scheduled
- [ ] Cross-organization access blocked
- [ ] Privilege escalation prevention tested
- [ ] All permission changes logged
- [ ] Emergency access procedures documented