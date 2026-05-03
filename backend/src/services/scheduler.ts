import cron from 'node-cron';
import dotenv from 'dotenv';
import { PlatformIntelligenceEngine } from './ipeEngine';
import { SocialListeningEngine } from './socialListening';
import { EmotionalIntelligenceEngine } from './emotionalIntelligence';
import { GeoMonitoringEngine } from './geoMonitoring';
import { PsychologistEngine } from './psychologistEngine';
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
const SCHED_GMAPS_CRON        = process.env.SCHED_GMAPS_CRON        || '0 */6 * * *';   // Google Maps business outreach every 6 hours

const SCHED_RADAR_CRON        = process.env.SCHED_RADAR_CRON        || '0 */4 * * *';   // Radar scan every 4 hours
const SCHED_DAILY_SUMMARY_CRON= process.env.SCHED_DAILY_SUMMARY_CRON|| '0 8 * * *';     // Daily summary at 8am UTC
const SCHED_PSYCHOLOGIST_CRON = process.env.SCHED_PSYCHOLOGIST_CRON  || '*/15 * * * *';  // Psychologist Engine every 15 min
const SCHED_VIDEO_EDIT_CRON   = process.env.SCHED_VIDEO_EDIT_CRON    || '*/30 * * * *';  // Execute pending video edit jobs every 30 min

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
    private psychologist: PsychologistEngine;

    constructor() {
        this.ipe = new PlatformIntelligenceEngine();
        this.social = new SocialListeningEngine();
        this.emotional = new EmotionalIntelligenceEngine();
        this.geo = new GeoMonitoringEngine();
        this.psychologist = new PsychologistEngine();
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

        // Google Maps business discovery + outreach — every 6 hours for all active strategies.
        // Runs for ALL agent types (SALESMAN / AWARENESS / PROMOTION / LAUNCH) because
        // every strategy goal — product, brand, or service — benefits from local client discovery.
        cron.schedule(SCHED_GMAPS_CRON, async () => {
            try {
                await this.runGoogleMapsOutreach();
            } catch (e: any) {
                console.error('[Scheduler] Google Maps outreach error:', e.message);
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

        // Psychologist Engine — real-time behavioral analysis every 15 minutes
        cron.schedule(SCHED_PSYCHOLOGIST_CRON, async () => {
            try {
                if (!(await hasActiveStrategies())) return;
                const cma = await creditManagementAgent.evaluate(null, 'psychologist_cycle');
                if (cma.decision === 'deny_cooldown') return;
                await this.psychologist.runCycle();
            } catch (e: any) {
                console.error('[Scheduler] Psychologist Engine error:', e.message);
            }
        });

        // Video Edit Job Execution — execute pending edit plans every 30 minutes
        cron.schedule(SCHED_VIDEO_EDIT_CRON, async () => {
            try {
                await this.executeVideoEditJobs();
            } catch (e: any) {
                console.error('[Scheduler] Video edit execution error:', e.message);
            }
        });

        console.log('[Scheduler] ✓ All loops started:');
        console.log('[Scheduler]   Intelligence: IPE, Social, Emotional, GEO — every 15 min');
        console.log('[Scheduler]   Agent Execution: Content posts — every 5 min');
        console.log('[Scheduler]   Special Tasks: Lead scans, DMs, GMAPS outreach — every 10 min');
        console.log('[Scheduler]   Performance: Platform metrics — hourly');
        console.log('[Scheduler]   Optimization: Self-adjustment — every 2 hours');
        console.log('[Scheduler]   Lead Follow-up: Salesman DMs — every 30 min');
        console.log('[Scheduler]   Google Maps Outreach: All strategy types — every 6 hours');
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

    private async executeVideoEditJobs() {
        const supabase = getServiceSupabaseClient();
        const { data: jobs } = await supabase
            .from('video_edit_jobs')
            .select('id, source_video_uri, execution_status')
            .eq('execution_status', 'plan_ready')
            .not('source_video_uri', 'is', null)
            .limit(5);

        if (!jobs || jobs.length === 0) return;

        const { SmartVideoEditor } = await import('../services/smartVideoEditor');
        const editor = new SmartVideoEditor();

        for (const job of jobs) {
            try {
                console.log(`[Scheduler] Executing video edit job ${job.id}...`);
                const url = await editor.executeEditPlan(job.id);
                console.log(`[Scheduler] Edit job ${job.id} complete: ${url}`);
            } catch (e: any) {
                console.error(`[Scheduler] Edit job ${job.id} failed:`, e.message);
            }
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

    /**
     * GOOGLE MAPS OUTREACH:
     * Runs every 6 hours for ALL active strategies regardless of agent type.
     * Every strategy goal — product, brand, or service — benefits from local
     * business discovery. Finds pending GMAPS_OUTREACH tasks that are due and
     * also triggers on-demand outreach for strategies that may have missed a cycle.
     */
    private async runGoogleMapsOutreach() {
        const supabase = getServiceSupabaseClient();

        // Get all active strategies across all agent types
        const { data: strategies } = await supabase
            .from('strategies')
            .select('id, user_id, agent_type, current_execution_plan')
            .eq('is_active', true);

        if (!strategies?.length) {
            console.log('[Scheduler] GMaps outreach: no active strategies');
            return;
        }

        const { SalesmanAgent } = await import('../agents/salesmanAgent');
        let totalReached = 0;

        for (const strategy of strategies) {
            try {
                // Check if there are overdue GMAPS_OUTREACH tasks for this strategy
                const now = new Date().toISOString();
                const { data: overdueTasks } = await supabase
                    .from('agent_tasks')
                    .select('*')
                    .eq('strategy_id', strategy.id)
                    .eq('task_type', 'GMAPS_OUTREACH')
                    .eq('status', 'pending')
                    .lte('scheduled_at', now)
                    .limit(3);

                if (!overdueTasks?.length) continue;

                const agent = new SalesmanAgent(supabase);

                for (const task of overdueTasks) {
                    try {
                        await supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', task.id);
                        const c = task.content || {};
                        const result = await agent.discoverAndOutreachLocalBusinesses({
                            userId: task.user_id,
                            strategyId: task.strategy_id,
                            location: c.location || '',
                            targetCategory: c.keyword || 'local business',
                            outreachChannel: c.outreach_channel || 'whatsapp',
                            senderName: c.sender_name || 'the team',
                            productOrService: c.product_or_service || c.keyword || 'our service',
                            maxTargets: 10,
                        });
                        await supabase.from('agent_tasks').update({
                            status: 'done',
                            executed_at: now,
                            result: { gmaps_reached: result.reached, leads: result.leads },
                        }).eq('id', task.id);
                        totalReached += result.reached;
                        console.log(`[Scheduler] GMaps outreach task ${task.id} (${strategy.agent_type}) — ${result.reached} businesses reached`);
                    } catch (taskErr: any) {
                        await supabase.from('agent_tasks').update({
                            status: 'failed',
                            error_message: taskErr.message,
                        }).eq('id', task.id);
                        console.error(`[Scheduler] GMaps task ${task.id} failed:`, taskErr.message);
                    }
                }
            } catch (e: any) {
                console.error(`[Scheduler] GMaps outreach error for strategy ${strategy.id}:`, e.message);
            }
        }

        if (totalReached > 0) {
            console.log(`[Scheduler] GMaps outreach cycle complete — ${totalReached} total businesses reached across all strategies`);
        }
    }
}
