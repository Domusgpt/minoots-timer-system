const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

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
            team: config.team,
            duration,
            startTime: now,
            endTime: now + duration,
            status: 'running',
            events: config.events || {},
            metadata: config.metadata || {},
            scenario: config.scenario,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
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
                const fetch = (await import('node-fetch')).default;
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
app.post('/timers', async (req, res) => {
    try {
        const timer = await RealTimer.create(req.body);
        res.status(201).json({ success: true, timer });
    } catch (error) {
        console.error('Create timer error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/timers', async (req, res) => {
    try {
        const timers = await RealTimer.list(req.query);
        res.json({ success: true, timers, count: timers.length });
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
        res.json({ success: true, timer });
    } catch (error) {
        console.error('Get timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/timers/:id', async (req, res) => {
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

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        service: 'MINOOTS Real Firebase Functions'
    });
});

// Real timer expiration checker
exports.checkExpiredTimers = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
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
exports.cleanupTimers = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
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

exports.api = functions.https.onRequest(app);