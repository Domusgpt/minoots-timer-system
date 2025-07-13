/**
 * MINOOTS RBAC - Cloud Function Triggers
 * Handles automatic synchronization between Firestore and Custom Claims
 */

const { onDocumentWritten, onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const CustomClaimsManager = require('./CustomClaimsManager');

// Use global variables initialized in main index.js onInit()
const getServices = () => {
  return {
    db: global.rbacDb || admin.firestore(),
    claimsManager: global.rbacClaimsManager || new CustomClaimsManager(admin.firestore())
  };
};

/**
 * Trigger when user profile is created or updated
 * Syncs user tier and basic info to Custom Claims
 */
exports.syncUserClaims = onDocumentWritten('/users/{userId}', async (event) => {
  const userId = event.params.userId;
  const { claimsManager } = getServices();
  
  try {
    console.log(`Syncing claims for user: ${userId}`);
    
    // Skip if this is a deletion
    if (!event.data.after.exists) {
      console.log(`User ${userId} deleted, clearing claims`);
      await claimsManager.clearUserClaims(userId);
      return;
    }

    // Sync user's data to Custom Claims
    await claimsManager.syncFromFirestore(userId);
    
    console.log(`Claims synchronized for user: ${userId}`);
  } catch (error) {
    console.error(`Failed to sync claims for user ${userId}:`, error);
    // Don't throw - we don't want to break the user update
  }
});

/**
 * Trigger when organization membership changes
 * Updates affected users' Custom Claims
 */
exports.syncOrganizationClaims = onDocumentWritten('/organizations/{orgId}', async (event) => {
  const orgId = event.params.orgId;
  const { claimsManager } = getServices();
  
  try {
    console.log(`Organization ${orgId} updated, syncing member claims`);
    
    let affectedUsers = new Set();
    
    // Get users from before and after to find all affected users
    if (event.data.before.exists) {
      const beforeMembers = event.data.before.data().members || {};
      Object.keys(beforeMembers).forEach(userId => affectedUsers.add(userId));
    }
    
    if (event.data.after.exists) {
      const afterMembers = event.data.after.data().members || {};
      Object.keys(afterMembers).forEach(userId => affectedUsers.add(userId));
    }
    
    // Sync claims for all affected users
    const syncPromises = Array.from(affectedUsers).map(userId => 
      claimsManager.syncFromFirestore(userId).catch(error => {
        console.error(`Failed to sync claims for user ${userId}:`, error);
        return { userId, error };
      })
    );
    
    await Promise.all(syncPromises);
    
    console.log(`Claims synchronized for ${affectedUsers.size} users affected by organization ${orgId} changes`);
  } catch (error) {
    console.error(`Failed to sync organization claims for ${orgId}:`, error);
  }
});

/**
 * Trigger when user subscription/tier changes
 * Updates tier-related Custom Claims immediately
 */
exports.syncSubscriptionClaims = onDocumentWritten('/users/{userId}/subscription', async (event) => {
  const userId = event.params.userId;
  const { db } = getServices();
  
  try {
    console.log(`Subscription changed for user: ${userId}`);
    
    if (!event.data.after.exists) {
      console.log(`Subscription deleted for user ${userId}`);
      return;
    }

    const newSubscription = event.data.after.data();
    const oldSubscription = event.data.before.exists ? event.data.before.data() : {};
    
    // Check if tier changed
    if (newSubscription.tier !== oldSubscription.tier) {
      console.log(`Tier changed for user ${userId}: ${oldSubscription.tier} -> ${newSubscription.tier}`);
      
      // Update user's main profile with new tier
      await db.collection('users').doc(userId).update({
        tier: newSubscription.tier,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Sync claims will be triggered by the above update
    }
    
  } catch (error) {
    console.error(`Failed to sync subscription claims for user ${userId}:`, error);
  }
});

/**
 * Trigger when project access changes
 * Updates related users' claims if needed for project-specific permissions
 */
exports.syncProjectClaims = onDocumentWritten('/projects/{projectId}', async (event) => {
  const projectId = event.params.projectId;
  const { db } = getServices();
  
  try {
    let affectedUsers = new Set();
    
    // Get users from before and after access maps
    if (event.data.before.exists) {
      const beforeAccess = event.data.before.data().access || {};
      Object.keys(beforeAccess).forEach(userId => affectedUsers.add(userId));
    }
    
    if (event.data.after.exists) {
      const afterAccess = event.data.after.data().access || {};
      Object.keys(afterAccess).forEach(userId => affectedUsers.add(userId));
    }
    
    // For project-level permissions, we primarily rely on Firestore queries
    // Custom Claims are mainly for system/org level permissions
    // But we can trigger an audit log for project access changes
    
    if (affectedUsers.size > 0) {
      await db.collection('audit_logs').add({
        type: 'project_access_changed',
        resourceType: 'project',
        resourceId: projectId,
        affectedUsers: Array.from(affectedUsers),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        triggeredBy: 'system'
      });
      
      console.log(`Project ${projectId} access updated, ${affectedUsers.size} users affected`);
    }
    
  } catch (error) {
    console.error(`Failed to process project access changes for ${projectId}:`, error);
  }
});

/**
 * Periodic function to check for orphaned Custom Claims
 * Runs daily to clean up claims for deleted users
 */
exports.cleanupOrphanedClaims = onSchedule('0 2 * * *', async () => {
  const { db, claimsManager } = getServices();
  
  try {
    console.log('Starting orphaned claims cleanup...');
    
    // Get all users with custom claims
    const listUsersResult = await admin.auth().listUsers();
    const usersWithClaims = listUsersResult.users.filter(user => 
      user.customClaims && Object.keys(user.customClaims).length > 0
    );
    
    console.log(`Found ${usersWithClaims.length} users with custom claims`);
    
    let cleanedCount = 0;
    
    for (const user of usersWithClaims) {
      try {
        // Check if user still exists in Firestore
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
          // User doesn't exist in Firestore, clear their claims
          await claimsManager.clearUserClaims(user.uid);
          cleanedCount++;
          console.log(`Cleared orphaned claims for user: ${user.uid}`);
        }
      } catch (error) {
        console.error(`Failed to check user ${user.uid}:`, error);
      }
    }
    
    console.log(`Cleanup completed. Cleared claims for ${cleanedCount} orphaned users.`);
    
    // Log cleanup summary
    await db.collection('audit_logs').add({
      type: 'claims_cleanup',
      action: 'orphaned_claims_cleanup',
      details: {
        totalUsersChecked: usersWithClaims.length,
        orphanedUsersFound: cleanedCount
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      triggeredBy: 'scheduled_function'
    });
    
  } catch (error) {
    console.error('Orphaned claims cleanup failed:', error);
  }
});

/**
 * Function to manually trigger claims sync for a user
 * Useful for debugging and administrative tasks
 */
exports.manualClaimsSync = onRequest(async (req, res) => {
  const { claimsManager } = getServices();
  
  // Verify the request is authenticated and from an admin
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Check if user is system admin
    if (!decodedToken.admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // Trigger manual sync
    await claimsManager.syncFromFirestore(userId);
    
    res.json({ 
      success: true, 
      message: `Claims synchronized for user ${userId}` 
    });
    
  } catch (error) {
    console.error('Manual claims sync failed:', error);
    res.status(500).json({ error: 'Claims sync failed', details: error.message });
  }
});

/**
 * Function to bulk sync claims for migration/updates
 * Useful when role definitions change and need to be propagated
 */
exports.bulkClaimsSync = onRequest(async (req, res) => {
  const { db, claimsManager } = getServices();
  
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Check if user is system admin
    if (!decodedToken.admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { userIds, organizationId } = req.body;
    
    let targetUserIds = [];
    
    if (userIds && Array.isArray(userIds)) {
      targetUserIds = userIds;
    } else if (organizationId) {
      // Get all users in organization
      const orgDoc = await db.collection('organizations').doc(organizationId).get();
      if (orgDoc.exists) {
        targetUserIds = Object.keys(orgDoc.data().members || {});
      }
    } else {
      // Get all users (use with caution!)
      const usersSnapshot = await db.collection('users').select().get();
      targetUserIds = usersSnapshot.docs.map(doc => doc.id);
    }
    
    if (targetUserIds.length === 0) {
      return res.status(400).json({ error: 'No users found to sync' });
    }
    
    if (targetUserIds.length > 100) {
      return res.status(400).json({ 
        error: 'Too many users for bulk sync (max 100)',
        userCount: targetUserIds.length 
      });
    }
    
    // Perform bulk sync
    const results = await claimsManager.bulkSyncClaims(targetUserIds);
    
    const successCount = results.filter(r => !r.error).length;
    const failureCount = results.filter(r => r.error).length;
    
    res.json({
      success: true,
      totalUsers: targetUserIds.length,
      successful: successCount,
      failed: failureCount,
      results: results
    });
    
  } catch (error) {
    console.error('Bulk claims sync failed:', error);
    res.status(500).json({ error: 'Bulk sync failed', details: error.message });
  }
});

module.exports = {
  syncUserClaims: exports.syncUserClaims,
  syncOrganizationClaims: exports.syncOrganizationClaims,
  syncSubscriptionClaims: exports.syncSubscriptionClaims,
  syncProjectClaims: exports.syncProjectClaims,
  cleanupOrphanedClaims: exports.cleanupOrphanedClaims,
  manualClaimsSync: exports.manualClaimsSync,
  bulkClaimsSync: exports.bulkClaimsSync
};