const { onRequest } = require('firebase-functions/v2/https');

exports.api = onRequest((req, res) => {
  res.json({
    status: 'MINOOTS API is live!',
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

exports.health = onRequest((req, res) => {
  res.json({
    service: 'MINOOTS Timer System',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});