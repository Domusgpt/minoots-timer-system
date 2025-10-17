const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onInit } = require('firebase-functions/v2/core');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Import middleware and utilities
const { authenticateUser, requireTier, requireTeamRole, hasTeamRole, loadUserTeams, setDb } = require('./middleware/auth');
const { dynamicRateLimiter, expensiveOperationLimiter } = require('./middleware/rateLimiter');
const { usageTrackingMiddleware, checkTimerLimit, checkConcurrentTimerLimit, trackTimerCreation } = require('./utils/usageTracking');
const { createApiKey, getUserApiKeys, revokeApiKey, updateApiKeyName, getApiKeyStats } = require('./utils/apiKey');
const { createCheckoutSession, handleSubscriptionCreated, handleSubscriptionCanceled, createBillingPortalSession, getUserSubscription, PRICES, linkTeamBilling } = require('./utils/stripe');
const { createTeam, addMember, updateMemberRole, removeMember, listTeamsForUser, getTeam, createInvitation, listInvitations, acceptInvitation, revokeInvitation } = require('./utils/teamService');

let db;

onInit(() => {
  admin.initializeApp();
  db = admin.firestore();
  // Set db reference for auth middleware
  setDb(db);
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Apply middleware in order
app.use(usageTrackingMiddleware);
app.use(authenticateUser);
app.use(dynamicRateLimiter);

// Team management endpoints (Phase 4 foundation)
app.post('/teams', requireTier('team'), async (req, res) => {
    try {
        const team = await createTeam({
            name: req.body.name,
            ownerId: req.user.id,
            plan: req.body.plan || req.user.tier || 'team',
            metadata: req.body.metadata || {},
        });
        if (req.body.billing) {
            await linkTeamBilling(team.id, {
                ...req.body.billing,
                updatedBy: req.user.id,
            });
        }

        const invitations = req.body.invitations;
        if (Array.isArray(invitations) && invitations.length > 0) {
            await Promise.all(
                invitations.map((invite) =>
                    createInvitation(team.id, {
                        email: invite.email,
                        role: invite.role,
                        inviterId: req.user.id,
                        expiresInMinutes: invite.expiresInMinutes,
                    })
                )
            );
        }

        res.json({ success: true, team });
    } catch (error) {
        console.error('Create team error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/teams', async (req, res) => {
    try {
        const teams = await listTeamsForUser(req.user.id);
        res.json({ success: true, teams });
    } catch (error) {
        console.error('List teams error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/members', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    const { userId, role } = req.body;
    try {
        await addMember(teamId, userId, role || 'member', req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Add member error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/teams/:teamId/members/:memberId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, memberId } = req.params;
    const { role } = req.body;
    try {
        await updateMemberRole(teamId, memberId, role || 'member');
        res.json({ success: true });
    } catch (error) {
        console.error('Update member role error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/members/:memberId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, memberId } = req.params;
    try {
        await removeMember(teamId, memberId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/invitations', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    const { email, role, expiresInMinutes } = req.body || {};

    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    try {
        const invitation = await createInvitation(teamId, {
            email,
            role,
            inviterId: req.user.id,
            expiresInMinutes,
        });

        res.json({ success: true, invitation });
    } catch (error) {
        console.error('Create invitation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/invitations', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const invitations = await listInvitations(teamId);
        res.json({ success: true, invitations });
    } catch (error) {
        console.error('List invitations error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/invitations/:token', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, token } = req.params;
    try {
        await revokeInvitation(teamId, token, req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Revoke invitation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/invitations/:token/accept', async (req, res) => {
    const { token } = req.params;
    try {
        const result = await acceptInvitation(token, {
            userId: req.user.id,
            email: req.user.email || req.body?.email,
        });
        res.json({ success: true, membership: result });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.patch('/teams/:teamId/billing', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        await linkTeamBilling(teamId, { ...req.body, updatedBy: req.user.id });
        res.json({ success: true });
    } catch (error) {
        console.error('Update team billing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/billing/checkout-session', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    const { priceId, successUrl, cancelUrl } = req.body || {};

    if (!priceId || !successUrl || !cancelUrl) {
        return res.status(400).json({ success: false, error: 'priceId, successUrl, and cancelUrl are required' });
    }

    try {
        const team = await getTeam(teamId);
        if (!team) {
            return res.status(404).json({ success: false, error: 'Team not found' });
        }

        const session = await createCheckoutSession(
            req.user.id,
            req.user.email || req.body?.customerEmail,
            priceId,
            successUrl,
            cancelUrl,
            { teamId }
        );

        res.json({ success: true, session });
    } catch (error) {
        console.error('Create team checkout session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Real Timer class with Firestore
class RealTimer {
    static parseDuration(duration) {
        if (typeof duration === 'number') return duration;
        const units = { 'ms': 1, 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000 };
        const match = duration.toString().match(/^(\d+)([a-z]+)$/i);
        if (!match) throw new Error(`Invalid duration: ${duration}`);
        const [, value, unit] = match;
        const multiplier = units[unit.toLowerCase()];
        if (!multiplier) throw new Error(`Unknown unit: ${unit}`);
        return parseInt(value) * multiplier;
    }
    
    static async create(config) {
        const timerId = config.id || uuidv4();
        const duration = this.parseDuration(config.duration);
        const now = Date.now();
        
        const timerData = {
            id: timerId,
            name: config.name || timerId,
            agentId: config.agent_id || 'unknown_agent',
            duration,
            startTime: now,
            endTime: now + duration,
            status: 'running',
            events: config.events || {},
            metadata: config.metadata || {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Add optional fields only if they exist
        if (config.team) timerData.team = config.team;
        if (config.scenario) timerData.scenario = config.scenario;
        
        // Store in Firestore
        await db.collection('timers').doc(timerId).set(timerData);
        
        // Schedule expiration
        await this.scheduleExpiration(timerId, duration);
        
        console.log(`Timer created: ${timerData.name} (${timerId}) - expires in ${duration}ms`);
        return { ...timerData, createdAt: now, updatedAt: now };
    }
    
    static async scheduleExpiration(timerId, duration) {
        // Use Firestore document with TTL
        const expirationTime = new Date(Date.now() + duration);
        await db.collection('timer_expirations').doc(timerId).set({
            timerId,
            expiresAt: admin.firestore.Timestamp.fromDate(expirationTime),
            status: 'scheduled'
        });
    }
    
    static async get(timerId) {
        const doc = await db.collection('timers').doc(timerId).get();
        if (!doc.exists) return null;
        
        const data = doc.data();
        const timeRemaining = Math.max(0, data.endTime - Date.now());
        const progress = Math.min(1, (Date.now() - data.startTime) / data.duration);
        
        return { ...data, timeRemaining, progress };
    }
    
    static async list(filters = {}) {
        let query = db.collection('timers');
        
        if (filters.agent_id) {
            query = query.where('agentId', '==', filters.agent_id);
        }
        if (filters.team) {
            query = query.where('team', '==', filters.team);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        
        const snapshot = await query.get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            const timeRemaining = Math.max(0, data.endTime - Date.now());
            const progress = Math.min(1, (Date.now() - data.startTime) / data.duration);
            return { ...data, timeRemaining, progress };
        });
    }
    
    static async update(timerId, updates) {
        const updateData = {
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('timers').doc(timerId).update(updateData);
        return this.get(timerId);
    }
    
    static async expire(timerId) {
        const timer = await this.get(timerId);
        if (!timer || timer.status !== 'running') return;
        
        console.log(`Timer expiring: ${timer.name} (${timerId})`);
        
        // Update status
        await this.update(timerId, { status: 'expired' });
        
        // Execute webhooks
        if (timer.events?.on_expire?.webhook) {
            try {
                // Use built-in fetch in Node.js 18+
                const response = await fetch(timer.events.on_expire.webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'timer_expired',
                        timer,
                        message: timer.events.on_expire.message,
                        data: timer.events.on_expire.data
                    })
                });
                console.log(`Webhook called: ${timer.events.on_expire.webhook} (${response.status})`);
            } catch (error) {
                console.error(`Webhook failed: ${error.message}`);
            }
        }
        
        // Log expiration
        await db.collection('timer_logs').add({
            timerId,
            event: 'expired',
            timerName: timer.name,
            agentId: timer.agentId,
            team: timer.team,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return timer;
    }
    
    static async delete(timerId) {
        const batch = db.batch();
        batch.delete(db.collection('timers').doc(timerId));
        batch.delete(db.collection('timer_expirations').doc(timerId));
        await batch.commit();
        console.log(`Timer deleted: ${timerId}`);
    }
}

// API Routes

// Timer creation with limits and tracking
app.post('/timers', expensiveOperationLimiter, async (req, res) => {
    try {
        // Check daily timer limit
        const dailyCheck = await checkTimerLimit(req.user.id, req.user.tier);
        if (!dailyCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: `Daily timer limit reached (${dailyCheck.limit} timers per day)`,
                used: dailyCheck.used,
                limit: dailyCheck.limit,
                upgradeUrl: req.user.tier === 'free' ? 'https://minoots.com/pricing' : null
            });
        }

        // Check concurrent timer limit
        const concurrentCheck = await checkConcurrentTimerLimit(req.user.id, req.user.tier);
        if (!concurrentCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: `Concurrent timer limit reached (${concurrentCheck.limit} active timers)`,
                current: concurrentCheck.current,
                limit: concurrentCheck.limit,
                upgradeUrl: req.user.tier === 'free' ? 'https://minoots.com/pricing' : null
            });
        }

        const requestedTeam = req.body.team;
        const inferredTeam = requestedTeam || (Array.isArray(req.user.teams) && req.user.teams.length === 1 ? req.user.teams[0].id : undefined);
        if (requestedTeam && !hasTeamRole(req.user, requestedTeam, ['member', 'admin', 'owner'])) {
            return res.status(403).json({ success: false, error: 'You do not have access to this team.' });
        }

        // Add user context to timer creation
        const timerConfig = {
            ...req.body,
            team: inferredTeam,
            agent_id: req.body.agent_id || req.user.id,
            metadata: {
                ...req.body.metadata,
                createdBy: req.user.id,
                userTier: req.user.tier,
                team: inferredTeam
            }
        };

        const timer = await RealTimer.create(timerConfig);
        
        // Track timer creation
        await trackTimerCreation(req.user.id, timer);
        
        res.status(201).json({ 
            success: true, 
            timer,
            usage: {
                daily: {
                    used: dailyCheck.used + 1,
                    limit: dailyCheck.limit,
                    remaining: dailyCheck.remaining - 1
                },
                concurrent: {
                    current: concurrentCheck.current + 1,
                    limit: concurrentCheck.limit,
                    remaining: concurrentCheck.remaining - 1
                }
            }
        });
    } catch (error) {
        console.error('Create timer error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/timers', async (req, res) => {
    try {
        const timers = await RealTimer.list(req.query);
        const visibleTimers = timers.filter((timer) => {
            if (!timer.team) {
                return timer.agentId === req.user.id;
            }
            return hasTeamRole(req.user, timer.team, ['member', 'admin', 'owner']);
        });
        res.json({ success: true, timers: visibleTimers, count: visibleTimers.length });
    } catch (error) {
        console.error('List timers error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/timers/:id', async (req, res) => {
    try {
        const timer = await RealTimer.get(req.params.id);
        if (!timer) {
            return res.status(404).json({ success: false, error: 'Timer not found' });
        }
        if (timer.team && !hasTeamRole(req.user, timer.team, ['member', 'admin', 'owner'])) {
            return res.status(403).json({ success: false, error: 'You do not have access to this timer.' });
        }
        if (!timer.team && timer.agentId && timer.agentId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'You do not have access to this timer.' });
        }
        res.json({ success: true, timer });
    } catch (error) {
        console.error('Get timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/timers/:id', async (req, res) => {
    try {
        const timer = await RealTimer.get(req.params.id);
        if (!timer) {
            return res.status(404).json({ success: false, error: 'Timer not found' });
        }
        if (timer.team && !hasTeamRole(req.user, timer.team, ['admin', 'owner'])) {
            return res.status(403).json({ success: false, error: 'You do not have permission to delete this timer.' });
        }
        if (!timer.team && timer.agentId && timer.agentId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'You do not have permission to delete this timer.' });
        }
        await RealTimer.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/quick/wait', async (req, res) => {
    try {
        const requestedTeam = req.body.team;
        if (requestedTeam && !hasTeamRole(req.user, requestedTeam, ['member', 'admin', 'owner'])) {
            return res.status(403).json({ success: false, error: 'You do not have access to this team.' });
        }
        const inferredTeam = requestedTeam || (Array.isArray(req.user.teams) && req.user.teams.length === 1 ? req.user.teams[0].id : undefined);
        const timer = await RealTimer.create({
            duration: req.body.duration,
            name: req.body.name || `wait_${Date.now()}`,
            agent_id: req.body.agent_id || 'quick_wait_agent',
            team: inferredTeam,
            events: req.body.callback ? {
                on_expire: { webhook: req.body.callback }
            } : {}
        });
        res.json({ success: true, timer });
    } catch (error) {
        console.error('Quick wait error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:team/broadcast', async (req, res) => {
    try {
        const broadcast = {
            team: req.params.team,
            message: req.body.message,
            data: req.body.data || {},
            timestamp: Date.now()
        };
        
        // Store in Firestore
        await db.collection('team_broadcasts').add({
            ...broadcast,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Team broadcast: ${req.params.team} - ${req.body.message}`);
        res.json({ success: true, broadcast });
    } catch (error) {
        console.error('Broadcast error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Key Management Endpoints
app.post('/account/api-keys', async (req, res) => {
    try {
        const keyName = req.body.name || 'Default Key';
        const apiKeyData = await createApiKey(req.user.id, req.user.email, req.user.tier, keyName);
        
        res.status(201).json({
            success: true,
            ...apiKeyData,
            warning: 'Save this API key - it will not be shown again!'
        });
    } catch (error) {
        console.error('Create API key error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/account/api-keys', async (req, res) => {
    try {
        const keys = await getUserApiKeys(req.user.id);
        res.json({ success: true, apiKeys: keys });
    } catch (error) {
        console.error('List API keys error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/account/api-keys/:keyId', async (req, res) => {
    try {
        await revokeApiKey(req.user.id, req.params.keyId);
        res.json({ success: true, message: 'API key revoked successfully' });
    } catch (error) {
        console.error('Revoke API key error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/account/api-keys/:keyId', async (req, res) => {
    try {
        await updateApiKeyName(req.user.id, req.params.keyId, req.body.name);
        res.json({ success: true, message: 'API key updated successfully' });
    } catch (error) {
        console.error('Update API key error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Account and usage endpoints
app.get('/account/usage', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const { getUserUsageStats } = require('./utils/usageTracking');
        const usage = await getUserUsageStats(req.user.id, days);
        const apiKeyStats = await getApiKeyStats(req.user.id);
        
        res.json({
            success: true,
            usage,
            apiKeys: apiKeyStats,
            tier: req.user.tier
        });
    } catch (error) {
        console.error('Get usage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// MCP access endpoint (Pro tier only)
app.get('/mcp/config', requireTier('pro'), async (req, res) => {
    try {
        res.json({
            success: true,
            mcpServer: {
                command: 'node',
                args: [`${process.env.FUNCTIONS_SOURCE}/mcp/index.js`],
                env: {
                    MINOOTS_API_BASE: process.env.MINOOTS_API_BASE || 'https://api-m3waemr5lq-uc.a.run.app'
                }
            },
            message: 'Add this configuration to your Claude Desktop settings'
        });
    } catch (error) {
        console.error('MCP config error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Billing and subscription endpoints
app.post('/billing/create-checkout', async (req, res) => {
    try {
        const { priceId } = req.body;
        const successUrl = req.body.successUrl || 'https://minoots.com/account?upgraded=true';
        const cancelUrl = req.body.cancelUrl || 'https://minoots.com/pricing';
        
        // Check if valid price ID
        if (!Object.values(PRICES).includes(priceId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid price ID',
                availablePrices: Object.keys(PRICES)
            });
        }

        const session = await createCheckoutSession(
            req.user.id,
            req.user.email,
            priceId,
            successUrl,
            cancelUrl
        );

        res.json({
            success: true,
            sessionId: session.sessionId,
            checkoutUrl: session.checkoutUrl
        });
    } catch (error) {
        console.error('Create checkout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/billing/portal', async (req, res) => {
    try {
        const returnUrl = req.body.returnUrl || 'https://minoots.com/account';
        const portalUrl = await createBillingPortalSession(req.user.id, returnUrl);
        
        res.json({
            success: true,
            portalUrl: portalUrl
        });
    } catch (error) {
        console.error('Billing portal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/billing/subscription', async (req, res) => {
    try {
        const subscription = await getUserSubscription(req.user.id);
        res.json({
            success: true,
            ...subscription
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pricing', (req, res) => {
    res.json({
        success: true,
        tiers: {
            free: {
                price: 0,
                name: 'Free',
                features: [
                    '5 concurrent timers',
                    '100 timers per month',
                    'Basic webhooks',
                    '7 day history'
                ]
            },
            pro: {
                price: 19,
                name: 'Pro',
                monthly: PRICES.pro_monthly,
                yearly: PRICES.pro_yearly,
                features: [
                    'Unlimited timers',
                    'MCP Claude integration',
                    'Token reset scheduling',
                    'Advanced webhooks',
                    '90 day history',
                    'Priority support'
                ]
            },
            team: {
                price: 49,
                name: 'Team',
                monthly: PRICES.team_monthly,
                yearly: PRICES.team_yearly,
                features: [
                    'Everything in Pro',
                    'Unlimited team members',
                    'Admin controls',
                    'Usage analytics',
                    'Custom integrations',
                    'SLA guarantee'
                ]
            }
        }
    });
});

// Stripe webhook handler (raw body required)
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
        const event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder'
        );

        console.log('Stripe webhook event:', event.type);

        switch (event.type) {
            case 'customer.subscription.created':
                await handleSubscriptionCreated(event.data.object);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionCreated(event.data.object); // Same handler
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionCanceled(event.data.object);
                break;
            case 'invoice.payment_succeeded':
                console.log('Payment succeeded for subscription:', event.data.object.subscription);
                break;
            case 'invoice.payment_failed':
                console.log('Payment failed for subscription:', event.data.object.subscription);
                break;
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        service: 'MINOOTS Real Firebase Functions',
        version: '2.0.0',
        features: {
            authentication: true,
            rateLimiting: true,
            usageTracking: true,
            mcpIntegration: true
        }
    });
});

// Real timer expiration checker
exports.checkExpiredTimers = onSchedule('every 1 minutes', async (event) => {
        console.log('Checking for expired timers...');
        
        const now = Date.now();
        const expiredQuery = await db.collection('timers')
            .where('status', '==', 'running')
            .where('endTime', '<=', now)
            .get();
        
        const promises = expiredQuery.docs.map(doc => 
            RealTimer.expire(doc.id)
        );
        
        await Promise.all(promises);
        
        if (promises.length > 0) {
            console.log(`Processed ${promises.length} expired timers`);
        }
        
        return null;
    });

// Cleanup old expired timers
exports.cleanupTimers = onSchedule('every 24 hours', async (event) => {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        const oldTimersQuery = await db.collection('timers')
            .where('status', '==', 'expired')
            .where('endTime', '<', oneDayAgo)
            .get();
        
        const batch = db.batch();
        oldTimersQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        console.log(`Cleaned up ${oldTimersQuery.docs.length} old timers`);
        return null;
    });

exports.api = onRequest(app);