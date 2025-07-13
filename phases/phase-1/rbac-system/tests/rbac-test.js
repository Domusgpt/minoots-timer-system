/**
 * MINOOTS RBAC - Comprehensive Test Suite
 * Tests all components of the hybrid RBAC system
 */

const assert = require('assert');
const { RoleManager, CustomClaimsStructure } = require('../core/RoleDefinitions');
const CustomClaimsManager = require('../core/CustomClaimsManager');
const { FirestoreSchemaManager } = require('../core/FirestoreSchema');

describe('MINOOTS RBAC System Tests', () => {
  
  describe('RoleManager', () => {
    
    it('should validate role hierarchy correctly', () => {
      assert.strictEqual(RoleManager.isRoleHigher('admin', 'editor'), true);
      assert.strictEqual(RoleManager.isRoleHigher('editor', 'admin'), false);
      assert.strictEqual(RoleManager.isRoleHigher('owner', 'admin'), true);
      assert.strictEqual(RoleManager.isRoleHigher('viewer', 'editor'), false);
    });
    
    it('should check permissions correctly', () => {
      // Timer permissions
      assert.strictEqual(RoleManager.hasPermission('viewer', 'view', 'timers'), true);
      assert.strictEqual(RoleManager.hasPermission('viewer', 'delete', 'timers'), false);
      assert.strictEqual(RoleManager.hasPermission('editor', 'create', 'timers'), true);
      assert.strictEqual(RoleManager.hasPermission('manager', 'delete', 'timers'), true);
      
      // Project permissions
      assert.strictEqual(RoleManager.hasPermission('editor', 'view', 'projects'), true);
      assert.strictEqual(RoleManager.hasPermission('editor', 'delete', 'projects'), false);
      assert.strictEqual(RoleManager.hasPermission('admin', 'delete', 'projects'), true);
      
      // Organization permissions
      assert.strictEqual(RoleManager.hasPermission('viewer', 'manage_members', 'organizations'), false);
      assert.strictEqual(RoleManager.hasPermission('admin', 'manage_members', 'organizations'), true);
      assert.strictEqual(RoleManager.hasPermission('admin', 'manage_billing', 'organizations'), false);
      assert.strictEqual(RoleManager.hasPermission('owner', 'manage_billing', 'organizations'), true);
    });
    
    it('should identify highest role correctly', () => {
      const roles1 = ['viewer', 'editor', 'admin'];
      assert.strictEqual(RoleManager.getHighestRole(roles1), 'admin');
      
      const roles2 = ['manager', 'viewer', 'owner'];
      assert.strictEqual(RoleManager.getHighestRole(roles2), 'owner');
      
      const roles3 = ['viewer'];
      assert.strictEqual(RoleManager.getHighestRole(roles3), 'viewer');
    });
    
    it('should check system permissions correctly', () => {
      assert.strictEqual(RoleManager.hasSystemPermission('free', 'use_mcp_integration'), false);
      assert.strictEqual(RoleManager.hasSystemPermission('pro', 'use_mcp_integration'), true);
      assert.strictEqual(RoleManager.hasSystemPermission('team', 'manage_organization'), true);
      assert.strictEqual(RoleManager.hasSystemPermission('pro', 'sso_access'), false);
      assert.strictEqual(RoleManager.hasSystemPermission('enterprise', 'sso_access'), true);
    });
    
    it('should validate role assignment permissions', () => {
      assert.strictEqual(RoleManager.canAssignRole('admin', 'editor'), true);
      assert.strictEqual(RoleManager.canAssignRole('admin', 'owner'), false);
      assert.strictEqual(RoleManager.canAssignRole('owner', 'admin'), true);
      assert.strictEqual(RoleManager.canAssignRole('editor', 'manager'), false);
    });
    
    it('should get role permissions for resource types', () => {
      const editorTimerPerms = RoleManager.getRolePermissions('editor', 'timers');
      assert(editorTimerPerms.includes('view'));
      assert(editorTimerPerms.includes('create'));
      assert(editorTimerPerms.includes('edit'));
      assert(!editorTimerPerms.includes('delete'));
      
      const managerTimerPerms = RoleManager.getRolePermissions('manager', 'timers');
      assert(managerTimerPerms.includes('delete'));
      assert(managerTimerPerms.includes('share'));
    });
  });
  
  describe('CustomClaimsStructure', () => {
    
    it('should create optimized claims structure', () => {
      const user = {
        tier: 'pro',
        isSystemAdmin: false,
        organizations: [
          { id: 'org1', role: 'admin', name: 'Test Org 1' },
          { id: 'org2', role: 'editor', name: 'Test Org 2' }
        ]
      };
      
      const claims = CustomClaimsStructure.createClaims(user);
      
      assert.strictEqual(claims.tier, 'pro');
      assert.strictEqual(claims.admin, undefined); // Should not be set for non-admins
      assert.strictEqual(claims.orgs.length, 2);
      assert.strictEqual(claims.orgs[0].id, 'org1');
      assert.strictEqual(claims.orgs[0].role, 'admin');
      assert(Array.isArray(claims.features));
      assert(claims.features.includes('mcp'));
      assert(typeof claims.updated === 'number');
    });
    
    it('should handle free tier users correctly', () => {
      const user = {
        tier: 'free',
        isSystemAdmin: false,
        organizations: []
      };
      
      const claims = CustomClaimsStructure.createClaims(user);
      
      assert.strictEqual(claims.tier, undefined); // Free tier not included to save space
      assert.strictEqual(claims.orgs, undefined); // No orgs not included
      assert.strictEqual(claims.features, undefined); // No features for free tier
      assert(typeof claims.updated === 'number');
    });
    
    it('should handle system admin correctly', () => {
      const user = {
        tier: 'pro',
        isSystemAdmin: true,
        organizations: []
      };
      
      const claims = CustomClaimsStructure.createClaims(user);
      
      assert.strictEqual(claims.admin, true);
      assert.strictEqual(claims.tier, 'pro');
    });
    
    it('should detect expired claims', () => {
      const oldClaims = { updated: Math.floor(Date.now() / 1000) - 7200 }; // 2 hours ago
      const newClaims = { updated: Math.floor(Date.now() / 1000) - 1800 }; // 30 minutes ago
      
      assert.strictEqual(CustomClaimsStructure.areClaimsExpired(oldClaims), true);
      assert.strictEqual(CustomClaimsStructure.areClaimsExpired(newClaims), false);
    });
    
    it('should extract highest org role from claims', () => {
      const claims = {
        orgs: [
          { id: 'org1', role: 'editor' },
          { id: 'org2', role: 'admin' },
          { id: 'org3', role: 'viewer' }
        ]
      };
      
      const highestRole = CustomClaimsStructure.getHighestOrgRole(claims);
      assert.strictEqual(highestRole, 'admin');
    });
  });
  
  describe('Performance Tests', () => {
    
    it('should create claims within size limit', () => {
      // Test with maximum realistic data
      const user = {
        tier: 'enterprise',
        isSystemAdmin: true,
        organizations: []
      };
      
      // Add many organizations to test size limit
      for (let i = 0; i < 20; i++) {
        user.organizations.push({
          id: `org_${i}_with_long_name_for_testing`,
          role: 'admin',
          name: `Organization ${i} with a very long name for testing`
        });
      }
      
      const claims = CustomClaimsStructure.createClaims(user);
      const claimsJson = JSON.stringify(claims);
      const sizeInBytes = Buffer.byteLength(claimsJson, 'utf8');
      
      console.log(`Claims size: ${sizeInBytes} bytes`);
      console.log(`Claims content:`, claims);
      
      // Firebase limit is 1000 bytes
      assert(sizeInBytes <= 1000, `Claims too large: ${sizeInBytes} bytes (max 1000)`);
    });
    
    it('should handle claims comparison efficiently', () => {
      const claims1 = { tier: 'pro', features: ['mcp'], updated: 123456 };
      const claims2 = { tier: 'pro', features: ['mcp'], updated: 123456 };
      const claims3 = { tier: 'team', features: ['mcp'], updated: 123456 };
      
      const claimsManager = new CustomClaimsManager();
      
      assert.strictEqual(claimsManager.claimsEqual(claims1, claims2), true);
      assert.strictEqual(claimsManager.claimsEqual(claims1, claims3), false);
    });
  });
  
  describe('Security Tests', () => {
    
    it('should prevent privilege escalation through role assignment', () => {
      // Editor cannot assign admin role
      assert.strictEqual(RoleManager.canAssignRole('editor', 'admin'), false);
      
      // Admin cannot assign owner role
      assert.strictEqual(RoleManager.canAssignRole('admin', 'owner'), false);
      
      // Only equal or higher roles can assign
      assert.strictEqual(RoleManager.canAssignRole('admin', 'editor'), true);
      assert.strictEqual(RoleManager.canAssignRole('owner', 'admin'), true);
    });
    
    it('should enforce proper permission boundaries', () => {
      // Viewers cannot modify anything
      assert.strictEqual(RoleManager.hasPermission('viewer', 'create', 'timers'), false);
      assert.strictEqual(RoleManager.hasPermission('viewer', 'edit', 'projects'), false);
      assert.strictEqual(RoleManager.hasPermission('viewer', 'manage_members', 'organizations'), false);
      
      // Editors cannot delete or manage
      assert.strictEqual(RoleManager.hasPermission('editor', 'delete', 'timers'), false);
      assert.strictEqual(RoleManager.hasPermission('editor', 'delete', 'projects'), false);
      assert.strictEqual(RoleManager.hasPermission('editor', 'manage_members', 'organizations'), false);
      
      // Only owners can manage billing
      assert.strictEqual(RoleManager.hasPermission('admin', 'manage_billing', 'organizations'), false);
      assert.strictEqual(RoleManager.hasPermission('owner', 'manage_billing', 'organizations'), true);
    });
    
    it('should validate role existence', () => {
      assert.strictEqual(RoleManager.isValidRole('admin'), true);
      assert.strictEqual(RoleManager.isValidRole('editor'), true);
      assert.strictEqual(RoleManager.isValidRole('invalid_role'), false);
      assert.strictEqual(RoleManager.isValidRole(''), false);
      assert.strictEqual(RoleManager.isValidRole(null), false);
    });
  });
  
  describe('Integration Tests', () => {
    
    it('should handle complete permission check flow', () => {
      // Test the complete flow from user claims to permission validation
      const claims = {
        tier: 'pro',
        features: ['mcp', 'webhooks'],
        orgs: [
          { id: 'org1', role: 'admin' }
        ],
        updated: Math.floor(Date.now() / 1000)
      };
      
      const claimsManager = new CustomClaimsManager();
      
      // Test system permission check
      assert.strictEqual(claimsManager.checkSystemPermission(claims, 'use_mcp_integration'), true);
      assert.strictEqual(claimsManager.checkSystemPermission(claims, 'sso_access'), false);
      
      // Test organization permission check
      assert.strictEqual(claimsManager.checkOrganizationPermission(claims, 'manage_members', 'org1'), true);
      assert.strictEqual(claimsManager.checkOrganizationPermission(claims, 'manage_billing', 'org1'), false);
      assert.strictEqual(claimsManager.checkOrganizationPermission(claims, 'manage_members', 'org2'), false);
    });
  });
});

