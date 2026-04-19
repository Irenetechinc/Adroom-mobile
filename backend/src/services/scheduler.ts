import cron from 'node-cron';
import dotenv from 'dotenv';
import { PlatformIntelligenceEngine } from './ipeEngine';
import { SocialListeningEngine } from './socialListening';
import { EmotionalIntelligenceEngine } from './emotionalIntelligence';
import { GeoMonitoringEngine } from './geoMonitoring';
import { DecisionEngine } from './decisionEngine';
import { ScraperService } from './scraperService';
import { AgentOrchestrator } from '../agents/agentOrchestrator';
import { getServiceSupabaseClient } from '../config/supabase';
import { creditManagementAgent } from './creditManagementAgent';
import { DailySummaryService } from './dailySummaryService';
import { RadarAgent } from '../agents/radarAgent';

async function hasActiveStrategies(): Promise<boolean> {
    const supabase = getServiceSupabaseClient();
    const { count } = await supabase
        .from('strategies')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('status', 'active');
    return (count ?? 0) > 0;
}

dotenv.config();

const SCHED_IPE_CRON          = process.env.SCHED_IPE_CRON          || '*/15 * * * *';
const SCHED_SOCIAL_CRON       = process.env.SCHED_SOCIAL_CRON       || '*/15 * * * *';
const SCHED_EMOTIONAL_CRON    = process.env.SCHED_EMOTIONAL_CRON    || '*/15 * * * *';
const SCHED_GEO_CRON          = process.env.SCHED_GEO_CRON          || '*/15 * * * *';
const SCHED_SCRAPE_CRON       = process.env.SCHED_SCRAPE_CRON       || '*/30 * * * *';
const SCHED_AGENT_EXEC_CRON   = process.env.SCHED_AGENT_EXEC_CRON   || '*/5 * * * *';   // Execute due tasks every 5 min
const SCHED_AGENT_SPECIAL_CRON= process.env.SCHED_AGENT_SPECIAL_CRON|| '*/10 * * * *';  // Lead scans, perf checks every 10 min
const SCHED_AGENT_MONITOR_CRON= process.env.SCHED_AGENT_MONITOR_CRON|| '0 * * * *';     // Fetch platform metrics hourly
const SCHED_AGENT_OPTIM_CRON  = process.env.SCHED_AGENT_OPTIM_CRON  || '0 */2 * * *';   // Self-optimize every 2 hours
const SCHED_LEAD_FOLLOWUP_CRON= process.env.SCHED_LEAD_FOLLOWUP_CRON|| '*/30 * * * *';  // SALESMAN lead follow-ups every 30 min

const SCHED_RADAR_CRON        = process.env.SCHED_RADAR_CRON        || '0 */4 * * *';   // Radar scan every 4 hours
const SCHED_DAILY_SUMMARY_CRON= process.env.SCHED_DAILY_SUMMARY_CRON|| '0 8 * * *';     // Daily summary at 8am UTC

export class SchedulerService {
    private ipe: PlatformIntelligenceEngine;
    private social: SocialListeningEngine;
    private emotional: EmotionalIntelligenceEngine;
    private geo: GeoMonitoringEngine;
    private scraper: ScraperService;
    private decisionEngine: DecisionEngine;
    private orchestrator: AgentOrchestrator;
    private dailySummary: DailySummaryService;
    private radar: RadarAgent;

    constructor() {
        this.ipe = new PlatformIntelligenceEngine();
        this.social = new SocialListeningEngine();
        this.emotional = new EmotionalIntelligenceEngine();
        this.geo = new GeoMonitoringEngine();
        this.scraper = new ScraperService();
        this.decisionEngine = new DecisionEngine();
        this.orchestrator = new AgentOrchestrator();
        this.dailySummary = new DailySummaryService();
        this.radar = new RadarAgent();
    }

