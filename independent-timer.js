#!/usr/bin/env node

/**
 * Independent Timer System - Runs without keeping Claude active
 * Creates background processes that can run for hours/days
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class IndependentTimer {
    constructor() {
        this.timerDir = path.join(__dirname, 'active_timers');
        this.ensureTimerDirectory();
    }
    
    ensureTimerDirectory() {
        if (!fs.existsSync(this.timerDir)) {
            fs.mkdirSync(this.timerDir, { recursive: true });
        }
    }
    
    // Create a timer that runs independently in background
    createTimer(config) {
        const timerId = `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            createdAt: new Date().toISOString()
        };
        
        // Save timer data to file
        const timerFile = path.join(this.timerDir, `${timerId}.json`);
        fs.writeFileSync(timerFile, JSON.stringify(timerData, null, 2));
        
        // Create background process script
        const backgroundScript = this.createBackgroundScript(timerData);
        const scriptFile = path.join(this.timerDir, `${timerId}_script.js`);
        fs.writeFileSync(scriptFile, backgroundScript);
        
        // Launch background process
        const child = spawn('node', [scriptFile], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref(); // Allow parent to exit
        
        console.log(`✅ Independent timer created: ${timerData.name}`);
        console.log(`⏱️ Timer ID: ${timerId}`);
        console.log(`📅 Duration: ${config.duration} (${duration}ms)`);
        console.log(`🕐 Expires at: ${new Date(timerData.endTime).toLocaleString()}`);
        console.log(`🔧 Background process started (PID will be independent)`);
        console.log(`📁 Timer file: ${timerFile}`);
        
        return timerData;
    }
    
    // Create the background script that runs the timer
    createBackgroundScript(timerData) {
        return `#!/usr/bin/env node

/**
 * Background Timer Process - ID: ${timerData.id}
 * This script runs independently and executes timer actions
 */

const fs = require('fs');
const path = require('path');

const timerData = ${JSON.stringify(timerData, null, 2)};
const timerFile = '${path.join(this.timerDir, timerData.id + '.json')}';
const logFile = '${path.join(this.timerDir, timerData.id + '_log.txt')}';

