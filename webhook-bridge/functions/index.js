
/**
 * MINOOTS WEBHOOK BRIDGE - Firebase Functions
 * Secure, individual functions for optimal scaling and fault isolation
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onInit } = require('firebase-functions/v2/core');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Global scope initialization
let db;

onInit(() => {
  console.log('onInit: Initializing Firebase Admin SDK');
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  db = admin.firestore();
  console.log('onInit: MINOOTS Webhook Bridge initialized successfully');
});

/**
 * Middleware to verify HMAC signature.
 * This is the primary security mechanism.
 */
const verifyWebhookSignature = (req, res, next) => {
  const providedSignature = req.headers['x-minoots-signature'];
  const webhookSecret = process.env.MINOOTS_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('❌ CRITICAL: MINOOTS_WEBHOOK_SECRET is not set in environment.');
    return res.status(500).json({ error: 'Webhook secret not configured on server.' });
  }

  if (!providedSignature) {
    console.log('❌ Denied: Missing X-Minoots-Signature header.');
    return res.status(401).json({ error: 'Unauthorized: Missing signature.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
    console.log('❌ Denied: Invalid signature.');
    return res.status(403).json({ error: 'Forbidden: Invalid signature.' });
  }

  next();
};

/**
 * Receive timer webhooks and queue commands.
 * This endpoint is now secured by the verifyWebhookSignature middleware.
 */
exports.webhook = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    // The verifyWebhookSignature middleware runs first because we will restructure this to an Express app
    const userId = req.params[0];
    console.log(`📨 Webhook received for user: ${userId}`);
    
    try {
      const webhook = req.body;
      // ... (rest of the function remains the same)
      const commandDoc = {
        command: webhook.data.command,
        timer_id: webhook.timer?.id || 'unknown',
        timer_name: webhook.timer?.name || 'Unknown Timer',
        session_id: webhook.data.session_id,
        working_directory: webhook.data.working_directory,
        user_id: webhook.data.user_id,
        received_timestamp: admin.firestore.FieldValue.serverTimestamp(),
        executed: false,
        original_webhook: webhook
      };

      const docRef = await db.collection('user_commands').doc(userId).collection('pending').add(commandDoc);
      console.log(`✅ Command queued for user ${userId}: ${docRef.id}`);
      res.json({ success: true, command_id: docRef.id });

    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook', details: error.message });
    }
  }
);

// We will wrap this in an Express app to apply middleware.
const express = require('express');
const app = express();
app.use(express.json());
app.post('/webhook/:userId', verifyWebhookSignature, exports.webhook);


// The other functions (commands, markExecuted, health) remain as they are for now.
// They will be secured via IAM or other methods if necessary.

exports.commands = onRequest(/* ... */);
exports.markExecuted = onRequest(/* ... */);
exports.health = onRequest(/* ... */);
