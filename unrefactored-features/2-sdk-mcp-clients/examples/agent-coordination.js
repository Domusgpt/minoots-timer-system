/**
 * MINOOTS SDK - Agent Coordination Examples
 * Advanced patterns for autonomous agents working together
 */

const MinootsSDK = require('../minoots-sdk.js');

async function agentCoordinationDemo() {
    console.log('🤖 MINOOTS Agent Coordination Demo\n');

    // Create multiple agent instances
    const agentA = new MinootsSDK({ 
        agentId: 'coordination_agent_a',
        team: 'coordination_demo'
    });
    
    const agentB = new MinootsSDK({ 
        agentId: 'coordination_agent_b',
        team: 'coordination_demo'
    });

    const coordinator = new MinootsSDK({ 
        agentId: 'coordinator_agent',
        team: 'coordination_demo'
    });

    try {
        console.log('🎯 Scenario: Multi-agent task coordination with timers\n');

        // 1. Coordinator sets up the workflow
        console.log('1. Coordinator: Setting up workflow');
        await coordinator.broadcastToTeam('coordination_demo', 'Starting multi-agent coordination demo');

        // 2. Agent A starts a task with a timer
        console.log('2. Agent A: Starting data processing task (30s)');
        const taskA = await agentA.createTimerWithWebhook({
            name: 'data_processing_task',
            duration: '30s',
            webhook: 'https://httpbin.org/post',
            message: 'Agent A: Data processing complete',
            data: { 
                agent: 'coordination_agent_a',
                task: 'data_processing',
                completion_time: new Date().toISOString()
            }
        });

        // 3. Agent B waits for Agent A, then starts its task
        console.log('3. Agent B: Waiting for signal to start (5s delay)');
        const waitTimer = await agentB.quickWait('5s', {
            name: 'wait_for_agent_a'
        });

        // Simulate Agent B starting after the wait
        setTimeout(async () => {
            console.log('4. Agent B: Starting analysis task (20s)');
            const taskB = await agentB.createTimerWithWebhook({
                name: 'analysis_task',
                duration: '20s',
                webhook: 'https://httpbin.org/post',
                message: 'Agent B: Analysis complete',
                data: { 
                    agent: 'coordination_agent_b',
                    task: 'analysis',
                    depends_on: taskA.timer.id
                }
            });

            // 5. Coordinator monitors both tasks
            console.log('5. Coordinator: Monitoring team progress...\n');
            
            let monitoring = true;
            const monitorInterval = setInterval(async () => {
                try {
                    // Get all team timers
                    const teamTimers = await coordinator.listTimers({ team: 'coordination_demo' });
                    
                    if (teamTimers.success && teamTimers.timers.length > 0) {
                        console.log('📊 Team Status Update:');
                        teamTimers.timers.forEach(timer => {
                            if (timer.status === 'running') {
                                const progress = Math.round(timer.progress * 100);
                                const remaining = coordinator.formatTimeRemaining(timer.timeRemaining);
                                console.log(`   ${timer.name}: ${progress}% complete (${remaining} remaining)`);
                            } else {
                                console.log(`   ${timer.name}: ${timer.status}`);
                            }
                        });
                        console.log();

                        // Check if all tasks are complete
                        const activeTasks = teamTimers.timers.filter(t => t.status === 'running');
                        if (activeTasks.length === 0) {
                            console.log('🎉 All coordination tasks completed!');
                            clearInterval(monitorInterval);
                            monitoring = false;

                            // Final team broadcast
                            await coordinator.broadcastToTeam('coordination_demo', 
                                'Multi-agent coordination demo completed successfully!', 
                                { 
                                    total_tasks: teamTimers.count,
                                    completion_time: new Date().toISOString()
                                }
                            );
                        }
                    }
                } catch (error) {
                    console.error('Monitor error:', error.message);
                    clearInterval(monitorInterval);
                    monitoring = false;
                }
            }, 3000);

            // Safety timeout
            setTimeout(() => {
                if (monitoring) {
                    clearInterval(monitorInterval);
                    console.log('⏰ Monitoring timeout reached');
                }
            }, 60000); // 1 minute max

        }, 6000); // Start Agent B after 6 seconds

        // 6. Create a recurring health check
        console.log('6. Coordinator: Setting up recurring health check (every 15s)');
        const healthCheck = await coordinator.createTimerWithWebhook({
            name: 'team_health_check',
            duration: '15s',
            webhook: 'https://httpbin.org/post',
            message: 'Team health check ping',
            data: { 
                type: 'health_check',
                team: 'coordination_demo',
                check_interval: '15s'
            }
        });

        console.log('✅ Coordination workflow initiated!\n');
        console.log('👀 Watch the progress updates above...\n');

    } catch (error) {
        console.error('❌ Coordination Demo Error:', error.message);
    }
}

// Advanced pattern: Timer-based state machine
async function timerStateMachine() {
    console.log('\n🔄 Timer-Based State Machine Demo\n');

    const stateMachine = new MinootsSDK({
        agentId: 'state_machine_agent',
        team: 'state_demo'
    });

    const states = [
        { name: 'initialization', duration: '3s' },
        { name: 'data_collection', duration: '8s' },
        { name: 'processing', duration: '12s' },
        { name: 'validation', duration: '5s' },
        { name: 'completion', duration: '2s' }
    ];

    try {
        console.log('🎬 Starting state machine with timer-driven transitions...\n');

        for (let i = 0; i < states.length; i++) {
            const state = states[i];
            const isLast = i === states.length - 1;
            
            console.log(`State ${i + 1}/${states.length}: ${state.name} (${state.duration})`);
            
            const stateTimer = await stateMachine.createTimer({
                name: `state_${state.name}`,
                duration: state.duration,
                metadata: {
                    state_machine: true,
                    state_index: i,
                    state_name: state.name,
                    next_state: isLast ? 'COMPLETE' : states[i + 1].name
                }
            });

            if (stateTimer.success) {
                // Wait for state to complete
                await stateMachine.waitFor(state.duration);
                console.log(`✅ State ${state.name} completed`);
                
                if (!isLast) {
                    console.log(`   → Transitioning to ${states[i + 1].name}...`);
                }
            }
        }

        console.log('\n🎉 State machine completed all transitions!');

    } catch (error) {
        console.error('❌ State Machine Error:', error.message);
    }
}

// Run demos if called directly
if (require.main === module) {
    async function runAllDemos() {
        await agentCoordinationDemo();
        
        // Wait a bit before starting state machine
        console.log('\n⏳ Starting state machine demo in 3 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await timerStateMachine();
        
        console.log('\n✅ All coordination demos completed!');
    }

    runAllDemos().catch(error => {
        console.error('❌ Demo failed:', error.message);
        process.exit(1);
    });
}

module.exports = { agentCoordinationDemo, timerStateMachine };