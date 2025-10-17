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
const { createCheckoutSession, handleSubscriptionCreated, handleSubscriptionCanceled, createBillingPortalSession, getUserSubscription, PRICES, linkTeamBilling, recordUsageForTeam, listInvoicesForTeam, listPaymentMethodsForTeam, attachPaymentMethodToTeam, detachPaymentMethodFromTeam, startTeamTrial, updateTeamPromotion } = require('./utils/stripe');
const { createTeam, addMember, updateMemberRole, removeMember, listTeamsForUser, getTeam, createInvitation, listInvitations, acceptInvitation, revokeInvitation, shareTimerWithTeam, updateTimerCollaborator, removeTimerCollaborator, unshareTimer, listSharedTimers } = require('./utils/teamService');
const { getTeamUsageSummary, getTeamTimerHistory, getActiveTimerSnapshots } = require('./utils/analytics');
const { configureSsoProvider, listSsoProviders, deleteSsoProvider, handleSsoAssertion } = require('./utils/sso');
const { createTemplate, listTemplates, deleteTemplate, instantiateTemplate } = require('./utils/templates');
const { createSchedule, listSchedules, updateSchedule, deleteSchedule, getDueSchedules, markScheduleRun, materializeSchedule } = require('./utils/schedules');

let db;

function overrideDb(testDb) {
  db = testDb;
  setDb(db);
  return db;
}

