# Team Features Guide

**Organization and team functionality in MINOOTS**

*Note: Team features are implemented in code but may require additional setup and testing*

## Overview

MINOOTS supports team collaboration through organizations, projects, and role-based permissions. Teams can share timers, coordinate workflows, and manage access controls.

## Getting Started with Teams

### 1. Create an Organization

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Team",
    "description": "Team organization for timer coordination"
  }'
```

Response:
```json
{
  "id": "org_abc123",
  "name": "My Team", 
  "description": "Team organization for timer coordination",
  "ownerId": "user_456",
  "createdAt": "2025-01-13T23:45:00Z"
}
```

### 2. Invite Team Members

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/invite \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teammate@company.com",
    "role": "EDITOR"
  }'
```

### 3. Create a Project

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/projects \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Website Deploy",
    "description": "Deployment workflow timers",
    "access": {
      "user_789": "editor",
      "user_101": "viewer"
    }
  }'
```

## Organization Roles

### OWNER
- Full control over organization
- Manage all members and roles
- Delete organization
- Access to all projects and timers

### ADMIN  
- Manage members (invite, remove, change roles)
- Create and manage projects
- Access to all organization timers
- Cannot delete organization

### MANAGER
- Create and manage projects they own
- Manage timers in their projects
- Invite members to their projects
- View organization member list

### EDITOR
- Create timers in assigned projects
- Modify timers they created
- View project timers
- Cannot manage members

### VIEWER
- View organization and project timers
- Cannot create or modify timers
- Cannot manage members

## Project-Level Permissions

Projects have their own access controls:

```json
{
  "access": {
    "user_123": "owner",
    "user_456": "editor", 
    "user_789": "viewer"
  }
}
```

### Project Roles
- **owner** - Full control over project
- **editor** - Create and modify project timers  
- **viewer** - Read-only access

## Team Timer Operations

### Create Team Timer

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "30m",
    "name": "Deploy timeout",
    "organizationId": "org_abc123",
    "projectId": "project_def456",
    "webhook": "https://your-team-webhook.com/deploy-timeout"
  }'
```

### List Team Timers

```bash
# All organization timers
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api-m3waemr5lq-uc.a.run.app/timers?organizationId=org_abc123"

# Project-specific timers  
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api-m3waemr5lq-uc.a.run.app/timers?projectId=project_def456"
```

### Team Broadcast

Send messages to team members:

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/teams/org_abc123/broadcast \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Deployment phase 1 complete",
    "metadata": {
      "phase": 1,
      "status": "complete"
    }
  }'
```

## Team Workflow Patterns

### Coordinated Deployments

```javascript
// Create deployment phases with timers
async function startDeployment() {
  // Phase 1: Build timeout
  const buildTimer = await client.createTimer({
    duration: '10m',
    name: 'Build phase timeout',
    organizationId: 'org_abc123',
    projectId: 'deploy_project',
    webhook: 'https://ci.company.com/api/build-timeout',
    metadata: {
      phase: 'build',
      deployment_id: 'deploy_456'
    }
  });
  
  // Phase 2: Test timeout  
  const testTimer = await client.createTimer({
    duration: '15m',
    name: 'Test phase timeout',
    organizationId: 'org_abc123', 
    projectId: 'deploy_project',
    webhook: 'https://ci.company.com/api/test-timeout',
    metadata: {
      phase: 'test',
      deployment_id: 'deploy_456'
    }
  });
  
  // Notify team
  await client.broadcastToTeam('org_abc123', {
    message: 'Deployment started with timeout monitoring',
    metadata: { deployment_id: 'deploy_456' }
  });
}
```

### Sprint Management

```javascript
// Daily standup reminders
async function setupSprintTimers() {
  const sprintDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  
  for (const day of sprintDays) {
    await client.createTimer({
      duration: '24h', // Daily recurring manually
      name: `${day} standup reminder`,
      organizationId: 'org_abc123',
      webhook: 'https://slack.com/hooks/standup-reminder',
      metadata: {
        type: 'standup',
        day: day
      }
    });
  }
}
```

### Multi-Agent Coordination

```javascript
// Coordinate multiple AI agents
async function coordinateAgents() {
  // Agent coordination session
  const sessionTimer = await client.createTimer({
    duration: '2h',
    name: 'Agent coordination session',
    organizationId: 'ai_team',
    webhook: 'https://agent-coordinator.com/api/session-timeout',
    metadata: {
      session_id: 'session_789',
      agents: ['agent_1', 'agent_2', 'agent_3']
    }
  });
  
  // Notify all agents
  await client.broadcastToTeam('ai_team', {
    message: 'Coordination session started',
    metadata: {
      session_id: 'session_789',
      timer_id: sessionTimer.id
    }
  });
}
```

## Permission Validation

The API automatically validates:

### Organization Permissions
- User must be member of organization
- Role must allow the requested action
- Organization must exist and be active

### Project Permissions  
- User must have access to project
- Project role must allow the action
- Project must belong to organization

### Timer Permissions
- User can access timers they created
- Organization members can see org timers (based on role)
- Project members can see project timers (based on access)

## Team Management

### List Organization Members

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/members
```

### Update Member Role

*Note: This endpoint may not be implemented yet*

```bash
curl -X PUT https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/members/user_456 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "ADMIN"
  }'
```

### Remove Member

*Note: This endpoint may not be implemented yet*

```bash
curl -X DELETE https://api-m3waemr5lq-uc.a.run.app/organizations/org_abc123/members/user_456 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Limitations

### Current Limitations
- **No team dashboard** - No web UI for team management
- **Basic analytics** - Limited team usage analytics  
- **Manual role management** - Some role operations may require API calls
- **No organization-level API keys** - API keys are user-scoped

### Planned Features
*These may be on the roadmap but are not implemented:*
- Team usage analytics dashboard
- Organization-level API keys
- Advanced permission granularity
- Automated member provisioning

## Troubleshooting

### Permission Denied Errors
- Verify user is member of organization
- Check user's role allows the action
- Confirm project access if applicable

### Organization Not Found
- Verify organization ID is correct
- Check user has access to organization
- Confirm organization exists

### Team Features Not Working
- Team features require RBAC system to be fully deployed
- Check if organization and project creation works
- Verify role-based permissions are functioning

*Note: Team features are implemented in code but may need additional setup and testing to be fully functional*