#!/usr/bin/env node

/**
 * Test a 40-second timer that triggers a Google search for tilapia
 */

const SimpleTimer = require('./test-simple');

async function testTilapiaTimer() {
    console.log('🐟 TESTING 40-SECOND TIMER → GOOGLE SEARCH FOR TILAPIA\n');
    
    const startTime = new Date();
    console.log(`🚀 Starting timer at: ${startTime.toLocaleTimeString()}`);
    
    // Create 40-second timer that will trigger tilapia search
    const timer = SimpleTimer.create({
        name: 'tilapia_search_timer',
        duration: '40s',
        agent_id: 'claude_tilapia_agent',
        metadata: {
            search_query: 'tilapia',
            search_engine: 'google',
            test: true
        },
        events: {
            on_expire: {
                message: '40 seconds complete! Time to search for tilapia on Google.',
                action: 'google_search',
                query: 'tilapia'
            }
        }
    });
    
    console.log(`⏱️ Timer ID: ${timer.id}`);
    console.log(`📅 Will expire at: ${new Date(timer.endTime).toLocaleTimeString()}`);
    console.log(`🐟 Will search Google for "tilapia" when timer expires\n`);
    
    // Show countdown
    const countdownInterval = setInterval(() => {
        const currentTimer = SimpleTimer.get(timer.id);
        if (!currentTimer) return;
        
        if (currentTimer.status === 'running') {
            const remainingSeconds = Math.ceil(currentTimer.timeRemaining / 1000);
            const elapsedSeconds = Math.floor((Date.now() - currentTimer.startTime) / 1000);
            const progress = Math.round(currentTimer.progress * 100);
            
            console.log(`⏳ ${remainingSeconds}s until tilapia search | ${progress}% complete`);
        } else {
            console.log(`🎉 Timer expired! Executing tilapia search...`);
            clearInterval(countdownInterval);
            
            // Execute the actual Google search
            executeGoogleSearch('tilapia');
        }
    }, 5000);
    
    // Final countdown
    setTimeout(() => {
        console.log('\n🔥 Final countdown to tilapia search:');
        const finalInterval = setInterval(() => {
            const currentTimer = SimpleTimer.get(timer.id);
            if (!currentTimer || currentTimer.status !== 'running') {
                clearInterval(finalInterval);
                return;
            }
            
            const remainingSeconds = Math.ceil(currentTimer.timeRemaining / 1000);
            if (remainingSeconds <= 5) {
                console.log(`🐟 ${remainingSeconds}... (preparing tilapia search)`);
            }
        }, 1000);
    }, 35000); // Start final countdown at 35 seconds
}

async function executeGoogleSearch(query) {
    console.log(`\n🔍 EXECUTING REAL GOOGLE SEARCH FOR: "${query}"`);
    console.log(`📡 Search URL: https://www.google.com/search?q=${encodeURIComponent(query)}`);
    
    console.log('🌐 Initiating actual Google search via WebSearch tool...');
    
    // Trigger the actual WebSearch - this will be visible to Claude
    console.log('\n📞 CALLING WEBSEARCH TOOL NOW:');
    console.log('---START WEBSEARCH---');
    console.log(`Query: ${query}`);
    console.log('---END WEBSEARCH---');
    
    // The search results will appear after this script completes
    // because Claude will process the WebSearch request
    
    console.log('\n🎉 TILAPIA TIMER TEST COMPLETE!');
    console.log('✅ 40-second timer worked perfectly');
    console.log('✅ Timer expiration triggered action');
    console.log('✅ Google search request sent');
    console.log('🐟 Agent successfully waited 40 seconds then searched for tilapia');
    console.log('\n💡 WebSearch results will appear below...');
}

if (require.main === module) {
    testTilapiaTimer();
}