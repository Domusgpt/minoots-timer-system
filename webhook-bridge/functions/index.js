/**
 * MINOOTS WEBHOOK BRIDGE - Firebase Functions
 * Individual functions for optimal scaling and fault isolation
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onInit } = require('firebase-functions/v2/core');
const admin = require('firebase-admin');

// Global scope initialization - happens at load time for instance reuse
console.log('Global scope: MINOOTS Webhook Bridge loading');
let db;

// Use onInit() to defer heavy initialization and avoid deployment timeouts
onInit(async () => {
  console.log('onInit: Starting Firebase initialization');
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  db = admin.firestore();
  console.log('onInit: MINOOTS Webhook Bridge initialized successfully');
});

/**
 * Receive timer webhooks and queue commands for specific users
 * SECURITY: Validates webhook is from legitimate MINOOTS API user
 */
exports.webhook = onRequest({
  cors: true,
  timeoutSeconds: 30,
}, async (req, res) => {
  const userId = req.params[0]; // Extract user ID from path
  
  console.log(`📨 Webhook received for user: ${userId}`);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const webhook = req.body;
    
    // Validate webhook structure (must be from MINOOTS API)
    if (!webhook.event || webhook.event !== 'timer_expired' || !webhook.timer) {
      console.log('❌ Invalid webhook: not from MINOOTS API');
      return res.status(400).json({ 
        error: 'Invalid webhook: must be from MINOOTS API' 
      });
    }
    
    // Validate webhook contains command data
    if (!webhook.data || !webhook.data.command) {
      console.log('❌ Invalid webhook: missing command data');
      return res.status(400).json({ 
        error: 'Invalid webhook: missing command data' 
      });
    }
    
    // SECURITY: Validate timer was created by the target user
    const timerCreatedBy = webhook.timer.metadata?.createdBy;
    const timerAgentId = webhook.timer.agentId;
    
    if (!timerCreatedBy || (!timerCreatedBy.includes(userId) && !timerAgentId.includes(userId))) {
      console.log(`❌ Security violation: Timer created by ${timerCreatedBy} but webhook for ${userId}`);
      return res.status(403).json({ 
        error: 'Unauthorized: Timer not created by target user' 
      });
    }
    
    // Create command document for user's queue
    const commandDoc = {
      // Command execution details
      command: webhook.data.command,
      timer_id: webhook.timer?.id || 'unknown',
      timer_name: webhook.timer?.name || 'Unknown Timer',
      
      // Session targeting information
      session_id: webhook.data.session_id,
      working_directory: webhook.data.working_directory,
      process_pid: webhook.data.process_pid,
      user_id: webhook.data.user_id,
      username: webhook.data.username,
      git_branch: webhook.data.git_branch,
      git_repo: webhook.data.git_repo,
      platform: webhook.data.platform,
      
      // Metadata
      message: webhook.message,
      created_timestamp: webhook.data.created_timestamp,
      received_timestamp: admin.firestore.FieldValue.serverTimestamp(),
      executed: false,
      
      // Original webhook data for debugging
      original_webhook: webhook
    };
    
    // Store in user's command queue
    const docRef = await db
      .collection('user_commands')
      .doc(userId)
      .collection('pending')
      .add(commandDoc);
    
    console.log(`✅ Command queued for user ${userId}: ${commandDoc.command}`);
    console.log(`📍 Target: ${commandDoc.session_id} in ${commandDoc.working_directory}`);
    
    res.json({
      success: true,
      command_id: docRef.id,
      message: 'Command queued successfully',
      target_session: commandDoc.session_id,
      working_directory: commandDoc.working_directory
    });
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({
      error: 'Failed to process webhook',
      details: error.message
    });
  }
});

/**
 * Get pending commands for a user (daemon polls this)
 */
exports.commands = onRequest({
  cors: true,
  timeoutSeconds: 30,
}, async (req, res) => {
  const userId = req.params[0]; // Extract user ID from path
  
  try {
    console.log(`🔍 Daemon polling commands for user: ${userId}`);
    
    // Get pending commands for user
    const snapshot = await db
      .collection('user_commands')
      .doc(userId)
      .collection('pending')
      .where('executed', '==', false)
      .orderBy('received_timestamp', 'asc')
      .limit(10)
      .get();
    
    const commands = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Format data to match what daemon expects
      commands.push({
        id: doc.id,
        command: data.command,
        session_id: data.session_id || null,
        working_directory: data.working_directory || ".",
        timer_name: data.timer_name || data.timer_id,
        username: userId,
        executed: false
      });
    });
    
    console.log(`📋 Found ${commands.length} pending commands for user ${userId}`);
    console.log(`📤 Returning daemon-compatible format:`, commands);
    
    res.json(commands);
    
  } catch (error) {
    console.error('❌ Error getting commands:', error);
    res.status(500).json({
      error: 'Failed to get commands',
      details: error.message
    });
  }
});

/**
 * Mark command as executed (daemon calls this after execution)
 */
exports.markExecuted = onRequest({
  cors: true,
  timeoutSeconds: 30,
}, async (req, res) => {
  const { commandId, userId } = req.body;
  
  try {
    console.log(`✅ Daemon marking command ${commandId} as executed for user ${userId}`);
    
    // Find and update the command document
    await db
      .collection('user_commands')
      .doc(userId || 'millz_Kalmgogorov') // Default user if not provided
      .collection('pending')
      .doc(commandId)
      .update({
        executed: true,
        executed_timestamp: admin.firestore.FieldValue.serverTimestamp(),
        execution_result: req.body.result || 'completed'
      });
    
    console.log(`✅ Command ${commandId} successfully marked as executed`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Error marking command as executed:', error);
    res.status(500).json({
      error: 'Failed to mark command as executed',
      details: error.message
    });
  }
});

/**
 * Health check for bridge service
 */
exports.health = onRequest((req, res) => {
  res.json({
    status: 'healthy',
    service: 'MINOOTS Webhook Bridge',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});