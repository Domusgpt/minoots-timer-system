/**
 * MINOOTS API Key Management Utilities
 * Generate, validate, and manage API keys for users
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

// Get Firestore reference
let db;
const getDb = () => {
  if (!db) {
    db = admin.firestore();
  }
  return db;
};

/**
 * Generate a secure API key
 * Format: mnt_[32 char hex string]
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(32);
  return 'mnt_' + randomBytes.toString('hex');
}

/**
 * Create a new API key for a user
 */
async function createApiKey(userId, userEmail, userTier, name = 'Default Key') {
  const db = getDb();
  const apiKey = generateApiKey();
  
  const keyData = {
    userId: userId,
    userEmail: userEmail,
    userTier: userTier,
    name: name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsed: null,
    totalRequests: 0,
    revoked: false
  };
  
  // Store the key data
  await db.collection('apiKeys').doc(apiKey).set(keyData);
  
  // Add key reference to user document
  // Handle anonymous users who don't have documents yet
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    // Create minimal user document for anonymous/bootstrap users
    await userRef.set({
      id: userId,
      email: userEmail,
      tier: userTier,
      isAnonymous: userId.startsWith('anon_'),
      apiKeys: [apiKey],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      role: 'user',
      permissions: [],
      organizations: []
    });
  } else {
    // Normal update for existing users
    await userRef.update({
      apiKeys: admin.firestore.FieldValue.arrayUnion(apiKey)
    });
  }
  
  return {
    apiKey: apiKey,
    name: name,
    createdAt: new Date().toISOString()
  };
}

/**
 * List all API keys for a user
 */
async function getUserApiKeys(userId) {
  const db = getDb();
  
  const keysSnapshot = await db.collection('apiKeys')
    .where('userId', '==', userId)
    .where('revoked', '==', false)
    .orderBy('createdAt', 'desc')
    .get();
  
  return keysSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      createdAt: data.createdAt?.toDate?.() || data.createdAt,
      lastUsed: data.lastUsed?.toDate?.() || data.lastUsed,
      totalRequests: data.totalRequests || 0,
      // Don't return the actual key for security
      keyPreview: doc.id.substring(0, 12) + '...'
    };
  });
}

/**
 * Revoke an API key
 */
async function revokeApiKey(userId, apiKeyId) {
  const db = getDb();
  
  // Verify the key belongs to the user
  const keyDoc = await db.collection('apiKeys').doc(apiKeyId).get();
  
  if (!keyDoc.exists) {
    throw new Error('API key not found');
  }
  
  const keyData = keyDoc.data();
  if (keyData.userId !== userId) {
    throw new Error('API key does not belong to this user');
  }
  
  // Revoke the key
  await keyDoc.ref.update({
    revoked: true,
    revokedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Remove from user's key list
  await db.collection('users').doc(userId).update({
    apiKeys: admin.firestore.FieldValue.arrayRemove(apiKeyId)
  });
  
  return true;
}

/**
 * Update API key name
 */
async function updateApiKeyName(userId, apiKeyId, newName) {
  const db = getDb();
  
  // Verify the key belongs to the user
  const keyDoc = await db.collection('apiKeys').doc(apiKeyId).get();
  
  if (!keyDoc.exists) {
    throw new Error('API key not found');
  }
  
  const keyData = keyDoc.data();
  if (keyData.userId !== userId) {
    throw new Error('API key does not belong to this user');
  }
  
  // Update the name
  await keyDoc.ref.update({
    name: newName,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  return true;
}

/**
 * Get API key usage statistics
 */
async function getApiKeyStats(userId, days = 30) {
  const db = getDb();
  
  const keysSnapshot = await db.collection('apiKeys')
    .where('userId', '==', userId)
    .get();
  
  let totalRequests = 0;
  let activeKeys = 0;
  
  keysSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (!data.revoked) {
      activeKeys++;
      totalRequests += data.totalRequests || 0;
    }
  });
  
  return {
    activeKeys,
    totalRequests,
    averageRequestsPerKey: activeKeys > 0 ? Math.round(totalRequests / activeKeys) : 0
  };
}

module.exports = {
  generateApiKey,
  createApiKey,
  getUserApiKeys,
  revokeApiKey,
  updateApiKeyName,
  getApiKeyStats
};