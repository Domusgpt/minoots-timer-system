/**
 * MINOOTS SDK - Basic Usage Examples
 * Demonstrates all core functionality with live API
 */

const MinootsSDK = require('../minoots-sdk.js');

async function runExamples() {
    console.log('🚀 MINOOTS SDK Examples - Live API Integration\n');

    // Initialize SDK
    const minoots = new MinootsSDK({
        agentId: 'example_agent',
        team: 'sdk_demo_team'
    });

    try {
        // 1. Health Check
        console.log('1. Health Check');
        console.log('================');
        const health = await minoots.health();
        console.log('✅ API Status:', health.status);
        console.log('📡 Service:', health.service);
        console.log();

        // 2. Create Basic Timer
        console.log('2. Create Basic Timer');
        console.log('=====================');
        const basicTimer = await minoots.createTimer({
            name: 'sdk_demo_timer',
            duration: '15s',
            metadata: { example: 'basic_timer_demo' }
        });
        
        if (basicTimer.success) {
            console.log('✅ Timer Created:', basicTimer.timer.name);
            console.log('🆔 Timer ID:', basicTimer.timer.id);
            console.log('⏱️  Duration:', minoots.formatTimeRemaining(basicTimer.timer.duration));
            console.log();
        }

        // 3. Create Timer with Webhook
        console.log('3. Create Timer with Webhook');
        console.log('=============================');
        const webhookTimer = await minoots.createTimerWithWebhook({
            name: 'webhook_demo',
            duration: '10s',
            webhook: 'https://httpbin.org/post',
            message: 'SDK webhook test completed!',
            data: { source: 'minoots_sdk', demo: true }
        });

        if (webhookTimer.success) {
            console.log('✅ Webhook Timer Created:', webhookTimer.timer.name);
            console.log('🪝 Webhook URL: https://httpbin.org/post');
            console.log();
        }

        // 4. Quick Wait Timer
        console.log('4. Quick Wait Timer');
        console.log('===================');
        const quickTimer = await minoots.quickWait('5s', {
            name: 'quick_demo'
        });

        if (quickTimer.success) {
            console.log('✅ Quick Timer:', quickTimer.timer.name);
            console.log('⚡ Type: Quick Wait');
            console.log();
        }

        // 5. List All Timers
        console.log('5. List All Timers');
        console.log('==================');
        const allTimers = await minoots.listTimers();
        
        if (allTimers.success) {
            console.log(`✅ Found ${allTimers.count} timers:`);
            allTimers.timers.forEach(timer => {
                console.log(`   • ${timer.name} (${timer.id.substring(0, 8)}...) - ${timer.status}`);
                console.log(`     Time Remaining: ${minoots.formatTimeRemaining(timer.timeRemaining)}`);
                console.log(`     Progress: ${Math.round(timer.progress * 100)}%`);
            });
            console.log();
        }

        // 6. Team Broadcast
        console.log('6. Team Broadcast');
        console.log('=================');
        const broadcast = await minoots.broadcastToTeam('sdk_demo_team', 'SDK demo completed successfully!', {
            demo: true,
            timestamp: new Date().toISOString()
        });

        if (broadcast.success) {
            console.log('✅ Broadcast sent to team:', broadcast.broadcast.team);
            console.log('📢 Message:', broadcast.broadcast.message);
            console.log();
        }

        // 7. Monitor Timer Progress
        console.log('7. Monitor Timer Progress');
        console.log('=========================');
        if (basicTimer.success) {
            console.log(`Monitoring timer: ${basicTimer.timer.name}`);
            console.log('Progress updates every 2 seconds...\n');

            // Monitor for 10 seconds
            let monitorCount = 0;
            const monitorInterval = setInterval(async () => {
                try {
                    const timerStatus = await minoots.getTimer(basicTimer.timer.id);
                    if (timerStatus.success) {
                        const timer = timerStatus.timer;
                        const progressBar = '█'.repeat(Math.floor(timer.progress * 20)) + 
                                          '░'.repeat(20 - Math.floor(timer.progress * 20));
                        
                        console.log(`[${progressBar}] ${Math.round(timer.progress * 100)}% - ${minoots.formatTimeRemaining(timer.timeRemaining)} remaining`);
                        
                        if (timer.status === 'expired' || timer.timeRemaining <= 0) {
                            console.log('🎉 Timer completed!\n');
                            clearInterval(monitorInterval);
                        }
                    }
                } catch (error) {
                    console.log('❌ Monitor error:', error.message);
                    clearInterval(monitorInterval);
                }

                monitorCount++;
                if (monitorCount >= 10) { // Stop after 20 seconds
                    clearInterval(monitorInterval);
                    console.log('⏰ Monitor timeout reached\n');
                }
            }, 2000);
        }

    } catch (error) {
        console.error('❌ SDK Example Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run examples if called directly
if (require.main === module) {
    runExamples().then(() => {
        console.log('✅ All SDK examples completed!');
        console.log('📚 Check the MINOOTS API at: https://api-m3waemr5lq-uc.a.run.app');
    }).catch(error => {
        console.error('❌ Example failed:', error.message);
        process.exit(1);
    });
}

module.exports = { runExamples };