function log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = \`[\${timestamp}] \${message}\\n\`;
    fs.appendFileSync(logFile, logEntry);
    console.log(\`[\${timestamp}] \${message}\`);
}

function updateTimerStatus(status, data = {}) {
    const updatedTimer = {
        ...timerData,
        status,
        ...data,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(timerFile, JSON.stringify(updatedTimer, null, 2));
    return updatedTimer;
}

async function executeAction(action, timer) {
    log(\`Executing action: \${action.type || 'unknown'}\`);
    
    switch (action.type) {
        case 'webhook':
            try {
                const fetch = (await import('node-fetch')).default;
                const response = await fetch(action.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'timer_expired',
                        timer,
                        message: action.message,
                        data: action.data
                    })
                });
                log(\`Webhook called: \${action.url} (Status: \${response.status})\`);
            } catch (error) {
                log(\`Webhook failed: \${error.message}\`);
            }
            break;
            
        case 'file_write':
            try {
                const outputFile = action.file || \`timer_\${timer.id}_output.txt\`;
                const content = action.content || \`Timer \${timer.name} completed at \${new Date().toISOString()}\`;
                fs.writeFileSync(outputFile, content);
                log(\`File written: \${outputFile}\`);
            } catch (error) {
                log(\`File write failed: \${error.message}\`);
            }
            break;
            
        case 'command':
            try {
                const { execSync } = require('child_process');
                const result = execSync(action.command, { encoding: 'utf8' });
                log(\`Command executed: \${action.command}\`);
                log(\`Command output: \${result.trim()}\`);
            } catch (error) {
                log(\`Command failed: \${error.message}\`);
            }
            break;
            
        default:
            log(\`Unknown action type: \${action.type}\`);
    }
}

async function main() {
    log(\`Background timer started: \${timerData.name}\`);
    log(\`Duration: \${timerData.duration}ms\`);
    log(\`Expected expiration: \${new Date(timerData.endTime).toISOString()}\`);
    
    const waitTime = timerData.endTime - Date.now();
    
    if (waitTime <= 0) {
        log('Timer already expired, executing immediately');
        await expireTimer();
        return;
    }
    
    log(\`Waiting \${Math.round(waitTime / 1000)} seconds for timer expiration...\`);
    
    // Wait for the timer to expire
    setTimeout(async () => {
        await expireTimer();
    }, waitTime);
}

async function expireTimer() {
    log(\`Timer expired: \${timerData.name}\`);
    
    // Update status
    const expiredTimer = updateTimerStatus('expired', {
        actualEndTime: Date.now()
    });
    
    // Execute events
    if (timerData.events.on_expire) {
        log('Executing expiration events...');
        
        if (timerData.events.on_expire.message) {
            log(\`Expiration message: \${timerData.events.on_expire.message}\`);
        }
        
        // Execute actions
        for (const [actionKey, actionData] of Object.entries(timerData.events.on_expire)) {
            if (actionKey === 'message') continue;
            
            await executeAction({
                type: actionKey,
                ...actionData
            }, expiredTimer);
        }
    }
    
    log('Timer process completed successfully');
    
    // Clean up script file
    try {
        fs.unlinkSync(__filename);
        log('Background script cleaned up');
    } catch (error) {
        log(\`Script cleanup failed: \${error.message}\`);
    }
}

// Handle process termination
process.on('SIGTERM', () => {
    log('Timer process terminated');
    updateTimerStatus('cancelled', {
        cancelledAt: Date.now(),
        reason: 'process_terminated'
    });
    process.exit(0);
});

process.on('SIGINT', () => {
    log('Timer process interrupted');
    updateTimerStatus('cancelled', {
        cancelledAt: Date.now(),
        reason: 'process_interrupted'
    });
    process.exit(0);
});

// Start the timer
main().catch(error => {
    log(\`Timer error: \${error.message}\`);
    updateTimerStatus('error', {
        error: error.message,
        errorAt: Date.now()
    });
    process.exit(1);
});
`;
    }
    
    parseDuration(duration) {
        if (typeof duration === 'number') return duration;
        const units = { 'ms': 1, 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000 };
        const match = duration.toString().match(/^(\d+)([a-z]+)$/i);
        if (!match) throw new Error(`Invalid duration: ${duration}`);
        const [, value, unit] = match;
        const multiplier = units[unit.toLowerCase()];
        if (!multiplier) throw new Error(`Unknown unit: ${unit}`);
        return parseInt(value) * multiplier;
    }
    
    // List all active timers
    listTimers() {
        const timerFiles = fs.readdirSync(this.timerDir)
            .filter(file => file.endsWith('.json') && !file.endsWith('_log.txt'));
        
        return timerFiles.map(file => {
            try {
                const timerData = JSON.parse(fs.readFileSync(path.join(this.timerDir, file), 'utf8'));
                const now = Date.now();
                const timeRemaining = Math.max(0, timerData.endTime - now);
                const progress = Math.min(1, (now - timerData.startTime) / timerData.duration);
                
                return {
                    ...timerData,
                    timeRemaining,
                    progress,
                    logFile: path.join(this.timerDir, timerData.id + '_log.txt')
                };
            } catch (error) {
                console.error(`Error reading timer file ${file}:`, error.message);
                return null;
            }
        }).filter(Boolean);
    }
    
    // Get timer by ID
    getTimer(timerId) {
        const timerFile = path.join(this.timerDir, `${timerId}.json`);
        if (!fs.existsSync(timerFile)) return null;
        
        try {
            const timerData = JSON.parse(fs.readFileSync(timerFile, 'utf8'));
            const now = Date.now();
            const timeRemaining = Math.max(0, timerData.endTime - now);
            const progress = Math.min(1, (now - timerData.startTime) / timerData.duration);
            
            return {
                ...timerData,
                timeRemaining,
                progress,
                logFile: path.join(this.timerDir, timerId + '_log.txt')
            };
        } catch (error) {
            console.error(`Error reading timer ${timerId}:`, error.message);
            return null;
        }
    }
    
    // Read timer logs
    getTimerLogs(timerId) {
        const logFile = path.join(this.timerDir, `${timerId}_log.txt`);
        if (!fs.existsSync(logFile)) return 'No logs found';
        
        return fs.readFileSync(logFile, 'utf8');
    }
    
    // Cancel a timer
    cancelTimer(timerId) {
        const timerFile = path.join(this.timerDir, `${timerId}.json`);
        if (!fs.existsSync(timerFile)) return false;
        
        try {
            const timerData = JSON.parse(fs.readFileSync(timerFile, 'utf8'));
            timerData.status = 'cancelled';
            timerData.cancelledAt = Date.now();
            fs.writeFileSync(timerFile, JSON.stringify(timerData, null, 2));
            
            console.log(`✅ Timer cancelled: ${timerId}`);
            return true;
        } catch (error) {
            console.error(`Error cancelling timer ${timerId}:`, error.message);
            return false;
        }
    }
    
    // Clean up completed timers
    cleanup() {
        const timers = this.listTimers();
        let cleaned = 0;
        
        for (const timer of timers) {
            if (timer.status === 'expired' || timer.status === 'cancelled') {
                try {
                    // Remove timer file
                    fs.unlinkSync(path.join(this.timerDir, `${timer.id}.json`));
                    
                    // Remove log file if exists
                    const logFile = path.join(this.timerDir, `${timer.id}_log.txt`);
                    if (fs.existsSync(logFile)) {
                        fs.unlinkSync(logFile);
                    }
                    
                    // Remove script file if exists
                    const scriptFile = path.join(this.timerDir, `${timer.id}_script.js`);
                    if (fs.existsSync(scriptFile)) {
                        fs.unlinkSync(scriptFile);
                    }
                    
                    cleaned++;
                } catch (error) {
                    console.error(`Error cleaning timer ${timer.id}:`, error.message);
                }
            }
        }
        
        console.log(`🧹 Cleaned up ${cleaned} completed timer(s)`);
        return cleaned;
    }
}