// Mock Firebase Admin for testing
if (process.env.NODE_ENV === 'test') {
  console.log('Running RBAC tests...');
  
  // Simple test runner
  const runTests = async () => {
    const tests = [
      () => {
        console.log('✓ Role hierarchy validation');
        assert.strictEqual(RoleManager.isRoleHigher('admin', 'editor'), true);
      },
      () => {
        console.log('✓ Permission checking');
        assert.strictEqual(RoleManager.hasPermission('editor', 'create', 'timers'), true);
      },
      () => {
        console.log('✓ Claims structure creation');
        const user = { tier: 'pro', isSystemAdmin: false, organizations: [] };
        const claims = CustomClaimsStructure.createClaims(user);
        assert(claims.features.includes('mcp'));
      },
      () => {
        console.log('✓ Claims size validation');
        const user = { tier: 'enterprise', isSystemAdmin: true, organizations: [] };
        for (let i = 0; i < 10; i++) {
          user.organizations.push({ id: `org${i}`, role: 'admin' });
        }
        const claims = CustomClaimsStructure.createClaims(user);
        const size = Buffer.byteLength(JSON.stringify(claims), 'utf8');
        assert(size <= 1000);
      }
    ];
    
    let passed = 0;
    for (const test of tests) {
      try {
        test();
        passed++;
      } catch (error) {
        console.error('✗ Test failed:', error.message);
      }
    }
    
    console.log(`\nTest Results: ${passed}/${tests.length} passed`);
    return passed === tests.length;
  };
  
  if (require.main === module) {
    runTests().then(success => {
      process.exit(success ? 0 : 1);
    });
  }
  
  module.exports = { runTests };
}