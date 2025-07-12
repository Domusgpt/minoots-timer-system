#!/usr/bin/env node

/**
 * Background Timer Process - ID: timer_1752356841335_e9ana2pk1
 * This script runs independently and executes timer actions
 */

const fs = require('fs');
const path = require('path');

const timerData = {
  "id": "timer_1752356841335_e9ana2pk1",
  "name": "firebase_domain_quick_retry",
  "agentId": "cli_agent",
  "duration": 600000,
  "startTime": 1752356841335,
  "endTime": 1752357441335,
  "status": "running",
  "events": {
    "on_expire": {
      "message": "Timer firebase_domain_quick_retry completed after 10m",
      "file_write": {
        "file": "timer_firebase_domain_quick_retry_complete.txt",
        "content": "Independent timer firebase_domain_quick_retry completed at 2025-07-12T21:47:21.335Z"
      }
    }
  },
  "metadata": {},
  "createdAt": "2025-07-12T21:47:21.335Z"
};
const timerFile = '/mnt/c/Users/millz/minoots-real/active_timers/timer_1752356841335_e9ana2pk1.json';
const logFile = '/mnt/c/Users/millz/minoots-real/active_timers/timer_1752356841335_e9ana2pk1_log.txt';

function log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logEntry);
    console.log(`[${timestamp}] ${message}`);
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
    log(`Executing action: ${action.type || 'unknown'}`);
    
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
                log(`Webhook called: ${action.url} (Status: ${response.status})`);
            } catch (error) {
                log(`Webhook failed: ${error.message}`);
            }
            break;
            
        case 'file_write':
            try {
                const outputFile = action.file || `timer_${timer.id}_output.txt`;
                const content = action.content || `Timer ${timer.name} completed at ${new Date().toISOString()}`;
                fs.writeFileSync(outputFile, content);
                log(`File written: ${outputFile}`);
            } catch (error) {
                log(`File write failed: ${error.message}`);
            }
            break;
            
        case 'command':
            try {
                const { execSync } = require('child_process');
                const result = execSync(action.command, { encoding: 'utf8' });
                log(`Command executed: ${action.command}`);
                log(`Command output: ${result.trim()}`);
            } catch (error) {
                log(`Command failed: ${error.message}`);
            }
            break;
            
        default:
            log(`Unknown action type: ${action.type}`);
    }
}

async function main() {
    log(`Background timer started: ${timerData.name}`);
    log(`Duration: ${timerData.duration}ms`);
    log(`Expected expiration: ${new Date(timerData.endTime).toISOString()}`);
    
    const waitTime = timerData.endTime - Date.now();
    
    if (waitTime <= 0) {
        log('Timer already expired, executing immediately');
        await expireTimer();
        return;
    }
    
    log(`Waiting ${Math.round(waitTime / 1000)} seconds for timer expiration...`);
    
    // Wait for the timer to expire
    setTimeout(async () => {
        await expireTimer();
    }, waitTime);
}

async function expireTimer() {
    log(`Timer expired: ${timerData.name}`);
    
    // Update status
    const expiredTimer = updateTimerStatus('expired', {
        actualEndTime: Date.now()
    });
    
    // Execute events
    if (timerData.events.on_expire) {
        log('Executing expiration events...');
        
        if (timerData.events.on_expire.message) {
            log(`Expiration message: ${timerData.events.on_expire.message}`);
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
        log(`Script cleanup failed: ${error.message}`);
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
    log(`Timer error: ${error.message}`);
    updateTimerStatus('error', {
        error: error.message,
        errorAt: Date.now()
    });
    process.exit(1);
});