onInit(() => {
  if (!db) {
    admin.initializeApp();
    db = admin.firestore();
    // Set db reference for auth middleware
    setDb(db);
  }
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

app.get('/teams/:teamId/shared-timers', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const timers = await listSharedTimers(teamId);
        res.json({ success: true, timers });
    } catch (error) {
        console.error('List shared timers error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/timers/:timerId/share', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, timerId } = req.params;
    try {
        const result = await shareTimerWithTeam(teamId, timerId, {
            addedBy: req.user.id,
            accessLevel: req.body?.accessLevel,
            collaborators: Array.isArray(req.body?.collaborators) ? req.body.collaborators : [],
        });
        res.json({ success: true, share: result });
    } catch (error) {
        console.error('Share timer error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.patch('/teams/:teamId/timers/:timerId/collaborators/:memberId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, timerId, memberId } = req.params;
    const { role } = req.body || {};
    if (!role) {
        return res.status(400).json({ success: false, error: 'role is required' });
    }
    try {
        const result = await updateTimerCollaborator(teamId, timerId, memberId, role);
        res.json({ success: true, collaborator: result });
    } catch (error) {
        console.error('Update timer collaborator error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/timers/:timerId/collaborators/:memberId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, timerId, memberId } = req.params;
    try {
        await removeTimerCollaborator(teamId, timerId, memberId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove timer collaborator error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/timers/:timerId/share', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, timerId } = req.params;
    try {
        await unshareTimer(teamId, timerId);
        res.json({ success: true });
    } catch (error) {
        console.error('Unshare timer error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/analytics/summary', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const summary = await getTeamUsageSummary(teamId);
        res.json({ success: true, summary });
    } catch (error) {
        console.error('Team usage summary error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/analytics/history', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    const { limit, cursor } = req.query;
    try {
        const history = await getTeamTimerHistory(teamId, {
            limit: limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
            cursor,
        });
        res.json({ success: true, history });
    } catch (error) {
        console.error('Team timer history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/analytics/active', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const timers = await getActiveTimerSnapshots(teamId);
        res.json({ success: true, timers });
    } catch (error) {
        console.error('Active timer snapshots error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/billing/usage', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const record = await recordUsageForTeam(teamId, {
            quantity: req.body?.quantity,
            timestamp: req.body?.timestamp,
            action: req.body?.action,
            description: req.body?.description,
            meter: req.body?.meter,
        });
        res.json({ success: true, record });
    } catch (error) {
        console.error('Record usage error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/billing/invoices', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const invoices = await listInvoicesForTeam(teamId, { limit: req.query.limit ? parseInt(req.query.limit, 10) || 12 : 12 });
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('List invoices error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/billing/payment-methods', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const methods = await listPaymentMethodsForTeam(teamId);
        res.json({ success: true, paymentMethods: methods });
    } catch (error) {
        console.error('List payment methods error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/billing/payment-methods', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    const { paymentMethodId, makeDefault } = req.body || {};
    if (!paymentMethodId) {
        return res.status(400).json({ success: false, error: 'paymentMethodId is required' });
    }
    try {
        const methods = await attachPaymentMethodToTeam(teamId, paymentMethodId, { makeDefault });
        res.json({ success: true, paymentMethods: methods });
    } catch (error) {
        console.error('Attach payment method error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/billing/payment-methods/:paymentMethodId', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId, paymentMethodId } = req.params;
    try {
        const methods = await detachPaymentMethodFromTeam(teamId, paymentMethodId);
        res.json({ success: true, paymentMethods: methods });
    } catch (error) {
        console.error('Detach payment method error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/billing/trial', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const subscription = await startTeamTrial(teamId, { trialDays: req.body?.trialDays });
        res.json({ success: true, subscription });
    } catch (error) {
        console.error('Start trial error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/billing/promotion', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const subscription = await updateTeamPromotion(teamId, { promotionCode: req.body?.promotionCode });
        res.json({ success: true, subscription });
    } catch (error) {
        console.error('Update promotion error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/sso/providers', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const provider = await configureSsoProvider(teamId, req.body || {});
        res.json({ success: true, provider });
    } catch (error) {
        console.error('Configure SSO provider error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/sso/providers', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const providers = await listSsoProviders(teamId);
        res.json({ success: true, providers });
    } catch (error) {
        console.error('List SSO providers error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/sso/providers/:providerId', requireTeamRole((req) => req.params.teamId, ['owner']), async (req, res) => {
    const { teamId, providerId } = req.params;
    try {
        await deleteSsoProvider(teamId, providerId);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete SSO provider error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/sso/:providerId/assert', async (req, res) => {
    const { providerId } = req.params;
    const { teamId, assertion } = req.body || {};
    if (!teamId || !assertion) {
        return res.status(400).json({ success: false, error: 'teamId and assertion are required' });
    }

    try {
        const result = await handleSsoAssertion(teamId, providerId, assertion);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('SSO assertion error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/templates', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const templates = await listTemplates(teamId);
        res.json({ success: true, templates });
    } catch (error) {
        console.error('List templates error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/templates', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const template = await createTemplate(teamId, req.body || {}, req.user.id);
        res.json({ success: true, template });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/templates/:templateId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, templateId } = req.params;
    try {
        await deleteTemplate(teamId, templateId);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete template error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/templates/:templateId/launch', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId, templateId } = req.params;
    try {
        const timerConfig = await instantiateTemplate(teamId, templateId, req.body?.overrides || {});
        const timer = await RealTimer.create({ ...timerConfig, team: teamId, createdBy: req.user.id });
        res.json({ success: true, timer });
    } catch (error) {
        console.error('Launch template timer error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/teams/:teamId/schedules', requireTeamRole((req) => req.params.teamId, ['member', 'admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const schedules = await listSchedules(teamId);
        res.json({ success: true, schedules });
    } catch (error) {
        console.error('List schedules error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/teams/:teamId/schedules', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId } = req.params;
    try {
        const schedule = await createSchedule(teamId, req.body || {}, req.user.id);
        res.json({ success: true, schedule });
    } catch (error) {
        console.error('Create schedule error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.patch('/teams/:teamId/schedules/:scheduleId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, scheduleId } = req.params;
    try {
        const schedule = await updateSchedule(teamId, scheduleId, req.body || {}, req.user.id);
        res.json({ success: true, schedule });
    } catch (error) {
        console.error('Update schedule error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/teams/:teamId/schedules/:scheduleId', requireTeamRole((req) => req.params.teamId, ['admin', 'owner']), async (req, res) => {
    const { teamId, scheduleId } = req.params;
    try {
        await deleteSchedule(teamId, scheduleId);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(400).json({ success: false, error: error.message });
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
    static assignWorker(timerId, teamId) {
        const workers = parseInt(process.env.TIMER_WORKER_COUNT || '5', 10);
        const key = `${teamId || ''}:${timerId}`;
        let hash = 0;
        for (let i = 0; i < key.length; i += 1) {
            hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
        }
        if (!Number.isFinite(workers) || workers <= 0) {
            return 'worker-0';
        }
        return `worker-${hash % workers}`;
    }

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
    
    static evaluateConditions(conditions = [], context = {}, metadata = {}) {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            return true;
        }

        const roots = { context, metadata };
        const resolvePath = (path) => {
            if (!path) return undefined;
            const segments = path.split('.');
            const [first, ...rest] = segments;
            if (roots[first] !== undefined) {
                return rest.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), roots[first]);
            }
            if (context[path] !== undefined) {
                return context[path];
            }
            if (metadata[path] !== undefined) {
                return metadata[path];
            }
            return segments.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), context);
        };

        return conditions.every((condition) => {
            const lhs = condition.lhsValue !== undefined ? condition.lhsValue : resolvePath(condition.lhs || '');
            const rhs = condition.rhsValue !== undefined ? condition.rhsValue : condition.rhs;
            const operator = (condition.operator || 'equals').toLowerCase();

            switch (operator) {
                case 'equals':
                    return lhs === rhs;
                case 'not_equals':
                    return lhs !== rhs;
                case 'gt':
                    return lhs > rhs;
                case 'gte':
                    return lhs >= rhs;
                case 'lt':
                    return lhs < rhs;
                case 'lte':
                    return lhs <= rhs;
                case 'exists':
                    return lhs !== undefined && lhs !== null;
                case 'not_exists':
                    return lhs === undefined || lhs === null;
                default:
                    return false;
            }
        });
    }

    static computeRetryDelay(policy = {}, attempt) {
        const base = policy.backoffMs || 1000;
        if (policy.strategy === 'exponential') {
            return base * Math.pow(2, attempt - 1);
        }
        if (policy.strategy === 'linear') {
            return base * attempt;
        }
        return base;
    }

    static async recordPerformance(timer, metrics = {}) {
        if (!timer.team) {
            return;
        }
        await db.collection('teams').doc(timer.team).collection('metrics').add({
            timerId: timer.id,
            event: metrics.event || 'expiration',
            driftMs: metrics.driftMs || 0,
            webhookLatencyMs: metrics.webhookLatencyMs || null,
            success: metrics.success !== undefined ? metrics.success : true,
            attempt: metrics.attempt || timer.retryCount || 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    static snapshotTimer(timerData = {}) {
        return {
            id: timerData.id,
            name: timerData.name,
            duration: timerData.duration,
            metadata: { ...(timerData.metadata || {}) },
            context: { ...(timerData.context || {}) },
            events: { ...(timerData.events || {}) },
            dependencies: Array.isArray(timerData.dependencies) ? timerData.dependencies.slice() : [],
            retryPolicy: timerData.retryPolicy || null,
            team: timerData.team || null,
            agentId: timerData.agentId || timerData.agent_id || null,
            templateId: timerData.templateId || null,
            chainId: timerData.chainId || null,
            loadBalancingKey: timerData.loadBalancingKey || null,
        };
    }

    static buildReplayPayload(snapshot = {}, options = {}) {
        const includeReplayMetadata = options.includeReplayMetadata !== false;
        const baseMetadata = snapshot.metadata ? { ...snapshot.metadata } : {};
        const overrideMetadata = options.metadata ? { ...options.metadata } : {};
        const metadata = { ...baseMetadata, ...overrideMetadata };
        const replayOf = options.replayOf || snapshot.id || snapshot.timerId;
        if (includeReplayMetadata && replayOf) {
            metadata.replayOf = replayOf;
            metadata.replayReason = options.reason || 'manual';
        }

        const payload = {
            name: options.name || snapshot.name || `replay_${replayOf || Date.now()}`,
            duration: options.duration || snapshot.duration,
            metadata,
            context: { ...(snapshot.context || {}), ...(options.context || {}) },
            events: options.events ? { ...options.events } : { ...(snapshot.events || {}) },
            dependencies: Array.isArray(options.dependencies)
                ? options.dependencies.filter(Boolean)
                : [],
            retryPolicy: options.retryPolicy || snapshot.retryPolicy || null,
            team: options.team !== undefined ? options.team : snapshot.team || null,
            agent_id: options.agentId || snapshot.agentId || null,
            templateId: options.templateId || snapshot.templateId || null,
            chainId: options.chainId || snapshot.chainId || null,
            loadBalancingKey: options.loadBalancingKey || snapshot.loadBalancingKey || null,
        };

        if (!payload.duration) {
            throw new Error('Timer duration missing for replay payload');
        }

        if (payload.dependencies.length === 0) {
            delete payload.dependencies;
        }
        if (!payload.retryPolicy) {
            delete payload.retryPolicy;
        }
        if (!payload.team) {
            delete payload.team;
        }
        if (!payload.agent_id) {
            delete payload.agent_id;
        }
        if (!payload.templateId) {
            delete payload.templateId;
        }
        if (!payload.chainId) {
            delete payload.chainId;
        }
        if (!payload.loadBalancingKey) {
            delete payload.loadBalancingKey;
        }

        return payload;
    }

    static async enqueueReplay(timerSnapshot, metadata = {}) {
        if (!timerSnapshot || !timerSnapshot.id) {
            throw new Error('timerSnapshot with id is required to enqueue replay');
        }

        const pendingSnapshot = await db
            .collection('timer_replay_queue')
            .where('timerId', '==', timerSnapshot.id)
            .where('status', '==', 'pending')
            .get();

        if (pendingSnapshot && pendingSnapshot.size > 0) {
            return null;
        }

        const snapshot = this.snapshotTimer(timerSnapshot);
        snapshot.id = timerSnapshot.id;

        const entry = {
            timerId: timerSnapshot.id,
            team: timerSnapshot.team || null,
            status: 'pending',
            reason: metadata.reason || 'failure',
            attempts: metadata.attempts || timerSnapshot.retryCount || 0,
            payload: snapshot,
            enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
            enqueuedAtMs: Date.now(),
            lastFailure: metadata.failure || null,
            triggeredBy: metadata.triggeredBy || null,
            requestedBy: metadata.requestedBy || null,
        };

        await db.collection('timer_replay_queue').add(entry);
        return entry;
    }

    static async replay(timerId, options = {}) {
        const reason = options.reason || 'manual';
        const requestedBy = options.requestedBy || null;

        let snapshot = null;
        if (options.payload) {
            snapshot = this.snapshotTimer({ id: options.payload.id || timerId, ...options.payload });
        } else {
            const timerDoc = await db.collection('timers').doc(timerId).get();
            if (!timerDoc.exists) {
                throw new Error('Timer not found for replay');
            }
            snapshot = this.snapshotTimer({ id: timerId, ...timerDoc.data() });
        }

        const payload = this.buildReplayPayload(snapshot, {
            ...options,
            reason,
            replayOf: timerId,
            includeReplayMetadata: options.includeReplayMetadata !== false,
        });

        const replayTimer = await this.create(payload);

        await db.collection('timer_replays').add({
            sourceTimerId: timerId,
            replayTimerId: replayTimer.id,
            reason,
            requestedBy,
            queueEntryId: options.queueEntryId || null,
            team: replayTimer.team || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtMs: Date.now(),
        });

        return replayTimer;
    }

    static async processReplayQueue({ limit = 25 } = {}) {
        const snapshot = await db
            .collection('timer_replay_queue')
            .where('status', '==', 'pending')
            .orderBy('enqueuedAt')
            .limit(limit)
            .get();

        if (!snapshot || snapshot.empty) {
            return [];
        }

        const processed = [];
        for (const doc of snapshot.docs) {
            const entry = doc.data();
            try {
                await doc.ref.set({
                    status: 'processing',
                    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastAttemptAtMs: Date.now(),
                }, { merge: true });

                const replayTimer = await this.replay(entry.timerId, {
                    payload: entry.payload,
                    reason: entry.reason || 'queue',
                    requestedBy: entry.requestedBy || entry.triggeredBy || null,
                    queueEntryId: doc.id,
                });

                await doc.ref.set({
                    status: 'processed',
                    replayTimerId: replayTimer.id,
                    processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    processedAtMs: Date.now(),
                }, { merge: true });

                processed.push({ queueEntryId: doc.id, replayTimerId: replayTimer.id });
            } catch (error) {
                await doc.ref.set({
                    status: 'error',
                    lastError: error.message,
                    errorCount: (entry.errorCount || 0) + 1,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAtMs: Date.now(),
                }, { merge: true });
            }
        }

        return processed;
    }

    static async cleanupReplayQueue({ olderThanMs = 7 * 24 * 60 * 60 * 1000, maxBatchSize = 200 } = {}) {
        const cutoff = Date.now() - olderThanMs;
        let purged = 0;

        const statuses = ['processed', 'error'];
        for (const status of statuses) {
            if (purged >= maxBatchSize) {
                break;
            }

            const snapshot = await db
                .collection('timer_replay_queue')
                .where('status', '==', status)
                .get();

            if (!snapshot || snapshot.empty) {
                continue;
            }

            for (const doc of snapshot.docs) {
                if (purged >= maxBatchSize) {
                    break;
                }

                const data = doc.data() || {};
                const completedAt = (data.processedAtMs ?? data.updatedAtMs ?? data.enqueuedAtMs ?? 0);
                if (completedAt !== undefined && completedAt !== null && completedAt < cutoff) {
                    await doc.ref.delete();
                    purged += 1;
                }
            }
        }

        return { purged };
    }

    static async activatePendingTimer(timerRef, timerData) {
        const now = Date.now();
        const duration = timerData.duration || 0;
        const canRun = this.evaluateConditions(timerData.conditions || [], timerData.context || {}, timerData.metadata || {});

        if (!canRun) {
            await timerRef.set({
                status: 'skipped',
                skipReason: 'conditions_not_met',
                pendingDependencies: [],
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            await db.collection('timer_logs').add({
                timerId: timerRef.id,
                event: 'skipped',
                team: timerData.team || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                reason: 'conditions_not_met',
            });
            return;
        }

        const endTime = now + duration;
        await timerRef.set({
            status: 'running',
            startTime: now,
            endTime,
            pendingDependencies: [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await this.scheduleExpiration(timerRef.id, duration, timerData.assignedWorker);
        await db.collection('timer_logs').add({
            timerId: timerRef.id,
            event: 'activated',
            team: timerData.team || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    static async releaseDependents(timerId) {
        const snapshot = await db.collection('timers').where('dependencies', 'array-contains', timerId).get();
        if (snapshot.empty) {
            return;
        }

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const pending = (data.pendingDependencies || data.dependencies || []).filter((dep) => dep !== timerId);
            if (pending.length === 0 && data.status === 'pending') {
                await this.activatePendingTimer(doc.ref, data);
            } else {
                await doc.ref.set({
                    pendingDependencies: pending,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }
    }

    static async create(config) {
        const timerId = config.id || uuidv4();
        const duration = this.parseDuration(config.duration);
        const now = Date.now();

        const dependencies = Array.isArray(config.dependencies) ? Array.from(new Set(config.dependencies.filter(Boolean))) : [];
        const context = config.context || {};
        const rawConditions = config.conditions || [];
        const conditions = Array.isArray(rawConditions)
            ? rawConditions
            : Object.entries(rawConditions).map(([lhs, rhs]) => ({ lhs, rhs }));
        let status = dependencies.length > 0 ? 'pending' : 'running';
        let skipReason = null;

        if (status === 'running' && !this.evaluateConditions(conditions, context, config.metadata || {})) {
            status = 'skipped';
            skipReason = 'conditions_not_met';
        }

        const startTime = status === 'running' ? now : null;
        const endTime = status === 'running' ? now + duration : null;

        const timerData = {
            id: timerId,
            name: config.name || timerId,
            agentId: config.agent_id || 'unknown_agent',
            duration,
            startTime,
            endTime,
            status,
            events: config.events || {},
            metadata: config.metadata || {},
            context,
            conditions,
            dependencies,
            pendingDependencies: dependencies,
            retryPolicy: config.retryPolicy || null,
            retryCount: 0,
            chainId: config.chainId || null,
            templateId: config.templateId || null,
            assignedWorker: this.assignWorker(timerId, config.team),
            skipReason,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Add optional fields only if they exist
        if (config.team) timerData.team = config.team;
        if (config.scenario) timerData.scenario = config.scenario;
        if (config.loadBalancingKey) timerData.loadBalancingKey = config.loadBalancingKey;
        if (config.createdBy) timerData.createdBy = config.createdBy;

        // Store in Firestore
        await db.collection('timers').doc(timerId).set(timerData);

        // Schedule expiration if timer is immediately runnable
        if (status === 'running') {
            await this.scheduleExpiration(timerId, duration, timerData.assignedWorker);
        }

        if (status === 'skipped') {
            await db.collection('timer_logs').add({
                timerId,
                event: 'skipped',
                team: config.team || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                reason: skipReason,
            });
        }

        console.log(`Timer created: ${timerData.name} (${timerId}) - expires in ${duration}ms`);
        return { ...timerData, createdAt: now, updatedAt: now };
    }

    static async scheduleExpiration(timerId, duration, worker) {
        // Use Firestore document with TTL
        const expirationTime = new Date(Date.now() + duration);
        await db.collection('timer_expirations').doc(timerId).set({
            timerId,
            expiresAt: admin.firestore.Timestamp.fromDate(expirationTime),
            status: 'scheduled',
            worker: worker || this.assignWorker(timerId)
        });
    }
    
    static async get(timerId) {
        const doc = await db.collection('timers').doc(timerId).get();
        if (!doc.exists) return null;

        const data = doc.data();
        const startTime = data.startTime || null;
        const endTime = data.endTime || (startTime ? startTime + (data.duration || 0) : null);
        const now = Date.now();
        const elapsed = startTime ? Math.max(0, now - startTime) : 0;
        const duration = data.duration || 0;
        const timeRemaining = endTime ? Math.max(0, endTime - now) : duration;
        const progress = duration > 0 && startTime ? Math.min(1, elapsed / duration) : 0;

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
            const startTime = data.startTime || null;
            const endTime = data.endTime || (startTime ? startTime + (data.duration || 0) : null);
            const now = Date.now();
            const elapsed = startTime ? Math.max(0, now - startTime) : 0;
            const duration = data.duration || 0;
            const timeRemaining = endTime ? Math.max(0, endTime - now) : duration;
            const progress = duration > 0 && startTime ? Math.min(1, elapsed / duration) : 0;
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
        const timerRef = db.collection('timers').doc(timerId);
        const timerDoc = await timerRef.get();
        if (!timerDoc.exists) {
            return null;
        }

        const timerData = timerDoc.data();
        if (!['running', 'retrying'].includes(timerData.status)) {
            return timerData;
        }

        const attempt = (timerData.retryCount || 0) + 1;
        await timerRef.set({
            retryCount: attempt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`Timer expiring: ${timerData.name || timerId} (${timerId}) attempt ${attempt}`);

        let webhookSuccess = true;
        let webhookLatency = null;
        let failureReason = null;
        const startedAt = Date.now();

        if (timerData.events?.on_expire?.webhook) {
            try {
                const response = await fetch(timerData.events.on_expire.webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'timer_expired',
                        timer: { id: timerId, ...timerData },
                        message: timerData.events.on_expire.message,
                        data: timerData.events.on_expire.data
                    })
                });
                webhookLatency = Date.now() - startedAt;
                if (!response.ok) {
                    webhookSuccess = false;
                    failureReason = `Webhook HTTP ${response.status}`;
                    console.error(`Webhook failed with status ${response.status}`);
                }
            } catch (error) {
                webhookSuccess = false;
                failureReason = error.message;
                webhookLatency = Date.now() - startedAt;
                console.error(`Webhook failed: ${error.message}`);
            }
        }

        const retryPolicy = timerData.retryPolicy || {};
        const maxAttempts = retryPolicy.maxAttempts || 0;

        if (!webhookSuccess && attempt < maxAttempts) {
            const delay = this.computeRetryDelay(retryPolicy, attempt + 1);
            const nextEnd = Date.now() + delay;
            await timerRef.set({
                status: 'retrying',
                nextRetryAt: nextEnd,
                endTime: nextEnd,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            await this.scheduleExpiration(timerId, delay, timerData.assignedWorker);
            await db.collection('timer_logs').add({
                timerId,
                event: 'retry_scheduled',
                attempt: attempt + 1,
                timerName: timerData.name,
                agentId: timerData.agentId,
                team: timerData.team,
                delay,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { ...timerData, status: 'retrying', retryCount: attempt };
        }

        const finalStatus = webhookSuccess ? 'expired' : 'failed';
        await timerRef.set({
            status: finalStatus,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            failureReason: webhookSuccess ? null : failureReason,
            nextRetryAt: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        const driftMs = timerData.endTime ? Date.now() - timerData.endTime : 0;
        await this.recordPerformance({ id: timerId, ...timerData, retryCount: attempt }, {
            event: finalStatus,
            driftMs,
            webhookLatencyMs: webhookLatency,
            success: webhookSuccess,
            attempt,
        });

        await db.collection('timer_logs').add({
            timerId,
            event: finalStatus,
            timerName: timerData.name,
            agentId: timerData.agentId,
            team: timerData.team,
            attempt,
            failureReason,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        if (!webhookSuccess) {
            await this.enqueueReplay({ id: timerId, ...timerData }, {
                reason: 'webhook_failed',
                attempts: attempt,
                failure: failureReason,
                triggeredBy: 'expire',
            });
        }

        await this.releaseDependents(timerId);

        return { ...timerData, status: finalStatus, retryCount: attempt };
    }

    static async delete(timerId, { reason = 'api', cascade = true } = {}) {
        const timerRef = db.collection('timers').doc(timerId);
        const timerDoc = await timerRef.get();

        if (!timerDoc.exists) {
            return {
                timerId,
                deleted: false,
                counts: { timers: 0, expirations: 0, logs: 0, metrics: 0, replayEntries: 0 },
            };
        }

        const timerData = timerDoc.data();
        const counts = { timers: 0, expirations: 0, logs: 0, metrics: 0, replayEntries: 0 };

        await this.releaseDependents(timerId);

        await timerRef.delete();
        counts.timers += 1;

        const expirationRef = db.collection('timer_expirations').doc(timerId);
        const expirationDoc = await expirationRef.get();
        if (expirationDoc.exists) {
            await expirationRef.delete();
            counts.expirations += 1;
        }

        if (cascade) {
            const logsSnapshot = await db.collection('timer_logs').where('timerId', '==', timerId).get();
            if (logsSnapshot && !logsSnapshot.empty) {
                for (const logDoc of logsSnapshot.docs) {
                    await logDoc.ref.delete();
                }
                counts.logs += logsSnapshot.size;
            }

            if (timerData.team) {
                const metricsSnapshot = await db
                    .collection('teams')
                    .doc(timerData.team)
                    .collection('metrics')
                    .where('timerId', '==', timerId)
                    .get();

                if (metricsSnapshot && !metricsSnapshot.empty) {
                    for (const metricDoc of metricsSnapshot.docs) {
                        await metricDoc.ref.delete();
                    }
                    counts.metrics += metricsSnapshot.size;
                }
            }

            const queueSnapshot = await db
                .collection('timer_replay_queue')
                .where('timerId', '==', timerId)
                .get();

            if (queueSnapshot && !queueSnapshot.empty) {
                for (const queueDoc of queueSnapshot.docs) {
                    await queueDoc.ref.delete();
                }
                counts.replayEntries += queueSnapshot.size;
            }
        }

        await db.collection('timer_deletion_metrics').add({
            timerId,
            team: timerData.team || null,
            counts,
            reason,
            triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
            triggeredAtMs: Date.now(),
        });

        console.log(`Timer deleted: ${timerId}`);

        return {
            timerId,
            deleted: true,
            counts,
            team: timerData.team || null,
        };
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
        const deletion = await RealTimer.delete(req.params.id, { reason: 'api' });
        res.json({ success: true, deleted: deletion.deleted, cascade: deletion.counts });
    } catch (error) {
        console.error('Delete timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/timers/:id/replay', async (req, res) => {
    try {
        const timer = await RealTimer.get(req.params.id);
        if (!timer) {
            return res.status(404).json({ success: false, error: 'Timer not found' });
        }
        if (timer.team && !hasTeamRole(req.user, timer.team, ['admin', 'owner'])) {
            return res.status(403).json({ success: false, error: 'You do not have permission to replay this timer.' });
        }
        if (!timer.team && timer.agentId && timer.agentId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'You do not have permission to replay this timer.' });
        }

        const replayOptions = {
            reason: req.body?.reason || 'manual',
            metadata: req.body?.metadata,
            context: req.body?.context,
            duration: req.body?.duration,
            events: req.body?.events,
            dependencies: Array.isArray(req.body?.dependencies) ? req.body.dependencies : undefined,
            retryPolicy: req.body?.retryPolicy,
            team: req.body?.team,
            agentId: req.body?.agentId,
        };

        const replayTimer = await RealTimer.replay(req.params.id, replayOptions);
        res.status(201).json({ success: true, replay: replayTimer });
    } catch (error) {
        console.error('Replay timer error:', error);
        res.status(400).json({ success: false, error: error.message });
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
            .where('status', 'in', ['running', 'retrying'])
            .where('endTime', '<=', now)
            .limit(200)
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

exports.runScheduledTimers = onSchedule('every 1 minutes', async (event) => {
        const due = await getDueSchedules(25);
        if (due.length === 0) {
            return null;
        }

        console.log(`Processing ${due.length} scheduled timers`);

        for (const scheduleDoc of due) {
            const scheduleData = scheduleDoc.data();
            try {
                const baseConfig = await materializeSchedule(scheduleDoc);
                const timerConfig = {
                    ...baseConfig,
                    team: baseConfig.team || scheduleData.teamId,
                    createdBy: scheduleData.updatedBy || scheduleData.createdBy || 'schedule',
                };
                await RealTimer.create(timerConfig);
                await markScheduleRun(scheduleDoc);
            } catch (error) {
                console.error('Failed to process schedule', scheduleDoc.id, error);
                await scheduleDoc.ref.set({
                    lastError: error.message,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
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

exports.parseratorReplaySweep = onSchedule('every 5 minutes', async () => {
        const processed = await RealTimer.processReplayQueue({ limit: 50 });
        if (processed.length > 0) {
            console.log(`Processed ${processed.length} replay queue entries`);
        }
        return null;
    });

exports.parseratorReplayHousekeeping = onSchedule('every 6 hours', async () => {
        const result = await RealTimer.cleanupReplayQueue({ olderThanMs: 3 * 24 * 60 * 60 * 1000 });
        if (result.purged > 0) {
            console.log(`Removed ${result.purged} stale replay queue entries`);
        }
        return null;
    });

exports.api = onRequest(app);

exports.__testHooks = {
    overrideDb,
    getDb: () => db,
    RealTimer,
    admin,
};