module.exports = IndependentTimer;

// CLI interface
if (require.main === module) {
    const timer = new IndependentTimer();
    const command = process.argv[2] || 'help';
    
    switch (command) {
        case 'create':
            const duration = process.argv[3] || '60s';
            const name = process.argv[4] || `test_timer_${Date.now()}`;
            timer.createTimer({
                name,
                duration,
                agent_id: 'cli_agent',
                events: {
                    on_expire: {
                        message: `Timer ${name} completed after ${duration}`,
                        file_write: {
                            file: `timer_${name}_complete.txt`,
                            content: `Independent timer ${name} completed at ${new Date().toISOString()}`
                        }
                    }
                }
            });
            break;
            
        case 'list':
            const timers = timer.listTimers();
            console.log(`📋 Found ${timers.length} timer(s):`);
            timers.forEach(t => {
                const remaining = Math.ceil(t.timeRemaining / 1000);
                console.log(`   • ${t.name} (${t.status}) - ${remaining}s remaining`);
            });
            break;
            
        case 'logs':
            const timerId = process.argv[3];
            if (!timerId) {
                console.log('Usage: node independent-timer.js logs <timer_id>');
                break;
            }
            console.log(timer.getTimerLogs(timerId));
            break;
            
        case 'cancel':
            const cancelId = process.argv[3];
            if (!cancelId) {
                console.log('Usage: node independent-timer.js cancel <timer_id>');
                break;
            }
            timer.cancelTimer(cancelId);
            break;
            
        case 'cleanup':
            timer.cleanup();
            break;
            
        default:
            console.log('Independent Timer System');
            console.log('Commands:');
            console.log('  create [duration] [name] - Create a new timer');
            console.log('  list                     - List all timers');
            console.log('  logs <timer_id>         - Show timer logs');
            console.log('  cancel <timer_id>       - Cancel a timer');
            console.log('  cleanup                 - Clean up completed timers');
    }
}