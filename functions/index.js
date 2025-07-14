const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onInit } = require('firebase-functions/v2/core');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Import middleware and utilities
const { authenticateUser, requireTier, requirePermission, requireOrganizationAccess, setDb } = require('./middleware/auth');
const { dynamicRateLimiter, expensiveOperationLimiter } = require('./middleware/rateLimiter');
const { usageTrackingMiddleware, checkTimerLimit, checkConcurrentTimerLimit, trackTimerCreation } = require('./utils/usageTracking');
const { createApiKey, getUserApiKeys, revokeApiKey, updateApiKeyName, getApiKeyStats } = require('./utils/apiKey');
const { createCheckoutSession, handleSubscriptionCreated, handleSubscriptionCanceled, createBillingPortalSession, getUserSubscription, PRICES } = require('./utils/stripe');

let db;

onInit(async () => {
  // MINIMAL initialization only - defer everything else to first request
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  
  db = admin.firestore();
  setDb(db);
  global.rbacDb = db;
  
  console.log('MINOOTS core initialized - RBAC will initialize on first use');
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Apply middleware in order
app.use(usageTrackingMiddleware);
app.use(authenticateUser);
app.use(dynamicRateLimiter);

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
        
        // Add optional fields only if they exist (prevents undefined Firestore errors)
        if (config.team) timerData.team = config.team;
        if (config.scenario) timerData.scenario = config.scenario;
        if (config.organizationId) timerData.organizationId = config.organizationId;
        if (config.projectId) timerData.projectId = config.projectId;
        
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
        if (filters.organizationId) {
            query = query.where('organizationId', '==', filters.organizationId);
        }
        if (filters.projectId) {
            query = query.where('projectId', '==', filters.projectId);
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
                const body = JSON.stringify({
                    event: 'timer_expired',
                    timer,
                    message: timer.events.on_expire.message,
                    data: timer.events.on_expire.data
                });

                const crypto = require('crypto');
                const secret = process.env.MINOOTS_WEBHOOK_SECRET;
                const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

                const response = await fetch(timer.events.on_expire.webhook, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Minoots-Signature': signature
                    },
                    body: body
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

// Timer creation with limits, tracking, and RBAC
app.post('/timers', expensiveOperationLimiter, requirePermission('create', 'timers'), async (req, res) => {
    try {
        // Check daily timer limit
        const dailyCheck = await checkTimerLimit(req.user.id, req.user.tier);
        if (!dailyCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: `Daily timer limit reached (${dailyCheck.limit} timers per day)`,
                used: dailyCheck.used,
                limit: dailyCheck.limit,
                upgradeUrl: req.user.tier === 'free' ? 'https://github.com/Domusgpt/minoots-timer-system#pricing' : null
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
                upgradeUrl: req.user.tier === 'free' ? 'https://github.com/Domusgpt/minoots-timer-system#pricing' : null
            });
        }

        // Add user context and RBAC info to timer creation
        const timerConfig = {
            ...req.body,
            agent_id: req.body.agent_id || req.user.id,
            organizationId: req.body.organizationId,
            projectId: req.body.projectId,
            metadata: {
                ...req.body.metadata,
                createdBy: req.user.id,
                userTier: req.user.tier,
                permissionSource: req.permissionSource || 'anonymous'
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

app.get('/timers', requirePermission('read', 'timers'), async (req, res) => {
    try {
        // Add user context to filter timers they can access
        const filters = {
            ...req.query,
            // For now, users can see their own timers
            // TODO: Add organization-level filtering for team tier
            agent_id: req.query.agent_id || (req.user.tier === 'free' ? req.user.id : undefined)
        };
        
        const timers = await RealTimer.list(filters);
        
        // Filter timers based on user's organization access
        const accessibleTimers = timers.filter(timer => {
            // User can always see their own timers
            if (timer.metadata?.createdBy === req.user.id) return true;
            
            // For organization timers, check if user has access
            if (timer.organizationId) {
                const userOrgs = req.user.organizations || [];
                return userOrgs.some(org => 
                    (org.id || org.organizationId) === timer.organizationId
                );
            }
            
            return true;
        });
        
        res.json({ 
            success: true, 
            timers: accessibleTimers, 
            count: accessibleTimers.length,
            filtered: timers.length - accessibleTimers.length
        });
    } catch (error) {
        console.error('List timers error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/timers/:id', requirePermission('read', 'timers'), async (req, res) => {
    try {
        const timer = await RealTimer.get(req.params.id);
        if (!timer) {
            return res.status(404).json({ success: false, error: 'Timer not found' });
        }
        res.json({ success: true, timer });
    } catch (error) {
        console.error('Get timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/timers/:id', requirePermission('delete', 'timers'), async (req, res) => {
    try {
        await RealTimer.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/quick/wait', async (req, res) => {
    try {
        const timer = await RealTimer.create({
            duration: req.body.duration,
            name: req.body.name || `wait_${Date.now()}`,
            agent_id: req.body.agent_id || 'quick_wait_agent',
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

app.post('/teams/:team/broadcast', requirePermission('manage', 'teams'), async (req, res) => {
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
app.post('/account/api-keys', requirePermission('manage', 'api_keys'), async (req, res) => {
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

app.get('/account/api-keys', requirePermission('read', 'api_keys'), async (req, res) => {
    try {
        const keys = await getUserApiKeys(req.user.id);
        res.json({ success: true, apiKeys: keys });
    } catch (error) {
        console.error('List API keys error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/account/api-keys/:keyId', requirePermission('manage', 'api_keys'), async (req, res) => {
    try {
        await revokeApiKey(req.user.id, req.params.keyId);
        res.json({ success: true, message: 'API key revoked successfully' });
    } catch (error) {
        console.error('Revoke API key error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/account/api-keys/:keyId', requirePermission('manage', 'api_keys'), async (req, res) => {
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
        // Handle missing FUNCTIONS_SOURCE environment variable
        const functionsSource = process.env.FUNCTIONS_SOURCE;
        
        if (!functionsSource) {
            return res.json({
                success: false,
                error: 'MCP server configuration not available in this environment',
                message: 'FUNCTIONS_SOURCE environment variable not set. This is required for MCP server configuration.',
                alternative: {
                    suggestion: 'Download and run the MCP server locally',
                    repository: 'https://github.com/Domusgpt/minoots-timer-system',
                    localCommand: 'node mcp/index.js',
                    environment: {
                        MINOOTS_API_KEY: 'your_api_key_here',
                        MINOOTS_API_BASE: 'https://api-m3waemr5lq-uc.a.run.app'
                    }
                }
            });
        }
        
        res.json({
            success: true,
            mcpServer: {
                command: 'node',
                args: [`${functionsSource}/mcp/index.js`],
                env: {
                    MINOOTS_API_BASE: process.env.MINOOTS_API_BASE || 'https://api-m3waemr5lq-uc.a.run.app',
                    MINOOTS_API_KEY: '<your_api_key_here>'
                }
            },
            message: 'Add this configuration to your Claude Desktop settings',
            setup: {
                steps: [
                    '1. Create an API key at /account/api-keys',
                    '2. Replace <your_api_key_here> with your actual API key',
                    '3. Add the configuration to Claude Desktop'
                ]
            }
        });
    } catch (error) {
        console.error('MCP config error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Organization Management Endpoints (Team tier and above)
app.post('/organizations', requireTier('team'), requirePermission('create', 'organizations'), async (req, res) => {
    try {
        const { FirestoreSchemaManager } = require('./rbac-system/core/FirestoreSchema');
        const schemaManager = new FirestoreSchemaManager(db);
        
        const organizationData = {
            name: req.body.name,
            slug: req.body.slug,
            settings: req.body.settings || {},
            ...req.body
        };
        
        const organization = await schemaManager.createOrganization(organizationData, req.user.id);
        
        // Sync user's Custom Claims to include new organization
        await req.rbac.claimsManager.syncFromFirestore(req.user.id);
        
        res.status(201).json({
            success: true,
            organization,
            message: 'Organization created successfully'
        });
    } catch (error) {
        console.error('Create organization error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/organizations', requirePermission('read', 'organizations'), async (req, res) => {
    try {
        // Get user's organizations from Custom Claims or Firestore
        const userOrgs = req.user.organizations || [];
        const organizations = [];
        
        for (const orgAccess of userOrgs) {
            const orgDoc = await db.collection('organizations').doc(orgAccess.id || orgAccess.organizationId).get();
            if (orgDoc.exists) {
                organizations.push({
                    id: orgDoc.id,
                    role: orgAccess.role,
                    ...orgDoc.data()
                });
            }
        }
        
        res.json({
            success: true,
            organizations,
            count: organizations.length
        });
    } catch (error) {
        console.error('List organizations error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/organizations/:orgId', requireOrganizationAccess('orgId'), async (req, res) => {
    try {
        const orgDoc = await db.collection('organizations').doc(req.organizationId).get();
        
        if (!orgDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Organization not found'
            });
        }
        
        res.json({
            success: true,
            organization: {
                id: orgDoc.id,
                userRole: req.organizationRole,
                ...orgDoc.data()
            }
        });
    } catch (error) {
        console.error('Get organization error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/organizations/:orgId/invite', requireOrganizationAccess('orgId'), async (req, res) => {
    try {
        // Check if user has admin role in this organization
        const { RoleManager } = require('./rbac-system/core/RoleDefinitions');
        const canInvite = RoleManager.isRoleHigher(req.organizationRole, 'editor');
        
        if (!canInvite) {
            return res.status(403).json({
                success: false,
                error: 'Admin or Owner role required to invite users'
            });
        }
        
        const { FirestoreSchemaManager } = require('./rbac-system/core/FirestoreSchema');
        const schemaManager = new FirestoreSchemaManager(db);
        
        const invitation = await schemaManager.inviteUserToOrganization(
            req.organizationId,
            req.body.email,
            req.body.role || 'editor',
            req.user.id
        );
        
        res.status(201).json({
            success: true,
            invitation,
            message: 'User invitation sent successfully'
        });
    } catch (error) {
        console.error('Invite user error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/organizations/:orgId/projects', requireOrganizationAccess('orgId'), async (req, res) => {
    try {
        // Check if user can create projects
        const { RoleManager } = require('./rbac-system/core/RoleDefinitions');
        const canCreateProject = RoleManager.hasPermission(req.organizationRole, 'create', 'projects');
        
        if (!canCreateProject) {
            return res.status(403).json({
                success: false,
                error: 'Manager role or higher required to create projects'
            });
        }
        
        const { FirestoreSchemaManager } = require('./rbac-system/core/FirestoreSchema');
        const schemaManager = new FirestoreSchemaManager(db);
        
        const projectData = {
            name: req.body.name,
            description: req.body.description,
            settings: req.body.settings || {},
            access: req.body.access || {},
            ...req.body
        };
        
        const project = await schemaManager.createProject(projectData, req.organizationId, req.user.id);
        
        res.status(201).json({
            success: true,
            project,
            message: 'Project created successfully'
        });
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/organizations/:orgId/projects', requireOrganizationAccess('orgId'), async (req, res) => {
    try {
        const projectsQuery = await db.collection('projects')
            .where('organizationId', '==', req.organizationId)
            .get();
        
        const projects = projectsQuery.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.json({
            success: true,
            projects,
            count: projects.length
        });
    } catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Analytics endpoints (Team tier and above with view_analytics permission)
app.get('/analytics/organization/:orgId', requireOrganizationAccess('orgId'), requirePermission('view_analytics', 'analytics'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        // Get organization members
        const orgDoc = await db.collection('organizations').doc(req.organizationId).get();
        if (!orgDoc.exists) {
            return res.status(404).json({ success: false, error: 'Organization not found' });
        }
        
        const orgData = orgDoc.data();
        const memberIds = Object.keys(orgData.members || {});
        
        // Aggregate usage stats for all organization members
        let totalTimers = 0;
        let totalRequests = 0;
        let memberStats = {};
        
        for (const memberId of memberIds) {
            const { getUserUsageStats } = require('./utils/usageTracking');
            const memberUsage = await getUserUsageStats(memberId, days);
            
            totalTimers += memberUsage.totalTimers;
            totalRequests += memberUsage.totalRequests;
            memberStats[memberId] = {
                timers: memberUsage.totalTimers,
                requests: memberUsage.totalRequests,
                dailyStats: memberUsage.dailyStats
            };
        }
        
        // Get organization timer stats
        const timersQuery = await db.collection('timers')
            .where('organizationId', '==', req.organizationId)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .get();
        
        const orgTimers = timersQuery.docs.map(doc => doc.data());
        const timersByStatus = {
            running: orgTimers.filter(t => t.status === 'running').length,
            expired: orgTimers.filter(t => t.status === 'expired').length,
            total: orgTimers.length
        };
        
        // Calculate average timer duration
        const avgDuration = orgTimers.length > 0 
            ? Math.round(orgTimers.reduce((sum, t) => sum + t.duration, 0) / orgTimers.length)
            : 0;
        
        res.json({
            success: true,
            organizationId: req.organizationId,
            period: {
                days: days,
                startDate: startDate.toISOString(),
                endDate: new Date().toISOString()
            },
            summary: {
                totalMembers: memberIds.length,
                totalTimers: totalTimers,
                totalRequests: totalRequests,
                organizationTimers: timersByStatus.total,
                avgTimerDuration: avgDuration,
                activeTimers: timersByStatus.running
            },
            timers: {
                byStatus: timersByStatus,
                averageDuration: `${Math.floor(avgDuration / 60000)}m ${Math.floor((avgDuration % 60000) / 1000)}s`
            },
            members: memberStats
        });
    } catch (error) {
        console.error('Organization analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/analytics/team/:teamName', requirePermission('view_analytics', 'analytics'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        // Get team timers and broadcasts
        const timersQuery = await db.collection('timers')
            .where('team', '==', req.params.teamName)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .get();
        
        const broadcastsQuery = await db.collection('team_broadcasts')
            .where('team', '==', req.params.teamName)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .get();
        
        const teamTimers = timersQuery.docs.map(doc => doc.data());
        const teamBroadcasts = broadcastsQuery.docs.map(doc => doc.data());
        
        // Get unique agents in team
        const uniqueAgents = [...new Set(teamTimers.map(t => t.agentId))];
        
        // Calculate team coordination metrics
        const coordinationMetrics = {
            totalTimers: teamTimers.length,
            totalBroadcasts: teamBroadcasts.length,
            uniqueAgents: uniqueAgents.length,
            avgTimersPerAgent: uniqueAgents.length > 0 ? Math.round(teamTimers.length / uniqueAgents.length) : 0,
            coordinationSessions: teamTimers.filter(t => t.metadata?.coordination_session).length
        };
        
        // Daily breakdown
        const dailyStats = {};
        teamTimers.forEach(timer => {
            const date = new Date(timer.createdAt?.toDate?.() || timer.createdAt).toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { timers: 0, agents: new Set() };
            }
            dailyStats[date].timers++;
            dailyStats[date].agents.add(timer.agentId);
        });
        
        // Convert Set to count for JSON serialization
        Object.keys(dailyStats).forEach(date => {
            dailyStats[date].uniqueAgents = dailyStats[date].agents.size;
            delete dailyStats[date].agents;
        });
        
        res.json({
            success: true,
            team: req.params.teamName,
            period: {
                days: days,
                startDate: startDate.toISOString(),
                endDate: new Date().toISOString()
            },
            coordination: coordinationMetrics,
            dailyBreakdown: dailyStats,
            recentBroadcasts: teamBroadcasts.slice(-5).map(b => ({
                message: b.message,
                timestamp: b.timestamp || b.createdAt?.toDate?.()?.getTime?.()
            }))
        });
    } catch (error) {
        console.error('Team analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/analytics/personal', requirePermission('view_analytics', 'analytics'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const { getUserUsageStats } = require('./utils/usageTracking');
        const { getApiKeyStats } = require('./utils/apiKey');
        
        const usage = await getUserUsageStats(req.user.id, days);
        const apiKeyStats = await getApiKeyStats(req.user.id, days);
        
        // Get user's recent timers for trends
        const timersQuery = await db.collection('timers')
            .where('metadata.createdBy', '==', req.user.id)
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();
        
        const userTimers = timersQuery.docs.map(doc => doc.data());
        
        // Calculate productivity metrics
        const productivity = {
            averageTimerDuration: userTimers.length > 0 
                ? Math.round(userTimers.reduce((sum, t) => sum + t.duration, 0) / userTimers.length)
                : 0,
            mostActiveHour: getMostActiveHour(userTimers),
            timerCompletionRate: calculateCompletionRate(userTimers),
            favoriteTeams: getFavoriteTeams(userTimers)
        };
        
        res.json({
            success: true,
            userId: req.user.id,
            period: {
                days: days,
                startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date().toISOString()
            },
            usage: usage,
            apiKeys: apiKeyStats,
            productivity: productivity,
            tier: req.user.tier
        });
    } catch (error) {
        console.error('Personal analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper functions for analytics
function getMostActiveHour(timers) {
    const hourCounts = {};
    timers.forEach(timer => {
        const hour = new Date(timer.createdAt?.toDate?.() || timer.createdAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    
    let mostActiveHour = 0;
    let maxCount = 0;
    Object.entries(hourCounts).forEach(([hour, count]) => {
        if (count > maxCount) {
            maxCount = count;
            mostActiveHour = parseInt(hour);
        }
    });
    
    return `${mostActiveHour}:00`;
}

function calculateCompletionRate(timers) {
    if (timers.length === 0) return 0;
    const completed = timers.filter(t => t.status === 'expired').length;
    return Math.round((completed / timers.length) * 100);
}

function getFavoriteTeams(timers) {
    const teamCounts = {};
    timers.forEach(timer => {
        if (timer.team) {
            teamCounts[timer.team] = (teamCounts[timer.team] || 0) + 1;
        }
    });
    
    return Object.entries(teamCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([team, count]) => ({ team, count }));
}

// Billing and subscription endpoints
app.post('/billing/create-checkout', async (req, res) => {
    try {
        const { priceId } = req.body;
        const successUrl = req.body.successUrl || 'https://github.com/Domusgpt/minoots-timer-system#account-management';
        const cancelUrl = req.body.cancelUrl || 'https://github.com/Domusgpt/minoots-timer-system#pricing';
        
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
        const returnUrl = req.body.returnUrl || 'https://github.com/Domusgpt/minoots-timer-system#account-management';
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

app.get('/docs', (req, res) => {
    res.json({
        success: true,
        title: 'MINOOTS Timer System API Documentation',
        version: '2.0.0',
        description: 'Independent Timer System for Autonomous Agents & Enterprise Workflows',
        baseUrl: 'https://api-m3waemr5lq-uc.a.run.app',
        authentication: {
            methods: ['Firebase Auth', 'API Key'],
            headers: {
                'Authorization': 'Bearer <firebase_jwt_token>',
                'x-api-key': 'mnt_<your_api_key>'
            },
            anonymous: {
                note: 'Anonymous usage allowed with limits',
                limits: {
                    dailyTimers: 5,
                    dailyRequests: 50,
                    maxDuration: '1h'
                }
            }
        },
        endpoints: {
            timers: {
                'POST /timers': 'Create a new timer',
                'GET /timers': 'List timers with filtering',
                'GET /timers/:id': 'Get specific timer details',
                'DELETE /timers/:id': 'Delete a timer',
                'POST /quick/wait': 'Create simple wait timer'
            },
            organizations: {
                'POST /organizations': 'Create organization (Team tier+)',
                'GET /organizations': 'List user organizations',
                'GET /organizations/:id': 'Get organization details',
                'POST /organizations/:id/invite': 'Invite user to organization',
                'POST /organizations/:id/projects': 'Create project',
                'GET /organizations/:id/projects': 'List organization projects'
            },
            account: {
                'POST /account/api-keys': 'Create API key',
                'GET /account/api-keys': 'List API keys',
                'PUT /account/api-keys/:id': 'Update API key',
                'DELETE /account/api-keys/:id': 'Revoke API key',
                'GET /account/usage': 'Get usage statistics'
            },
            analytics: {
                'GET /analytics/personal': 'Personal productivity analytics (Team tier+)',
                'GET /analytics/organization/:id': 'Organization analytics (Team tier+)',
                'GET /analytics/team/:name': 'Team coordination analytics (Team tier+)'
            },
            billing: {
                'POST /billing/create-checkout': 'Create Stripe checkout',
                'POST /billing/portal': 'Access billing portal',
                'GET /billing/subscription': 'Get subscription details'
            },
            public: {
                'GET /health': 'API health check',
                'GET /pricing': 'Pricing tiers and features',
                'GET /docs': 'This documentation endpoint'
            }
        },
        resources: {
            github: 'https://github.com/Domusgpt/minoots-timer-system',
            documentation: 'https://github.com/Domusgpt/minoots-timer-system/tree/main/docs',
            examples: 'https://github.com/Domusgpt/minoots-timer-system#examples',
            mcp_integration: 'https://github.com/Domusgpt/minoots-timer-system#mcp-integration'
        },
        support: {
            issues: 'https://github.com/Domusgpt/minoots-timer-system/issues',
            discussions: 'https://github.com/Domusgpt/minoots-timer-system/discussions'
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

// Manual timer expiration trigger (for testing scheduled function logic)
app.post('/manual-expire-timers', async (req, res) => {
    try {
        console.log('Manual timer expiration triggered...');
        
        const now = Date.now();
        // Get all running timers first, then filter by endTime in memory (avoids composite index)
        const runningTimersQuery = await db.collection('timers')
            .where('status', '==', 'running')
            .get();
        
        // Filter expired timers in memory
        const expiredDocs = runningTimersQuery.docs.filter(doc => {
            const data = doc.data();
            return data.endTime <= now;
        });
        
        const expiredTimers = [];
        const promises = expiredDocs.map(async doc => {
            const timer = await RealTimer.expire(doc.id);
            expiredTimers.push({
                id: doc.id,
                name: timer?.name || 'unknown',
                webhook: timer?.events?.on_expire?.webhook || null,
                message: timer?.events?.on_expire?.message || null,
                data: timer?.events?.on_expire?.data || null
            });
            return timer;
        });
        
        await Promise.all(promises);
        
        res.json({
            success: true,
            processedTimers: expiredTimers.length,
            expiredTimers: expiredTimers,
            timestamp: now
        });
        
        console.log(`Manually processed ${expiredTimers.length} expired timers`);
    } catch (error) {
        console.error('Manual expiration error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Real timer expiration checker
exports.checkExpiredTimers = onSchedule('every 1 minutes', async (event) => {
        console.log('Checking for expired timers...');
        
        const now = Date.now();
        // Get all running timers first, then filter by endTime in memory (avoids composite index)
        const runningTimersQuery = await db.collection('timers')
            .where('status', '==', 'running')
            .get();
        
        // Filter expired timers in memory
        const expiredDocs = runningTimersQuery.docs.filter(doc => {
            const data = doc.data();
            return data.endTime <= now;
        });
        
        const promises = expiredDocs.map(doc => 
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

// RBAC Cloud Function Triggers
const {
    syncUserClaims,
    syncOrganizationClaims,
    syncSubscriptionClaims,
    cleanupOrphanedClaims,
    manualClaimsSync
} = require('./rbac-system/core/CloudFunctionTriggers');

// Export RBAC triggers
exports.syncUserClaims = syncUserClaims;
exports.syncOrganizationClaims = syncOrganizationClaims;
exports.syncSubscriptionClaims = syncSubscriptionClaims;
exports.cleanupOrphanedClaims = cleanupOrphanedClaims;
exports.manualClaimsSync = manualClaimsSync;

// Main API export
exports.api = onRequest(app);