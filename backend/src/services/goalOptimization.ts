import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { AIEngine } from '../config/ai-models';
import { PlatformIntelligenceEngine } from './ipeEngine';
import { SocialListeningEngine } from './socialListening';
import { EmotionalIntelligenceEngine } from './emotionalIntelligence';
import { GeoMonitoringEngine } from './geoMonitoring';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export class GoalOptimizationService {
    private supabase: SupabaseClient;
    private ai: AIEngine;
    private ipe: PlatformIntelligenceEngine;
    private social: SocialListeningEngine;
    private emotional: EmotionalIntelligenceEngine;
    private geo: GeoMonitoringEngine;

    constructor() {
        this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        this.ai = AIEngine.getInstance();
        this.ipe = new PlatformIntelligenceEngine();
        this.social = new SocialListeningEngine();
        this.emotional = new EmotionalIntelligenceEngine();
        this.geo = new GeoMonitoringEngine();
    }

    /**
     * Main Entry Point: Optimize all active strategies
     */
    async runOptimizationCycle() {
        console.log('[GoalOptimization] Starting multi-user optimization cycle...');
        
        const { data: strategies } = await this.supabase
            .from('strategies')
            .select('*')
            .eq('is_active', true)
            .eq('status', 'active');

        if (strategies?.length) {
            const productIds = strategies.map((s: any) => s.product_id).filter(Boolean);
            if (productIds.length > 0) {
                const { data: memories } = await this.supabase
                    .from('product_memory')
                    .select('*')
                    .in('product_id', productIds);
                const memoryMap = new Map((memories ?? []).map((m: any) => [m.product_id, m]));
                for (const s of strategies) {
                    s.product_memory = memoryMap.get(s.product_id) ?? null;
                }
            }
        }

        if (!strategies) return;

        for (const strategy of strategies) {
            try {
                await this.optimizeStrategy(strategy);
            } catch (e) {
                console.error(`[GoalOptimization] Failed to optimize strategy ${strategy.id}:`, e);
            }
        }
    }

    private async optimizeStrategy(strategy: any) {
        const goal = strategy.goal?.toLowerCase();
        console.log(`[GoalOptimization] Optimizing for goal: ${goal} (Strategy: ${strategy.id})`);

        // 1. Fetch Current Progress
        const progress = await this.getGoalProgress(strategy);
        
        // 2. Gather Real-time Intelligence
        const intelligence = await this.gatherContextualIntelligence(strategy);

        // 3. Invoke Specialized Agent
        let agentResult;
        if (goal === 'sales') {
            agentResult = await this.runSalesAgent(strategy, progress, intelligence);
        } else if (goal === 'awareness') {
            agentResult = await this.runAwarenessAgent(strategy, progress, intelligence);
        } else if (goal === 'promotional') {
            agentResult = await this.runPromotionAgent(strategy, progress, intelligence);
        } else if (goal === 'launch') {
            agentResult = await this.runLaunchAgent(strategy, progress, intelligence);
        }

        // 4. Execute and Log Intervention
        if (agentResult && agentResult.intervention_needed) {
            await this.executeIntervention(strategy, agentResult);
        }
    }

    private async getGoalProgress(strategy: any) {
        // Fetch real-time metrics from analytics tables
        const { data } = await this.supabase
            .from('goal_progress')
            .select('*')
            .eq('strategy_id', strategy.id)
            .single();
        
        return data || { current_value: {}, target_value: strategy.estimated_outcomes };
    }

    private async gatherContextualIntelligence(strategy: any) {
        // Fetch the latest intelligence from all engines
        const [platform, social, emotional, geo] = await Promise.all([
            this.supabase.from('platform_intelligence').select('*').order('captured_at', { ascending: false }).limit(5),
            this.supabase.from('social_conversations').select('*').eq('category', strategy.product_memory?.category).limit(10),
            this.supabase.from('emotional_ownership').select('*').eq('category', strategy.product_memory?.category),
            this.supabase.from('narrative_snapshots').select('*').eq('brand_id', strategy.user_id).limit(3)
        ]);

        return { platform: platform.data, social: social.data, emotional: emotional.data, geo: geo.data };
    }

    /**
     * AGENT: Sales Man
     * Focus: Conversational commerce, lead generation, and high-intent organic traffic.
     */
    private async runSalesAgent(strategy: any, progress: any, intelligence: any) {
        const prompt = `
            You are the AdRoom SALES AGENT. Your goal is to DRIVE SALES through ORGANIC AUTOMATION that beats paid ROI.
            
            STRATEGY: ${JSON.stringify(strategy)}
            CURRENT PROGRESS: ${JSON.stringify(progress)}
            INTELLIGENCE: ${JSON.stringify(intelligence)}

            THINKING PROCESS:
            1. Analyze the gap between current sales/leads and target.
            2. Identify high-intent organic keywords or topics trending in Social Listening.
            3. Check Platform Intelligence for "Sales Arbitrage" (e.g., platforms currently boosting product-tagged posts or DM automation).
            4. Decide on a high-impact organic intervention (e.g., 'Deploy 50 personalized organic replies to high-intent questions in Reddit/X').

            OUTPUT JSON:
            {
                "intervention_needed": boolean,
                "problem_detected": "string",
                "thinking_process": "detailed thoughts on how to bypass paid ads",
                "action_taken": "Specific organic strategy adjustment",
                "impact_prediction": number (0-1)
            }
        `;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson;
    }

    /**
     * AGENT: Awareness Agent
     * Focus: Virality, reach, and algorithm hijacking.
     */
    private async runAwarenessAgent(strategy: any, progress: any, intelligence: any) {
        const prompt = `
            You are the AdRoom AWARENESS AGENT. Your goal is to MAXIMIZE REACH using ALGORITHM HACKS.
            
            STRATEGY: ${JSON.stringify(strategy)}
            CURRENT PROGRESS: ${JSON.stringify(progress)}
            INTELLIGENCE: ${JSON.stringify(intelligence)}

            THINKING PROCESS:
            1. Analyze reach vs target.
            2. Identify "Viral Hooks" currently favored by the algorithm (from Platform Intelligence).
            3. Use Social Listening to find a "Cultural Moment" to hijack.
            4. Decide on an intervention to trigger an organic "reach explosion" (e.g., 'Switch to high-velocity short-form videos with specific viral audio hooks detected by IPE').

            OUTPUT JSON:
            {
                "intervention_needed": boolean,
                "problem_detected": "string",
                "thinking_process": "detailed thoughts on algorithm hijacking",
                "action_taken": "Specific virality-focused adjustment",
                "impact_prediction": number (0-1)
            }
        `;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson;
    }

    /**
     * AGENT: Promotion Agent
     * Focus: Engagement, hype, and FOMO through organic scarcity.
     */
    private async runPromotionAgent(strategy: any, progress: any, intelligence: any) {
        const prompt = `
            You are the AdRoom PROMOTION AGENT. Your goal is to drive engagement for a SPECIFIC OFFER using ORGANIC FOMO.
            
            STRATEGY: ${JSON.stringify(strategy)}
            CURRENT PROGRESS: ${JSON.stringify(progress)}
            INTELLIGENCE: ${JSON.stringify(intelligence)}

            THINKING PROCESS:
            1. Check if the offer is resonating.
            2. Use Emotional Intelligence to find the "Emotional Trigger" that will drive the most organic shares.
            3. Decide on a tweak to the "Scarcity" or "Hype" logic in organic posts.

            OUTPUT JSON:
            {
                "intervention_needed": boolean,
                "problem_detected": "string",
                "thinking_process": "detailed thoughts on organic FOMO",
                "action_taken": "Specific promotion adjustment",
                "impact_prediction": number (0-1)
            }
        `;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson;
    }

    /**
     * AGENT: Launch Agent
     * Focus: Narrative dominance and cross-platform "Organic Strike".
     */
    private async runLaunchAgent(strategy: any, progress: any, intelligence: any) {
        const prompt = `
            You are the AdRoom LAUNCH AGENT. Your goal is a SUCCESSFUL PRODUCT ROLLOUT without a cent of ad spend.
            
            STRATEGY: ${JSON.stringify(strategy)}
            CURRENT PROGRESS: ${JSON.stringify(progress)}
            INTELLIGENCE: ${JSON.stringify(intelligence)}

            THINKING PROCESS:
            1. Analyze the "Hype" level and Narrative Snapshots.
            2. Identify "Narrative Gaps" in AI models (GEO) that can be fixed with organic volume.
            3. Coordinate a cross-platform "Organic Strike" to flood the algorithm with positive sentiment.

            OUTPUT JSON:
            {
                "intervention_needed": boolean,
                "problem_detected": "string",
                "thinking_process": "detailed thoughts on narrative dominance",
                "action_taken": "Specific launch adjustment",
                "impact_prediction": number (0-1)
            }
        `;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson;
    }

    private async executeIntervention(strategy: any, result: any) {
        console.log(`[GoalOptimization] Executing intervention for strategy ${strategy.id}: ${result.action_taken}`);

        // 1. Log Intervention
        await this.supabase.from('agent_interventions').insert({
            strategy_id: strategy.id,
            agent_type: `${strategy.goal}_agent`,
            problem_detected: result.problem_detected,
            thinking_process: result.thinking_process,
            action_taken: result.action_taken,
            impact_score: result.impact_prediction,
            intelligence_used: { timestamp: new Date().toISOString() }
        });

        // 2. Apply strategy adjustment in real-time
        const { data: currentStrategy, error: fetchError } = await this.supabase
            .from('strategies')
            .select('platform_selection_logic, current_execution_plan')
            .eq('id', strategy.id)
            .single();

        if (fetchError) throw fetchError;

        // Merge the agent's decision into the execution plan
        const updatedPlan = {
            ...(currentStrategy?.current_execution_plan || {}),
            last_intervention: {
                agent: `${strategy.goal}_agent`,
                action: result.action_taken,
                timestamp: new Date().toISOString(),
                reason: result.problem_detected
            },
            // The worker will prioritize these instructions in the next cycle
            instruction_override: result.action_taken 
        };

        const updatedLogic = {
            ...(currentStrategy?.platform_selection_logic || {}),
            last_agent_intervention: result.action_taken,
            intervention_time: new Date().toISOString()
        };

        const { error: updateError } = await this.supabase
            .from('strategies')
            .update({ 
                platform_selection_logic: updatedLogic,
                current_execution_plan: updatedPlan
            })
            .eq('id', strategy.id);

        if (updateError) throw updateError;

        console.log(`[GoalOptimization] Strategy ${strategy.id} successfully adjusted by ${strategy.goal} agent.`);
    }
}
