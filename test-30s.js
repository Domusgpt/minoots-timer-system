#!/usr/bin/env node

/**
 * Test a real 30-second timer - no bullshit
 */

const SimpleTimer = require('./test-simple');

async function test30SecondTimer() {
    console.log('🕰️ TESTING 30-SECOND TIMER - REAL TIME\n');
    
    const startTime = new Date();
    console.log(`🚀 Starting timer at: ${startTime.toLocaleTimeString()}`);
    
    // Create 30-second timer
    const timer = SimpleTimer.create({
        name: 'test_30_second_timer',
        duration: '30s',
        agent_id: 'claude_test',
        metadata: {
            test: true,
            start_time: startTime.toISOString()
        },
        events: {
            on_expire: {
                message: '30 seconds complete! Timer worked perfectly.',
                webhook: 'https://example.com/timer-done'
            }
        }
    });
    
    console.log(`\n⏱️ Timer ID: ${timer.id}`);
    console.log(`📅 Will expire at: ${new Date(timer.endTime).toLocaleTimeString()}\n`);
    
    // Show countdown every 5 seconds
    const countdownInterval = setInterval(() => {
        const currentTimer = SimpleTimer.get(timer.id);
        if (!currentTimer) return;
        
        if (currentTimer.status === 'running') {
            const remainingSeconds = Math.ceil(currentTimer.timeRemaining / 1000);
            const elapsedSeconds = Math.floor((Date.now() - currentTimer.startTime) / 1000);
            const progress = Math.round(currentTimer.progress * 100);
            
            console.log(`⏳ ${remainingSeconds}s remaining | ${elapsedSeconds}s elapsed | ${progress}% complete`);
        } else {
            console.log(`🎉 Timer finished! Status: ${currentTimer.status}`);
            const endTime = new Date();
            const actualDuration = (endTime - startTime) / 1000;
            console.log(`⏰ Actual duration: ${actualDuration.toFixed(1)} seconds`);
            clearInterval(countdownInterval);
        }
    }, 5000);
    
    // Also show final second countdown
    setTimeout(() => {
        console.log('\n🔥 Final countdown:');
        const finalInterval = setInterval(() => {
            const currentTimer = SimpleTimer.get(timer.id);
            if (!currentTimer || currentTimer.status !== 'running') {
                clearInterval(finalInterval);
                return;
            }
            
            const remainingSeconds = Math.ceil(currentTimer.timeRemaining / 1000);
            if (remainingSeconds <= 5) {
                console.log(`⏰ ${remainingSeconds}...`);
            }
        }, 1000);
    }, 25000); // Start final countdown at 25 seconds
}

if (require.main === module) {
    test30SecondTimer();
}