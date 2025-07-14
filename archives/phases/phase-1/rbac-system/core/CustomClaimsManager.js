/**
 * MINOOTS RBAC - Custom Claims Manager
 * Manages Firebase Custom Claims for high-performance permission checking
 */

const admin = require('firebase-admin');
const { CustomClaimsStructure, RoleManager } = require('./RoleDefinitions');

class CustomClaimsManager {
  constructor(db = null) {
    this.db = db || admin.firestore();
    this.auth = admin.auth();
  }

  /**
   * Set custom claims for a user (only callable from server-side)
   */
  async setUserClaims(userId, claims) {
    try {
      // Validate claims size (Firebase limit is 1000 bytes)
      const claimsJson = JSON.stringify(claims);
      if (Buffer.byteLength(claimsJson, 'utf8') > 1000) {
        throw new Error(`Custom claims too large: ${Buffer.byteLength(claimsJson, 'utf8')} bytes (max 1000)`);
      }

      await this.auth.setCustomUserClaims(userId, claims);
      
      // Log the claims update for audit
      await this.db.collection('audit_logs').add({
        type: 'claims_updated',
        userId: userId,
        claims: claims,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system'
      });

      console.log(`Custom claims updated for user ${userId}:`, claims);
      return true;
    } catch (error) {
      console.error('Failed to set custom claims:', error);
      throw error;
    }
  }

  /**
   * Get current custom claims for a user
   */
  async getUserClaims(userId) {
    try {
      const userRecord = await this.auth.getUser(userId);
      return userRecord.customClaims || {};
    } catch (error) {
      console.error('Failed to get custom claims:', error);
      return {};
    }
  }

  /**
   * Sync user's Firestore data to Custom Claims
   * This is the core function called by Cloud Function triggers
   */
  async syncFromFirestore(userId) {
    try {
      // Get user's complete profile from Firestore
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        console.warn(`User ${userId} not found in Firestore`);
        return;
      }

      const userData = userDoc.data();
      
      // Get user's organization memberships
      const orgMemberships = await this.getUserOrganizations(userId);
      
      // Create optimized claims structure
      const userForClaims = {
        tier: userData.tier || 'free',
        isSystemAdmin: userData.isSystemAdmin || false,
        organizations: orgMemberships
      };

      const claims = CustomClaimsStructure.createClaims(userForClaims);
      
      // Only update if claims have changed
      const currentClaims = await this.getUserClaims(userId);
      if (!this.claimsEqual(currentClaims, claims)) {
        await this.setUserClaims(userId, claims);
        
        // Update user's lastClaimsSync timestamp
        await userDoc.ref.update({
          lastClaimsSync: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return claims;
    } catch (error) {
      console.error(`Failed to sync claims for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user's organization memberships with roles
   */
  async getUserOrganizations(userId) {
    try {
      const orgsSnapshot = await this.db.collection('organizations')
        .where(`members.${userId}`, '!=', null)
        .get();

      return orgsSnapshot.docs.map(doc => ({
        id: doc.id,
        role: doc.data().members[userId],
        name: doc.data().name
      }));
    } catch (error) {
      console.error('Failed to get user organizations:', error);
      return [];
    }
  }

  /**
   * Validate permission using Custom Claims (fast) or Firestore (granular)
   */
  async validatePermission(userId, action, resourceType, resourceId = null) {
    try {
      // First check: Custom Claims (fast, cached in JWT)
      const claims = await this.getUserClaims(userId);
      
      // System-level permissions (from tier/features)
      if (this.checkSystemPermission(claims, action)) {
        return { allowed: true, source: 'custom_claims' };
      }

      // Organization-level permissions (from claims)
      if (resourceType === 'organization') {
        const hasOrgPermission = this.checkOrganizationPermission(claims, action, resourceId);
        if (hasOrgPermission !== null) {
          return { allowed: hasOrgPermission, source: 'custom_claims' };
        }
      }

      // Resource-specific permissions (requires Firestore lookup)
      if (resourceId) {
        const hasResourcePermission = await this.checkResourcePermission(userId, action, resourceType, resourceId);
        return { allowed: hasResourcePermission, source: 'firestore' };
      }

      return { allowed: false, source: 'default_deny' };
    } catch (error) {
      console.error('Permission validation failed:', error);
      return { allowed: false, source: 'error' };
    }
  }

  /**
   * Check system-level permissions from Custom Claims
   */
  checkSystemPermission(claims, action) {
    // Check if user has required tier for system permissions
    const tier = claims.tier || 'free';
    const features = claims.features || [];
    
    // Map actions to tier/feature requirements
    const systemPermissions = {
      'use_mcp_integration': () => features.includes('mcp'),
      'advanced_webhooks': () => features.includes('webhooks'),
      'manage_organization': () => ['team', 'enterprise'].includes(tier),
      'view_analytics': () => ['team', 'enterprise'].includes(tier),
      'sso_access': () => tier === 'enterprise',
      'audit_logs': () => tier === 'enterprise'
    };

    const permissionCheck = systemPermissions[action];
    return permissionCheck ? permissionCheck() : false;
  }

  /**
   * Check organization permissions from Custom Claims
   */
  checkOrganizationPermission(claims, action, orgId) {
    if (!claims.orgs || claims.orgs.length === 0) {
      return false;
    }

    const userOrgRole = claims.orgs.find(org => org.id === orgId)?.role;
    if (!userOrgRole) {
      return false;
    }

    return RoleManager.hasPermission(userOrgRole, action, 'organizations');
  }

  /**
   * Check resource-specific permissions (requires Firestore lookup)
   */
  async checkResourcePermission(userId, action, resourceType, resourceId) {
    try {
      // Get resource document to check access map
      const resourceDoc = await this.db.collection(resourceType).doc(resourceId).get();
      if (!resourceDoc.exists) {
        return false;
      }

      const resourceData = resourceDoc.data();
      
      // Check direct access permission
      const userRole = resourceData.access?.[userId];
      if (userRole) {
        return RoleManager.hasPermission(userRole, action, resourceType);
      }

      // Check organization-level access if resource belongs to an org
      if (resourceData.organizationId) {
        const orgDoc = await this.db.collection('organizations').doc(resourceData.organizationId).get();
        if (orgDoc.exists) {
          const userOrgRole = orgDoc.data().members?.[userId];
          if (userOrgRole) {
            return RoleManager.hasPermission(userOrgRole, action, resourceType);
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Resource permission check failed:', error);
      return false;
    }
  }

  /**
   * Compare two claims objects for equality
   */
  claimsEqual(claims1, claims2) {
    return JSON.stringify(claims1) === JSON.stringify(claims2);
  }

  /**
   * Bulk sync claims for multiple users (for migration/updates)
   */
  async bulkSyncClaims(userIds) {
    const results = [];
    const batchSize = 10; // Firebase has rate limits

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const batchPromises = batch.map(userId => 
        this.syncFromFirestore(userId).catch(error => ({ userId, error }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Remove all custom claims for a user (for cleanup/offboarding)
   */
  async clearUserClaims(userId) {
    try {
      await this.auth.setCustomUserClaims(userId, null);
      
      // Log the claims removal
      await this.db.collection('audit_logs').add({
        type: 'claims_cleared',
        userId: userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        clearedBy: 'system'
      });

      console.log(`Custom claims cleared for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Failed to clear custom claims:', error);
      throw error;
    }
  }
}

module.exports = CustomClaimsManager;