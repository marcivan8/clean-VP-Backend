const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

async function testParseIntent() {
    console.log('\n--- Testing Parse Intent ---');
    try {
        const response = await fetch(`${BASE_URL}/api/ai/parse-intent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'Cut the video at 10 seconds',
                context: {
                    clips: [{ id: 'clip1', trackId: 'video1', start: 0, duration: 60, isActive: true }]
                }
            })
        });
        const data = await response.json();
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(data, null, 2));
        return data;
    } catch (e) {
        console.error('Error:', e.message);
        return null;
    }
}

async function testGeneratePlan(intent) {
    if (!intent) {
        console.log('\n--- Skipping Generate Plan (No Intent) ---');
        return;
    }
    console.log('\n--- Testing Generate Plan ---');
    try {
        const response = await fetch(`${BASE_URL}/api/ai/generate-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                intent: intent,
                context: {
                    clips: [{ id: 'clip1', trackId: 'video1', start: 0, duration: 60, isActive: true }]
                }
            })
        });
        const data = await response.json();
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

async function testAgentPlan() {
    console.log('\n--- Testing Agent Plan (One-Shot) ---');
    try {
        const response = await fetch(`${BASE_URL}/api/ai/agent-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'Remove silence from the video',
                context: 'Timeline has 1 clip of 60s.',
                tools: [] // Mock tools or minimal definition
            })
        });
        const data = await response.json();
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

async function run() {
    console.log('🧪 ==========================================');
    console.log('🧪 INITIALIZING AI PIPELINE CLI TEST');
    console.log('🧪 ==========================================\n');
    
    console.log('➡️ STEP 1: Testing Intent Parser...');
    const intent = await testParseIntent();
    if (!intent) {
        console.error('❌ Intent parsing failed. Aborting pipeline test.');
        return;
    }
    
    console.log('\n➡️ STEP 2: Testing Edit Planner...');
    await testGeneratePlan(intent);
    
    console.log('\n➡️ STEP 3: Testing End-to-End Orchestrator API...');
    await testAgentPlan();
    
    console.log('\n✅ AI PIPELINE TEST COMPLETE.');
}

run();
