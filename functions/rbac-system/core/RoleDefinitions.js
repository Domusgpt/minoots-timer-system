/**
 * MINOOTS RBAC - Role Definitions and Hierarchy
 * Defines the complete role system for organizations, projects, and resources
 */

// Role hierarchy levels (higher number = more permissions)
const ROLE_LEVELS = {
  'viewer': 1,
  'editor': 2, 
  'manager': 3,
  'admin': 4,
  'owner': 5,
  'super_admin': 6
};

// System-wide permissions (stored in Custom Claims)
const SYSTEM_PERMISSIONS = {
  // Tier-based permissions
  'use_mcp_integration': ['pro', 'team', 'enterprise'],
  'advanced_webhooks': ['pro', 'team', 'enterprise'],
  'priority_support': ['pro', 'team', 'enterprise'],
  'unlimited_timers': ['pro', 'team', 'enterprise'],
  
  // Team-specific permissions
  'manage_organization': ['team', 'enterprise'],
  'invite_users': ['team', 'enterprise'],
  'view_analytics': ['team', 'enterprise'],
  
  // Enterprise-only permissions
  'sso_access': ['enterprise'],
  'audit_logs': ['enterprise'],
  'custom_deployment': ['enterprise'],
  'dedicated_support': ['enterprise']
};

// Resource-level permissions (stored in Firestore documents)
const RESOURCE_PERMISSIONS = {
  'timers': {
    'view': ['viewer', 'editor', 'manager', 'admin', 'owner'],
    'create': ['editor', 'manager', 'admin', 'owner'],
    'edit': ['editor', 'manager', 'admin', 'owner'],
    'delete': ['manager', 'admin', 'owner'],
    'share': ['manager', 'admin', 'owner']
  },
  
  'projects': {
    'view': ['viewer', 'editor', 'manager', 'admin', 'owner'],
    'edit': ['manager', 'admin', 'owner'],
    'delete': ['admin', 'owner'],
    'manage_access': ['admin', 'owner'],
    'export_data': ['manager', 'admin', 'owner']
  },
  
  'organizations': {
    'view': ['viewer', 'editor', 'manager', 'admin', 'owner'],
    'manage_members': ['admin', 'owner'],
    'manage_billing': ['owner'],
    'manage_settings': ['admin', 'owner'],
    'delete': ['owner']
  }
};

// Default roles for new users/resources
const DEFAULT_ROLES = {
  'new_user_in_org': 'viewer',
  'project_creator': 'owner',
  'timer_creator': 'owner',
  'invited_user': 'editor'
};

/**
 * Role validation and hierarchy management
 */
class RoleManager {
  
  /**
   * Check if a role has permission for a specific action on a resource type
   */
  static hasPermission(userRole, action, resourceType) {
    const allowedRoles = RESOURCE_PERMISSIONS[resourceType]?.[action];
    if (!allowedRoles) return false;
    
    return allowedRoles.includes(userRole);
  }
  
  /**
   * Check if a role is higher in hierarchy than another
   */
  static isRoleHigher(role1, role2) {
    return ROLE_LEVELS[role1] > ROLE_LEVELS[role2];
  }
  
  /**
   * Get the highest role from a list of roles
   */
  static getHighestRole(roles) {
    return roles.reduce((highest, current) => {
      return this.isRoleHigher(current, highest) ? current : highest;
    }, 'viewer');
  }
  
  /**
   * Check if user tier has access to a system permission
   */
  static hasSystemPermission(userTier, permission) {
    const allowedTiers = SYSTEM_PERMISSIONS[permission];
    if (!allowedTiers) return false;
    
    return allowedTiers.includes(userTier);
  }
  
  /**
   * Get all permissions for a role and resource type
   */
  static getRolePermissions(role, resourceType) {
    const permissions = [];
    const resourcePerms = RESOURCE_PERMISSIONS[resourceType];
    
    if (!resourcePerms) return permissions;
    
    for (const [action, allowedRoles] of Object.entries(resourcePerms)) {
      if (allowedRoles.includes(role)) {
        permissions.push(action);
      }
    }
    
    return permissions;
  }
  
  /**
   * Validate that a role exists and is valid
   */
  static isValidRole(role) {
    return Object.keys(ROLE_LEVELS).includes(role);
  }
  
  /**
   * Get role level for sorting/comparison
   */
  static getRoleLevel(role) {
    return ROLE_LEVELS[role] || 0;
  }
  
  /**
   * Check if user can assign a role (can only assign roles lower than their own)
   */
  static canAssignRole(assignerRole, targetRole) {
    return this.isRoleHigher(assignerRole, targetRole);
  }
}

/**
 * Custom Claims structure for JWT tokens (max 1000 bytes)
 */
class CustomClaimsStructure {
  
  /**
   * Create optimized claims object for JWT token
   */
  static createClaims(user) {
    const claims = {};
    
    // Core subscription info (always include)
    if (user.tier && user.tier !== 'free') {
      claims.tier = user.tier;
    }
    
    // System admin flag
    if (user.isSystemAdmin) {
      claims.admin = true;
    }
    
    // Organization membership (only include if member of orgs)
    if (user.organizations && user.organizations.length > 0) {
      claims.orgs = user.organizations.map(org => ({
        id: org.id,
        role: org.role
      }));
    }
    
    // Feature flags (only include enabled features to save space)
    const enabledFeatures = [];
    if (this.hasSystemPermission(user.tier, 'use_mcp_integration')) {
      enabledFeatures.push('mcp');
    }
    if (this.hasSystemPermission(user.tier, 'advanced_webhooks')) {
      enabledFeatures.push('webhooks');
    }
    if (enabledFeatures.length > 0) {
      claims.features = enabledFeatures;
    }
    
    // Timestamp for cache invalidation
    claims.updated = Math.floor(Date.now() / 1000);
    
    return claims;
  }
  
  /**
   * Check if claims are expired (older than 1 hour)
   */
  static areClaimsExpired(claims) {
    if (!claims.updated) return true;
    
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    return claims.updated < oneHourAgo;
  }
  
  /**
   * Extract user's highest organization role from claims
   */
  static getHighestOrgRole(claims) {
    if (!claims.orgs || claims.orgs.length === 0) {
      return null;
    }
    
    const roles = claims.orgs.map(org => org.role);
    return RoleManager.getHighestRole(roles);
  }
}

module.exports = {
  ROLE_LEVELS,
  SYSTEM_PERMISSIONS,
  RESOURCE_PERMISSIONS,
  DEFAULT_ROLES,
  RoleManager,
  CustomClaimsStructure
};