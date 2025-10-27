#!/usr/bin/env node
const crypto = require('node:crypto');

const [secret] = process.argv.slice(2);
if (!secret) {
  console.error('Usage: node apps/control-plane/scripts/hash-secret.js <plain-text-secret>');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(secret).digest('hex');
console.log(hash);