    start() {
        console.log('[Scheduler] Starting AdRoom Intelligence + Agent Execution Scheduler...');

        // ─── INTELLIGENCE LOOPS ─────────────────────────────────────────────────

        cron.schedule(SCHED_IPE_CRON, async () => {
            console.log('[Scheduler] Running Platform Intelligence Engine...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] IPE skipped — no active strategies'); return; }
                const cma = await creditManagementAgent.evaluate(null, 'ipe_cycle');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] IPE skipped — ${cma.reason}`); return; }
                const result = await this.ipe.runCycle();
                if (result && result.alerts && result.alerts.length > 0) await this.notifyBrain('platform', result.alerts);
            } catch (e: any) {
                console.error('[Scheduler] IPE error:', e.message);
            }
        });

        cron.schedule(SCHED_SOCIAL_CRON, async () => {
            console.log('[Scheduler] Running Social Listening...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] Social skipped — no active strategies'); return; }
                const cma = await creditManagementAgent.evaluate(null, 'social_listening');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] Social skipped — ${cma.reason}`); return; }
                const result = await this.social.runCycle();
                if (result && result.alerts && result.alerts.length > 0) await this.notifyBrain('social', result.alerts);
                if (result && result.conversations && result.conversations.length > 0) await this.runEmotionalCycle();
            } catch (e: any) {
                console.error('[Scheduler] Social listening error:', e.message);
            }
        });

        cron.schedule(SCHED_EMOTIONAL_CRON, async () => {
            try {
                if (!(await hasActiveStrategies())) { return; }
                const cma = await creditManagementAgent.evaluate(null, 'emotional_intel');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] Emotional skipped — ${cma.reason}`); return; }
                await this.runEmotionalCycle();
            }
            catch (e: any) { console.error('[Scheduler] Emotional cycle error:', e.message); }
        });

        cron.schedule(SCHED_GEO_CRON, async () => {
            console.log('[Scheduler] Running GEO Monitoring...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] GEO skipped — no active strategies'); return; }
                const cma = await creditManagementAgent.evaluate(null, 'geo_monitoring');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] GEO skipped — ${cma.reason}`); return; }
                const result = await this.geo.runCycle();
                if (result?.alerts?.length > 0) await this.notifyBrain('geo', result.alerts);
            } catch (e: any) {
                console.error('[Scheduler] GEO error:', e.message);
            }
        });

        cron.schedule(SCHED_SCRAPE_CRON, async () => {
            console.log('[Scheduler] Running On-Demand Website Scrape for Active Strategies...');
            try {
                await this.scraper.refreshStaleProducts();
            } catch (e: any) {
                console.error('[Scheduler] Scrape error:', e.message);
            }
        });

        // ─── AGENT EXECUTION LOOPS ───────────────────────────────────────────────

        // Execute due content tasks (posts, reels, stories, threads) — every 5 minutes
        cron.schedule(SCHED_AGENT_EXEC_CRON, async () => {
            try {
                const result = await this.orchestrator.executeDueTasks();
                if (result.executed > 0 || result.failed > 0) {
                    console.log(`[Scheduler] Agent execution cycle: ${result.executed} published, ${result.failed} failed`);
                }
            } catch (e: any) {
                console.error('[Scheduler] Agent execution error:', e.message);
            }
        });

        // Execute special tasks (lead scans, DM follow-ups, performance checks) — every 10 minutes
        cron.schedule(SCHED_AGENT_SPECIAL_CRON, async () => {
            try {
                await this.orchestrator.executeSpecialTasks();
            } catch (e: any) {
                console.error('[Scheduler] Agent special tasks error:', e.message);
            }
        });

        // Fetch real performance metrics from platform APIs — hourly
        cron.schedule(SCHED_AGENT_MONITOR_CRON, async () => {
            console.log('[Scheduler] Running performance monitoring...');
            try {
                await this.orchestrator.monitorPerformance();
            } catch (e: any) {
                console.error('[Scheduler] Performance monitoring error:', e.message);
            }
        });

        // Self-optimization: agents evaluate performance and adjust strategy — every 2 hours
        cron.schedule(SCHED_AGENT_OPTIM_CRON, async () => {
            console.log('[Scheduler] Running agent self-optimization...');
            try {
                await this.orchestrator.optimizeActiveStrategies();
            } catch (e: any) {
                console.error('[Scheduler] Optimization error:', e.message);
            }
        });

        // SALESMAN agent lead follow-ups — every 30 minutes
        cron.schedule(SCHED_LEAD_FOLLOWUP_CRON, async () => {
            try {
                await this.runLeadFollowUps();
            } catch (e: any) {
                console.error('[Scheduler] Lead follow-up error:', e.message);
            }
        });

        // CMA self-monitor — every 10 minutes: analyses real-time burn rate
        // and dynamically adjusts economy routing thresholds
        cron.schedule('*/10 * * * *', async () => {
            try {
                const status = await creditManagementAgent.selfMonitor();
                if (status.dynamicEconomyActive) {
                    console.log(`[CMA:Scheduler] Economy override ACTIVE — burn rate: ${status.systemBurnRate.toFixed(1)} credits/hr, cost: $${status.totalCostUsdLastHour.toFixed(4)}`);
                }
            } catch (e: any) {
                console.error('[Scheduler] CMA self-monitor error:', e.message);
            }
        });

        // Radar Agent — market intelligence scan every 4 hours
        cron.schedule(SCHED_RADAR_CRON, async () => {
            console.log('[Scheduler] Running Radar Agent global scan...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] Radar skipped — no active strategies'); return; }
                await this.radar.runGlobalScan();
            } catch (e: any) {
                console.error('[Scheduler] Radar Agent error:', e.message);
            }
        });

        // Daily Strategy Summary — every day at 8am UTC
        cron.schedule(SCHED_DAILY_SUMMARY_CRON, async () => {
            console.log('[Scheduler] Running Daily Summary generation...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] Daily summary skipped — no active strategies'); return; }
                await this.dailySummary.runDailyRound();
            } catch (e: any) {
                console.error('[Scheduler] Daily summary error:', e.message);
            }
        });

        console.log('[Scheduler] ✓ All loops started:');
        console.log('[Scheduler]   Intelligence: IPE, Social, Emotional, GEO — every 15 min');
        console.log('[Scheduler]   Agent Execution: Content posts — every 5 min');
        console.log('[Scheduler]   Special Tasks: Lead scans, DMs — every 10 min');
        console.log('[Scheduler]   Performance: Platform metrics — hourly');
        console.log('[Scheduler]   Optimization: Self-adjustment — every 2 hours');
        console.log('[Scheduler]   Lead Follow-up: Salesman DMs — every 30 min');
    }

    private async runEmotionalCycle() {
        console.log('[Scheduler] Triggering Emotional Analysis...');
        try {
            const result = await this.emotional.runCycle();
            if (result?.alerts?.length > 0) await this.notifyBrain('emotional', result.alerts);
        } catch (e: any) {
            console.error('[Scheduler] Emotional analysis error:', e.message);
        }
    }

    private async notifyBrain(source: string, alerts: any[]) {
        console.log(`[Scheduler] AI Brain: ${alerts.length} alerts from ${source}`);
        try {
            await this.decisionEngine.handleAlert(source, alerts);
        } catch (e: any) {
            console.error(`[Scheduler] Brain notify error (${source}):`, e.message);
        }
    }

    private async runLeadFollowUps() {
        const supabase = getServiceSupabaseClient();

        // Get all active SALESMAN strategies
        const { data: strategies } = await supabase
            .from('strategies')
            .select('id, user_id')
            .eq('is_active', true)
            .eq('agent_type', 'SALESMAN');

        if (!strategies?.length) return;

        const { SalesmanAgent } = await import('../agents/salesmanAgent');

        for (const strategy of strategies) {
            try {
                const agent = new SalesmanAgent(supabase);
                await agent.followUpLeads(strategy.user_id);
            } catch (e: any) {
                console.error(`[Scheduler] Lead follow-up error for ${strategy.id}:`, e.message);
            }
        }
    }
}
