# 🔐 PERMISSION MANAGEMENT GUIDE

**Understanding role-based permissions in MINOOTS.**

---

## 🎯 PERMISSION HIERARCHY

MINOOTS implements a Role-Based Access Control (RBAC) system to manage user permissions across different tiers, organizations, and resources.

### System-Level Permissions (Tier-Based)
Your subscription tier determines your system-level capabilities.

*   **Free Tier**: Limited timer creations, basic webhooks.
*   **Pro Tier**: Unlimited timer creations, MCP integration.
*   **Team Tier**: Organization management, shared projects.
*   **Enterprise Tier**: Custom deployments, advanced support.

### Organization-Level Roles
Within an organization, users are assigned roles that define their permissions.

*   **VIEWER**: Read-only access to organization resources (timers, projects).
*   **EDITOR**: Can create and edit timers within the organization.
*   **MANAGER**: Can create and manage projects, delete timers.
*   **ADMIN**: Can invite/remove members, change user roles (lower than their own), manage organization settings.
*   **OWNER**: Full control over the organization, including billing and deletion.

### Resource-Level Permissions
Permissions can also be applied directly to specific resources (like projects or individual timers) for granular control.

---

## 🔄 PERMISSION CHECKING FLOW

MINOOTS checks permissions in a hierarchical manner:

1.  **System-Level (Tier)**: First, your overall tier determines what features you can access.
2.  **Organization-Level**: If you are part of an organization, your role within that organization grants permissions to its resources.
3.  **Resource-Specific**: Finally, explicit permissions on a specific resource (e.g., a project) can grant additional access.

---

## 🛡️ SECURITY CONSIDERATIONS

*   **Principle of Least Privilege**: Always assign the minimum necessary role to users.
*   **No Shared Accounts**: Each user should have their own account and API key.
*   **Privilege Escalation Prevention**: Users cannot assign roles higher than their own.
*   **Cross-Organization Isolation**: Users can only access resources within organizations they are explicitly a member of.

---

## 📊 AUDIT LOGS

MINOOTS logs administrative actions related to permissions (e.g., role changes, organization creation). These logs are primarily for internal system auditing and are not currently exposed via a public API or dashboard.

---

**Note**: While the RBAC system is robust, the API currently does not expose endpoints for all permission management actions (e.g., changing user roles within an organization or granting project-specific access via API). These actions are typically performed through administrative interfaces or direct database manipulation by system administrators.