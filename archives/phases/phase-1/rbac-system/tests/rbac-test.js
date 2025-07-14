/**
 * MINOOTS RBAC - Comprehensive Test Suite
 * Tests all components of the hybrid RBAC system
 */

const assert = require('assert');
const { RoleManager, CustomClaimsStructure } = require('../core/RoleDefinitions');

// Mock Firebase dependencies for testing
const mockCustomClaimsManager = {
  claimsEqual: (claims1, claims2) => JSON.stringify(claims1) === JSON.stringify(claims2),
  checkSystemPermission: (claims, action) => {
    const tier = claims.tier || 'free';
    const features = claims.features || [];
    
    const systemPermissions = {
      'use_mcp_integration': () => features.includes('mcp'),
      'advanced_webhooks': () => features.includes('webhooks'),
      'manage_organization': () => ['team', 'enterprise'].includes(tier),
      'sso_access': () => tier === 'enterprise'
    };
    
    const permissionCheck = systemPermissions[action];
    return permissionCheck ? permissionCheck() : false;
  },
  checkOrganizationPermission: (claims, action, orgId) => {
    if (!claims.orgs || claims.orgs.length === 0) return false;
    const userOrgRole = claims.orgs.find(org => org.id === orgId)?.role;
    if (!userOrgRole) return false;
    return RoleManager.hasPermission(userOrgRole, action, 'organizations');
  }
};

// Mock Firebase Admin for testing
if (process.env.NODE_ENV === 'test') {
  console.log('Running RBAC tests...');
  
  // Simple test runner
  const runTests = async () => {
    const tests = [
      () => {
        console.log('✓ Role hierarchy validation');
        assert.strictEqual(RoleManager.isRoleHigher('admin', 'editor'), true);
        assert.strictEqual(RoleManager.isRoleHigher('editor', 'admin'), false);
        assert.strictEqual(RoleManager.isRoleHigher('owner', 'admin'), true);
      },
      () => {
        console.log('✓ Permission checking');
        assert.strictEqual(RoleManager.hasPermission('viewer', 'view', 'timers'), true);
        assert.strictEqual(RoleManager.hasPermission('viewer', 'delete', 'timers'), false);
        assert.strictEqual(RoleManager.hasPermission('editor', 'create', 'timers'), true);
        assert.strictEqual(RoleManager.hasPermission('manager', 'delete', 'timers'), true);
      },
      () => {
        console.log('✓ System permissions');
        assert.strictEqual(RoleManager.hasSystemPermission('free', 'use_mcp_integration'), false);
        assert.strictEqual(RoleManager.hasSystemPermission('pro', 'use_mcp_integration'), true);
        assert.strictEqual(RoleManager.hasSystemPermission('enterprise', 'sso_access'), true);
      },
      () => {
        console.log('✓ Claims structure creation');
        const user = { tier: 'pro', isSystemAdmin: false, organizations: [] };
        const claims = CustomClaimsStructure.createClaims(user);
        assert(claims.features.includes('mcp'));
        assert.strictEqual(claims.tier, 'pro');
      },
      () => {
        console.log('✓ Claims size validation');
        const user = { tier: 'enterprise', isSystemAdmin: true, organizations: [] };
        for (let i = 0; i < 10; i++) {
          user.organizations.push({ id: `org${i}`, role: 'admin' });
        }
        const claims = CustomClaimsStructure.createClaims(user);
        const size = Buffer.byteLength(JSON.stringify(claims), 'utf8');
        assert(size <= 1000, `Claims too large: ${size} bytes`);
        console.log(`  Claims size: ${size} bytes`);
      },
      () => {
        console.log('✓ Role assignment validation');
        assert.strictEqual(RoleManager.canAssignRole('admin', 'editor'), true);
        assert.strictEqual(RoleManager.canAssignRole('admin', 'owner'), false);
        assert.strictEqual(RoleManager.canAssignRole('editor', 'manager'), false);
      },
      () => {
        console.log('✓ Highest role detection');
        const roles = ['viewer', 'editor', 'admin'];
        assert.strictEqual(RoleManager.getHighestRole(roles), 'admin');
      },
      () => {
        console.log('✓ Permission integration test');
        const claims = {
          tier: 'pro',
          features: ['mcp', 'webhooks'],
          orgs: [{ id: 'org1', role: 'admin' }],
          updated: Math.floor(Date.now() / 1000)
        };
        
        assert.strictEqual(mockCustomClaimsManager.checkSystemPermission(claims, 'use_mcp_integration'), true);
        assert.strictEqual(mockCustomClaimsManager.checkSystemPermission(claims, 'sso_access'), false);
        assert.strictEqual(mockCustomClaimsManager.checkOrganizationPermission(claims, 'manage_members', 'org1'), true);
      },
      () => {
        console.log('✓ Security boundary tests');
        // Viewers cannot modify anything
        assert.strictEqual(RoleManager.hasPermission('viewer', 'create', 'timers'), false);
        assert.strictEqual(RoleManager.hasPermission('viewer', 'edit', 'projects'), false);
        
        // Editors cannot delete or manage
        assert.strictEqual(RoleManager.hasPermission('editor', 'delete', 'timers'), false);
        assert.strictEqual(RoleManager.hasPermission('editor', 'manage_members', 'organizations'), false);
        
        // Only owners can manage billing
        assert.strictEqual(RoleManager.hasPermission('admin', 'manage_billing', 'organizations'), false);
        assert.strictEqual(RoleManager.hasPermission('owner', 'manage_billing', 'organizations'), true);
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
    
    console.log(`\n🎯 Test Results: ${passed}/${tests.length} passed`);
    
    if (passed === tests.length) {
      console.log('🚀 All RBAC tests passed! System ready for integration.');
    } else {
      console.log('❌ Some tests failed. Check implementation.');
    }
    
    return passed === tests.length;
  };
  
  if (require.main === module) {
    runTests().then(success => {
      process.exit(success ? 0 : 1);
    });
  }
  
  module.exports = { runTests };
}