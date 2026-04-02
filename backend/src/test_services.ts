
import { SchedulerService } from './services/scheduler';
import { PlatformIntelligenceEngine } from './services/ipeEngine';
import { SocialListeningEngine } from './services/socialListening';

async function testServices() {
    console.log('--- STARTING SERVICE INTEGRATION TEST ---');

    try {
        // 1. Test Platform Intelligence
        console.log('\n[TEST] Running Platform Intelligence...');
        const ipe = new PlatformIntelligenceEngine();
        const ipeResult = await ipe.runCycle();
        console.log('Platform Result:', ipeResult ? 'Success (Data Found)' : 'Success (No New Data)');

        // 2. Test Social Listening
        console.log('\n[TEST] Running Social Listening...');
        const social = new SocialListeningEngine();
        const socialResult: any = await social.runCycle();
        console.log('Social Result:', socialResult?.conversations?.length ? `${socialResult.conversations.length} items` : 'No items (Check API Keys)');

        // 3. Test Scheduler Init
        console.log('\n[TEST] Initializing Scheduler...');
        const scheduler = new SchedulerService();
        console.log('Scheduler initialized successfully.');

        console.log('\n--- TEST COMPLETED SUCCESSFULLY ---');
        process.exit(0);
    } catch (e) {
        console.error('\n[ERROR] Test Failed:', e);
        process.exit(1);
    }
}

testServices();
