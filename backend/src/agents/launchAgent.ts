import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase } from './agentBase';
import { AIEngine } from '../config/ai-models';

export class LaunchAgent extends AgentBase {
    constructor(supabase: SupabaseClient) {
        super(supabase, 'LAUNCH');
    }

    /**
     * PLAN: Generate hype-driven launch sequence — pre-launch buildup, launch day blitz, post-launch sustain
     */
    async plan(params: {
        strategyId: string;
        userId: string;
        strategy: any;
        product: any;
        platforms: string[];
        durationDays: number;
    }): Promise<void> {
        this.log(`Planning ${params.durationDays}-day LAUNCH campaign for strategy ${params.strategyId}`);

        const trends = await this.getTrendingTopics(params.product?.category || 'general');
        const narrativeSnapshots = await this.getNarrativeSnapshots(params.userId);
        const platformIntel: Record<string, any> = {};
        for (const platform of params.platforms) {
            platformIntel[platform] = await this.getLatestPlatformIntelligence(platform);
        }

        const launchDay = Math.round(params.durationDays * 0.35); // Launch on 35% of campaign duration

        const planPrompt = `
You are the AdRoom LAUNCH Agent. Create a ${params.durationDays}-day PRODUCT LAUNCH campaign with zero paid budget.

PRODUCT: ${JSON.stringify(params.product)}
STRATEGY: ${JSON.stringify(params.strategy)}
PLATFORMS: ${JSON.stringify(params.platforms)}
LAUNCH DAY: Day ${launchDay} of ${params.durationDays}
TRENDING TOPICS: ${JSON.stringify(trends)}
PLATFORM INTELLIGENCE: ${JSON.stringify(platformIntel)}
NARRATIVE SNAPSHOTS (How AI sees this brand): ${JSON.stringify(narrativeSnapshots)}

LAUNCH AGENT MANDATE:
- Build MAXIMUM PRE-LAUNCH HYPE through mystery, exclusivity, and social proof
- Execute LAUNCH DAY BLITZ: coordinated posts across ALL platforms within 2-hour window
- Sustain POST-LAUNCH MOMENTUM with testimonials, press coverage amplification, and UGC
- Use GEO (Generative Engine Optimization) — flood AI models with positive brand narrative

CAMPAIGN PHASES:
Phase 1 (Days 1 to ${launchDay - 3}): PRE-LAUNCH HYPE
- Teaser content (mystery/reveal mechanic)
- "Insider access" content for early followers
- Behind-the-scenes content
- Countdown posts starting at Day ${launchDay - 7}

Phase 2 (Days ${launchDay - 2} to ${launchDay + 1}): LAUNCH BLITZ  
- SIMULTANEOUS multi-platform launch post (all platforms within 1 hour)
- Live Q&A announcement
- Early adopter offer post
- Press/media outreach amplification

Phase 3 (Days ${launchDay + 2} to ${params.durationDays}): POST-LAUNCH MOMENTUM
- First customer testimonials
- "This is what happened" recap (social proof)
- "Still available" urgency
- Trend hijacking with launch narrative

Task types: TEASER, COUNTDOWN, LAUNCH_BLITZ, ANNOUNCEMENT, TESTIMONIAL, MOMENTUM_POST, UGC_REQUEST

Return JSON:
{
  "campaign_theme": "string",
  "launch_narrative": "The core story/angle for the launch",
  "hype_mechanics": ["mechanic 1", "mechanic 2"],
  "launch_day": ${launchDay},
  "daily_tasks": [
    {
      "day": 1,
      "platform": "instagram",
      "task_type": "TEASER",
      "hour": 9,
      "minute": 0,
      "headline": "string",
      "body": "Post text",
      "image_prompt": "Imagen 3 prompt",
      "hashtags": ["tag1"],
      "cta": "string",
      "launch_phase": "pre_launch|launch_blitz|post_launch",
      "narrative_angle": "mystery|social_proof|exclusivity|announcement"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        const plan = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            await this.buildSkill({
                problem: 'Launch plan returned empty — need robust launch content fallback',
                context: `Product: ${params.product?.name}, Platforms: ${params.platforms.join(', ')}`,
                strategyId: params.strategyId
            });
            return;
        }

        const now = new Date();
        const tasks = plan.daily_tasks.map((task: any) => {
            const scheduleDate = new Date(now);
            scheduleDate.setDate(scheduleDate.getDate() + (task.day - 1));

            // Launch blitz tasks on launch day all publish within 2-hour window
            if (task.launch_phase === 'launch_blitz') {
                scheduleDate.setHours(9, 0, 0, 0);
            } else {
                scheduleDate.setHours(task.hour || 9, task.minute || 0, 0, 0);
            }

            return {
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: 'LAUNCH',
                task_type: task.task_type || 'POST',
                platform: task.platform,
                scheduled_at: scheduleDate.toISOString(),
                status: 'pending',
                content: {
                    headline: task.headline,
                    body: task.body,
                    image_prompt: task.image_prompt,
                    hashtags: task.hashtags || [],
                    cta: task.cta,
                    launch_phase: task.launch_phase,
                    narrative_angle: task.narrative_angle
                }
            };
        });

        const { error } = await this.supabase.from('agent_tasks').insert(tasks);
        if (error) this.log(`Schedule error: ${error.message}`);
        else this.log(`Scheduled ${tasks.length} LAUNCH tasks (Launch Day: Day ${plan.launch_day})`);

        await this.supabase.from('strategies').update({
            is_active: true,
            agent_type: 'LAUNCH',
            current_execution_plan: {
                campaign_theme: plan.campaign_theme,
                launch_narrative: plan.launch_narrative,
                hype_mechanics: plan.hype_mechanics,
                launch_day: plan.launch_day,
                total_tasks: tasks.length
            }
        }).eq('id', params.strategyId);
    }

    /**
     * EXECUTE: Publish a launch task with narrative-aligned, phase-appropriate content
     */
    async executeTask(taskId: string): Promise<void> {
        const { data: task } = await this.supabase
            .from('agent_tasks')
            .select('*, strategies(product_id, goal, current_execution_plan)')
            .eq('id', taskId)
            .single();

        if (!task) return;

        this.log(`Executing LAUNCH task ${taskId} — ${task.task_type} (${task.content.launch_phase})`);
        await this.supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', taskId);

        try {
            const tokens = await this.getTokens(task.user_id);
            const product = await this.getProductDetails(task.strategies?.product_id);
            const launchNarrative = task.strategies?.current_execution_plan?.launch_narrative || '';

            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'LAUNCH',
                product,
                context: `${task.content.headline || ''} ${task.content.body}`,
                taskType: task.task_type,
                dayNumber: 1,
                totalDays: 30,
                instructionOverride: [
                    `Phase: ${task.content.launch_phase}`,
                    `Narrative: ${task.content.narrative_angle}`,
                    `Campaign story: ${launchNarrative}`
                ].join('. ')
            });

            const hashtags = (finalContent.hashtags || []).slice(0, 15).map((h: string) => `#${h}`).join(' ');
            const body = `${finalContent.headline}\n\n${finalContent.body}\n\n${hashtags}`;

            let result;
            if (task.platform === 'facebook' && tokens.facebook) {
                result = await this.publishToFacebook(tokens.facebook, body);
            } else if (task.platform === 'instagram' && tokens.instagram) {
                result = await this.publishToInstagram(tokens.instagram, body);
            } else if (task.platform === 'twitter' && tokens.twitter) {
                result = await this.publishToTwitter(tokens.twitter, body.slice(0, 280));
            } else if (task.platform === 'linkedin' && tokens.linkedin) {
                result = await this.publishToLinkedIn(tokens.linkedin, body);
            } else {
                throw new Error(`No token for platform: ${task.platform}`);
            }

            await this.completeTask(taskId, { ...result, final_content: finalContent });
            this.log(`LAUNCH ${task.content.launch_phase} post published — ${result?.platform_post_id}`);

            // After launch blitz, schedule momentum monitoring
            if (task.content.launch_phase === 'launch_blitz') {
                await this.schedulePostLaunchMonitoring(task.strategy_id, task.user_id);
            }

        } catch (err: any) {
            this.log(`LAUNCH task ${taskId} failed: ${err.message}`);
            await this.failTask(taskId, err.message);
        }
    }

    /**
     * NARRATIVE DOMINATION: Flood platforms with consistent launch narrative to influence AI/search perception (GEO)
     */
    async executeNarrativeDomination(params: {
        strategyId: string;
        userId: string;
        product: any;
        platforms: string[];
    }): Promise<void> {
        this.log(`Executing NARRATIVE DOMINATION for ${params.product?.name}`);

        const narrativePrompt = `
Generate 5 distinct narrative angles for ${params.product?.name} that together will DOMINATE the organic conversation.
Each angle targets a different keyword cluster and emotional trigger.

Return JSON:
{
  "angles": [
    {
      "angle_name": "string",
      "keyword_cluster": ["keyword1", "keyword2"],
      "platform": "facebook|instagram|twitter|linkedin",
      "post_content": "Full post text",
      "ai_narrative_contribution": "How this post shapes how AI models describe this product"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, narrativePrompt);
        const dominationPlan = response.parsedJson;

        if (!dominationPlan?.angles?.length) return;

        const tokens = await this.getTokens(params.userId);

        for (const angle of dominationPlan.angles) {
            try {
                const platform = angle.platform || params.platforms[0];
                if (platform === 'facebook' && tokens.facebook) {
                    await this.publishToFacebook(tokens.facebook, angle.post_content);
                } else if (platform === 'twitter' && tokens.twitter) {
                    await this.publishToTwitter(tokens.twitter, angle.post_content.slice(0, 280));
                } else if (platform === 'linkedin' && tokens.linkedin) {
                    await this.publishToLinkedIn(tokens.linkedin, angle.post_content);
                }

                // Store narrative snapshot
                await this.supabase.from('narrative_snapshots').insert({
                    brand_id: params.userId,
                    platform: platform,
                    snapshot_text: angle.post_content,
                    keyword_cluster: angle.keyword_cluster,
                    narrative_angle: angle.angle_name
                });

                this.log(`Narrative angle "${angle.angle_name}" published to ${platform}`);
            } catch (err: any) {
                this.log(`Narrative angle failed: ${err.message}`);
            }
        }
    }

    /**
     * OPTIMIZE: If hype metrics are low before launch day, escalate teaser content
     */
    async optimizeStrategy(strategyId: string, userId: string): Promise<void> {
        const { data: strategy } = await this.supabase
            .from('strategies')
            .select('*')
            .eq('id', strategyId)
            .single();

        if (!strategy) return;

        const { data: perf } = await this.supabase
            .from('agent_performance')
            .select('*')
            .eq('strategy_id', strategyId)
            .order('fetched_at', { ascending: false })
            .limit(10);

        const launchDay = strategy.current_execution_plan?.launch_day || 7;
        const daysElapsed = Math.round(
            (Date.now() - new Date(strategy.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysElapsed < launchDay) {
            // Pre-launch: evaluate hype level
            const totalReach = (perf || []).reduce((sum: number, p: any) => sum + (p.reach || 0), 0);
            const minHypeReach = 1000 * daysElapsed; // Expect 1K reach/day in pre-launch

            if (totalReach < minHypeReach) {
                this.log(`Pre-launch hype below threshold (${totalReach} < ${minHypeReach}) — escalating`);

                const trends = await this.getTrendingTopics(strategy.product_memory?.category || 'general');

                const interventionPrompt = `
LAUNCH AGENT PRE-LAUNCH HYPE EMERGENCY.
Only ${totalReach} reach after ${daysElapsed} days. Launch is Day ${launchDay}.
We need MORE HYPE immediately.

TRENDING: ${JSON.stringify(trends)}
STRATEGY: ${JSON.stringify(strategy)}

Create an immediate hype-escalation tactic. Be creative — mystery, exclusive previews, community challenge.

Return JSON:
{
  "problem": "string",
  "action": "Specific escalation tactic",
  "thinking": "Why this will build hype",
  "content_to_post": "Exact post content",
  "impact_score": 0.0
}
`;
                const response = await this.ai.generateStrategy({}, interventionPrompt);
                const intervention = response.parsedJson;

                if (intervention?.action) {
                    await this.logIntervention({
                        strategyId,
                        problem: intervention.problem,
                        action: intervention.action,
                        thinking: intervention.thinking,
                        impactScore: intervention.impact_score || 0.7,
                        intelligence: { reach_gap: minHypeReach - totalReach, days_to_launch: launchDay - daysElapsed }
                    });

                    // Schedule emergency hype post in 30 minutes
                    await this.supabase.from('agent_tasks').insert({
                        strategy_id: strategyId,
                        user_id: userId,
                        agent_type: 'LAUNCH',
                        task_type: 'TEASER',
                        platform: (strategy.platforms || ['instagram'])[0],
                        scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                        status: 'pending',
                        content: {
                            body: intervention.content_to_post,
                            launch_phase: 'pre_launch',
                            narrative_angle: 'mystery'
                        }
                    });

                    this.log(`Hype escalation scheduled: ${intervention.action}`);
                }
            }
        }
    }

    private async schedulePostLaunchMonitoring(strategyId: string, userId: string): Promise<void> {
        // Schedule performance check 6 hours after launch
        await this.supabase.from('agent_tasks').insert({
            strategy_id: strategyId,
            user_id: userId,
            agent_type: 'LAUNCH',
            task_type: 'PERFORMANCE_CHECK',
            platform: 'internal',
            scheduled_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            status: 'pending',
            content: { action: 'post_launch_performance_review' }
        });
    }

    private async getNarrativeSnapshots(userId: string): Promise<any[]> {
        const { data } = await this.supabase
            .from('narrative_snapshots')
            .select('*')
            .eq('brand_id', userId)
            .order('captured_at', { ascending: false })
            .limit(5);
        return data || [];
    }
}
