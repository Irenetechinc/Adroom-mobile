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
import { apmaOrchestrator } from '../apma/apmaOrchestrator';
import { tokenRefreshService } from './tokenRefreshService';

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
const SCHED_TRIAL_BILLING_CRON= process.env.SCHED_TRIAL_BILLING_CRON || '0 * * * *';     // Trial auto-charge sweep every hour
const SCHED_RENEWAL_CRON      = process.env.SCHED_RENEWAL_CRON       || '15 * * * *';    // Subscription auto-renewal sweep every hour (offset 15m from trial)
const SCHED_RENEWAL_RETRY_CRON= process.env.SCHED_RENEWAL_RETRY_CRON || '30 * * * *';   // Retry failed renewals every hour (offset 30m)
const SCHED_TOKEN_REFRESH_CRON    = process.env.SCHED_TOKEN_REFRESH_CRON    || '0 */6 * * *';   // Proactive OAuth token refresh every 6 hours
const SCHED_LEAD_DISCOVERY_CRON   = process.env.SCHED_LEAD_DISCOVERY_CRON   || '0 */3 * * *';   // Multi-source lead discovery every 3 hours
const SCHED_PRODUCT_MANAGER_CRON  = process.env.SCHED_PRODUCT_MANAGER_CRON  || '0 */4 * * *';   // Product Manager Agent every 4 hours

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

        // ─── TRIAL AUTO-BILLING ──────────────────────────────────────────────────
        // Every hour: find all trialing subs whose trial_end has passed and
        // auto-charge the saved Flutterwave card to convert them to paid subscribers.
        cron.schedule(SCHED_TRIAL_BILLING_CRON, async () => {
            console.log('[Scheduler] Running trial billing sweep...');
            try {
                const supabase = getServiceSupabaseClient();
                const nowIso = new Date().toISOString();

                // Find all subscriptions that are still 'trialing' but trial_end has passed
                // and have not been charged yet (trial_charged IS NULL or false)
                const { data: expiredTrials, error } = await supabase
                    .from('subscriptions')
                    .select('user_id, plan, flw_card_token, trial_end')
                    .eq('status', 'trialing')
                    .lte('trial_end', nowIso)
                    .or('trial_charged.is.null,trial_charged.eq.false');

                if (error) {
                    console.error('[Scheduler] Trial billing sweep DB error:', error.message);
                    return;
                }
                if (!expiredTrials?.length) {
                    console.log('[Scheduler] Trial billing: no expired trials to process');
                    return;
                }

                console.log(`[Scheduler] Trial billing: processing ${expiredTrials.length} expired trial(s)`);
                const { energyService } = await import('./energyService');

                for (const row of expiredTrials) {
                    try {
                        const result = await energyService.chargeTrialConversion(row.user_id);
                        console.log(`[Scheduler] Trial conversion user ${row.user_id}: ${result.success ? '✓' : '✗'} ${result.message}`);
                    } catch (e: any) {
                        console.error(`[Scheduler] Trial conversion error for user ${row.user_id}:`, e.message);
                    }
                }
            } catch (e: any) {
                console.error('[Scheduler] Trial billing sweep error:', e.message);
            }
        });

        // ─── SUBSCRIPTION AUTO-RENEWAL ──────────────────────────────────────────
        // Every hour (offset +15m): find active subs whose current_period_end has
        // passed and cancel_at_period_end is false → charge saved card → new period.
        cron.schedule(SCHED_RENEWAL_CRON, async () => {
            console.log('[Scheduler] Running subscription renewal sweep...');
            try {
                const supabase = getServiceSupabaseClient();
                const nowIso = new Date().toISOString();
                const { data: dueRenewals, error } = await supabase
                    .from('subscriptions')
                    .select('user_id, plan, current_period_end, flw_card_token')
                    .eq('status', 'active')
                    .eq('cancel_at_period_end', false)
                    .lt('current_period_end', nowIso);

                if (error) { console.error('[Scheduler] Renewal sweep DB error:', error.message); return; }
                if (!dueRenewals?.length) { console.log('[Scheduler] Renewal: no subscriptions due'); return; }

                console.log(`[Scheduler] Renewal: processing ${dueRenewals.length} subscription(s)`);
                const { energyService } = await import('./energyService');
                for (const row of dueRenewals) {
                    try {
                        const result = await energyService.renewSubscription(row.user_id);
                        console.log(`[Scheduler] Renewal user ${row.user_id}: ${result.success ? '✓' : '✗'} ${result.message}`);
                    } catch (e: any) {
                        console.error(`[Scheduler] Renewal error for user ${row.user_id}:`, e.message);
                    }
                }
            } catch (e: any) {
                console.error('[Scheduler] Renewal sweep error:', e.message);
            }
        });

        // ─── RENEWAL RETRY (failed past_due) ─────────────────────────────────────
        // Every hour (offset +30m): find past_due subs where renewal_next_retry_at
        // is set and has elapsed → attempt charge again.
        cron.schedule(SCHED_RENEWAL_RETRY_CRON, async () => {
            console.log('[Scheduler] Running renewal retry sweep...');
            try {
                const supabase = getServiceSupabaseClient();
                const nowIso = new Date().toISOString();
                const { data: retryRows, error } = await supabase
                    .from('subscriptions')
                    .select('user_id, plan, renewal_next_retry_at, flw_card_token')
                    .eq('status', 'past_due')
                    .not('renewal_next_retry_at', 'is', null)
                    .lte('renewal_next_retry_at', nowIso);

                if (error) { console.error('[Scheduler] Retry sweep DB error:', error.message); return; }
                if (!retryRows?.length) { console.log('[Scheduler] Renewal retry: nothing to retry'); return; }

                console.log(`[Scheduler] Renewal retry: processing ${retryRows.length} failed subscription(s)`);
                const { energyService } = await import('./energyService');
                for (const row of retryRows) {
                    try {
                        // Temporarily reset status to active so renewSubscription() proceeds
                        await supabase.from('subscriptions').update({ status: 'active' }).eq('user_id', row.user_id);
                        const result = await energyService.renewSubscription(row.user_id);
                        console.log(`[Scheduler] Renewal retry user ${row.user_id}: ${result.success ? '✓' : '✗'} ${result.message}`);
                    } catch (e: any) {
                        console.error(`[Scheduler] Renewal retry error for user ${row.user_id}:`, e.message);
                    }
                }
            } catch (e: any) {
                console.error('[Scheduler] Renewal retry sweep error:', e.message);
            }
        });

        // ─── AUTO TOP-UP RETRY (failed on-demand charges) ───────────────────────
        // Every hour (offset +45m): retry failed auto top-ups whose retry time has elapsed.
        cron.schedule('45 * * * *', async () => {
            console.log('[Scheduler] Running auto top-up retry sweep...');
            try {
                const supabase = getServiceSupabaseClient();
                const nowIso = new Date().toISOString();
                const { data: rows, error } = await supabase
                    .from('energy_accounts')
                    .select('user_id, on_demand_top_up_amount, on_demand_top_up_retry_at')
                    .eq('on_demand_enabled', true)
                    .not('on_demand_top_up_retry_at', 'is', null)
                    .lte('on_demand_top_up_retry_at', nowIso);

                if (error) { console.error('[Scheduler] Auto top-up retry DB error:', error.message); return; }
                if (!rows?.length) { console.log('[Scheduler] Auto top-up retry: nothing due'); return; }

                console.log(`[Scheduler] Auto top-up retry: ${rows.length} pending charge(s)`);
                const { energyService } = await import('./energyService');
                for (const row of rows) {
                    try {
                        // Clear retry timestamp first to prevent double-firing
                        await supabase.from('energy_accounts')
                            .update({ on_demand_top_up_retry_at: null })
                            .eq('user_id', row.user_id);
                        // Re-trigger the on-demand check — it will charge if balance is still low
                        await (energyService as any).checkAndTriggerOnDemand(row.user_id, 0);
                        console.log(`[Scheduler] Auto top-up retry triggered for user ${row.user_id}`);
                    } catch (e: any) {
                        console.error(`[Scheduler] Auto top-up retry error for user ${row.user_id}:`, e.message);
                    }
                }
            } catch (e: any) {
                console.error('[Scheduler] Auto top-up retry sweep error:', e.message);
            }
        });

        // ─── INTELLIGENCE LOOPS ──────────────────────────────────────────────────

        cron.schedule(SCHED_IPE_CRON, async () => {
            console.log('[Scheduler] Running Platform Intelligence Engine...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] IPE skipped — no active strategies'); return; }
                const cma = await creditManagementAgent.evaluate(null, 'ipe_cycle');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] IPE skipped — ${cma.reason}`); return; }
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'platform', status: 'running' }); } catch {}
                const result = await this.ipe.runCycle();
                if (result && result.alerts && result.alerts.length > 0) await this.notifyBrain('platform', result.alerts);
                await this.decisionEngine.feedIntelligenceToActiveStrategies();
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'platform', status: 'done', alerts: result?.alerts?.length || 0 }); } catch {}
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
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'social', status: 'running' }); } catch {}
                const result = await this.social.runCycle();
                if (result && result.alerts && result.alerts.length > 0) await this.notifyBrain('social', result.alerts);
                if (result && result.conversations && result.conversations.length > 0) await this.runEmotionalCycle();
                await this.decisionEngine.feedIntelligenceToActiveStrategies();
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'social', status: 'done', conversations: result?.conversations?.length || 0 }); } catch {}
            } catch (e: any) {
                console.error('[Scheduler] Social listening error:', e.message);
            }
        });

        cron.schedule(SCHED_EMOTIONAL_CRON, async () => {
            try {
                if (!(await hasActiveStrategies())) { return; }
                const cma = await creditManagementAgent.evaluate(null, 'emotional_intel');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] Emotional skipped — ${cma.reason}`); return; }
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'emotional', status: 'running' }); } catch {}
                await this.runEmotionalCycle();
                await this.decisionEngine.feedIntelligenceToActiveStrategies();
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'emotional', status: 'done' }); } catch {}
            }
            catch (e: any) { console.error('[Scheduler] Emotional cycle error:', e.message); }
        });

        cron.schedule(SCHED_GEO_CRON, async () => {
            console.log('[Scheduler] Running GEO Monitoring...');
            try {
                if (!(await hasActiveStrategies())) { console.log('[Scheduler] GEO skipped — no active strategies'); return; }
                const cma = await creditManagementAgent.evaluate(null, 'geo_monitoring');
                if (cma.decision === 'deny_cooldown') { console.log(`[Scheduler] GEO skipped — ${cma.reason}`); return; }
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'geo', status: 'running' }); } catch {}
                const result = await this.geo.runCycle();
                if (result?.alerts?.length > 0) await this.notifyBrain('geo', result.alerts);
                await this.decisionEngine.feedIntelligenceToActiveStrategies();
                try { const { adminBroadcast } = await import('../admin/adminRouter'); adminBroadcast('intelligence_cycle', { source: 'geo', status: 'done', alerts: result?.alerts?.length || 0 }); } catch {}
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

        // Inbound DM detection — poll platforms for lead replies every 10 minutes
        cron.schedule(SCHED_AGENT_SPECIAL_CRON, async () => {
            try {
                const { inboundDmService } = await import('./inboundDmService');
                await inboundDmService.runCycle();
            } catch (e: any) {
                console.error('[Scheduler] Inbound DM detection error:', e.message);
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

        // Demographic & Market Intelligence — every 12 hours (runs after radar scan)
        cron.schedule('0 */12 * * *', async () => {
            console.log('[Scheduler] Running Demographic & Market Intelligence analysis...');
            try {
                if (!(await hasActiveStrategies())) return;
                const supabase = getServiceSupabaseClient();
                const { data: activeStrategies } = await supabase
                    .from('strategy_memory')
                    .select('strategy_id, user_id')
                    .eq('status', 'active');
                for (const s of (activeStrategies || [])) {
                    try { await this.radar.runDemographicAnalysis(s.user_id, s.strategy_id); } catch {}
                }
                console.log(`[Scheduler] Demographic analysis done for ${activeStrategies?.length || 0} strategies`);
            } catch (e: any) {
                console.error('[Scheduler] Demographic analysis error:', e.message);
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

        // APMA — Autonomous Political Marketing Agent cycle every 15 minutes
        cron.schedule('*/15 * * * *', async () => {
            try {
                await this.runAPMACycle();
            } catch (e: any) {
                console.error('[Scheduler] APMA cycle error:', e.message);
            }
        });

        // ─── PROACTIVE OAUTH TOKEN REFRESH ───────────────────────────────────
        // Every 6 hours: refresh expiring access tokens for all connected
        // platforms (Facebook/Instagram/WhatsApp/LinkedIn/Twitter/TikTok)
        // so the agents never hit a 401 mid-campaign.
        cron.schedule(SCHED_TOKEN_REFRESH_CRON, async () => {
            console.log('[Scheduler] Running OAuth token refresh sweep...');
            try {
                await tokenRefreshService.refreshExpiring();
            } catch (e: any) {
                console.error('[Scheduler] Token refresh sweep error:', e.message);
            }
        });

        // ─── MULTI-SOURCE LEAD DISCOVERY ────────────────────────────────────────
        cron.schedule(SCHED_LEAD_DISCOVERY_CRON, async () => {
            console.log('[Scheduler] Running multi-source lead discovery...');
            await this.runLeadDiscovery();
        });

        // ─── PRODUCT MANAGER AGENT ──────────────────────────────────────────────
        cron.schedule(SCHED_PRODUCT_MANAGER_CRON, async () => {
            console.log('[Scheduler] Running Product Manager Agent...');
            await this.runProductManager();
        });

        console.log('[Scheduler] ✓ All loops started:');
        console.log('[Scheduler]   Intelligence: IPE, Social, Emotional, GEO — every 15 min');
        console.log('[Scheduler]   Agent Execution: Content posts — every 5 min');
        console.log('[Scheduler]   Special Tasks: Lead scans, DMs, GMAPS outreach — every 10 min');
        console.log('[Scheduler]   Performance: Platform metrics — hourly');
        console.log('[Scheduler]   Optimization: Self-adjustment — every 2 hours');
        console.log('[Scheduler]   Lead Follow-up: Salesman DMs — every 30 min');
        console.log('[Scheduler]   Google Maps Outreach: All strategy types — every 6 hours');
        console.log('[Scheduler]   Trial Billing: Convert expired trials — hourly');
        console.log('[Scheduler]   Subscription Renewal: Auto-renew active subs — hourly');
        console.log('[Scheduler]   Renewal Retry: Retry failed past_due subs — hourly');
        console.log('[Scheduler]   APMA Political Marketing — every 15 min');
        console.log('[Scheduler]   OAuth Token Refresh: All platforms — every 6 hours');
        console.log('[Scheduler]   Lead Discovery: Reddit + Twitter + NewsAPI + Forum — every 3 hours');
        console.log('[Scheduler]   Product Manager: Autonomous product improvement — every 4 hours');
        console.log('[Scheduler]   Inbound DM Detection: Lead reply polling (FB/IG/Twitter) — every 10 min');
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

    // ─── MULTI-SOURCE LEAD DISCOVERY ─────────────────────────────────────────
    private async runLeadDiscovery() {
        try {
            const { leadDiscoveryService } = await import('./leadDiscoveryService');
            await leadDiscoveryService.runDiscoveryCycle();
            // After each discovery cycle, run the self-evolution engine to analyse
            // which sources performed best and permanently adopt winning strategies.
            // This runs in background — errors don't affect the main discovery cycle.
            leadDiscoveryService.evolveDiscoverySources().catch((e: any) =>
                console.error('[Scheduler] Self-evolution error:', e.message)
            );
        } catch (e: any) {
            console.error('[Scheduler] Lead discovery error:', e.message);
        }
    }

    // ─── PRODUCT MANAGER AGENT ───────────────────────────────────────────────
    private async runProductManager() {
        try {
            const { productManagerAgent } = await import('./productManagerAgent');
            await productManagerAgent.runCycle();
        } catch (e: any) {
            console.error('[Scheduler] Product manager error:', e.message);
        }
    }

    // ─── APMA AUTONOMOUS POLITICAL MARKETING CYCLE ───────────────────────────
    private async runAPMACycle() {
        try {
            await apmaOrchestrator.runCycle();
        } catch (e: any) {
            console.error('[Scheduler] APMA cycle error:', e.message);
        }
    }
}
