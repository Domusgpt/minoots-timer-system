#!/usr/bin/env node

/**
 * ACME Challenge Server - Responds to Firebase domain verification
 */

const http = require('http');
const fs = require('fs');

const ACME_TOKEN = 'B9XmrYrHF_U9OzMn-_0qOuGRFKjj2dLZ_NACKRxN_qY';
const PORT = 8080;

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Host: ${req.headers.host}`);
    
    // Handle ACME challenge
    if (req.url.includes('/.well-known/acme-challenge/')) {
        console.log('🔍 ACME Challenge request detected!');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(ACME_TOKEN);
        console.log(`✅ Responded with ACME token: ${ACME_TOKEN}`);
        return;
    }
    
    // Handle root and other requests
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>Firebase Domain Verification</title>
</head>
<body>
    <h1>Domain: ${req.headers.host}</h1>
    <p>ACME Challenge Server Running</p>
    <p>Time: ${new Date().toISOString()}</p>
    <p>Firebase domain verification in progress...</p>
</body>
</html>
    `);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ACME Challenge Server running on port ${PORT}`);
    console.log(`🔑 ACME Token ready: ${ACME_TOKEN}`);
    console.log(`🌐 Will respond to Firebase verification requests`);
    console.log(`📡 Server accessible at http://lighthouselandscapelbi.com`);
});

server.on('error', (err) => {
    if (err.code === 'EACCES') {
        console.error('❌ Permission denied - run with sudo for port 80');
        console.log('💡 Try: sudo node acme-server.js');
    } else {
        console.error('❌ Server error:', err);
    }
});