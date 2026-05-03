import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase } from './agentBase';
import { AIEngine } from '../config/ai-models';

export class AwarenessAgent extends AgentBase {
    constructor(supabase: SupabaseClient) {
        super(supabase, 'AWARENESS');
    }

    /**
     * PLAN: Generate reach-maximized content calendar focused on virality and algorithm hacking
     */
    async plan(params: {
        strategyId: string;
        userId: string;
        strategy: any;
        product: any;
        platforms: string[];
        durationDays: number;
    }): Promise<void> {
        this.log(`Planning ${params.durationDays}-day AWARENESS campaign for strategy ${params.strategyId}`);

        const trends = await this.getTrendingTopics(params.product?.category || 'general');
        const platformIntel: Record<string, any> = {};
        for (const platform of params.platforms) {
            platformIntel[platform] = await this.getLatestPlatformIntelligence(platform);
        }

        const planPrompt = `
You are the AdRoom AWARENESS Agent. Create a ${params.durationDays}-day REACH MAXIMIZATION campaign.

PRODUCT: ${JSON.stringify(params.product)}
STRATEGY: ${JSON.stringify(params.strategy)}
PLATFORMS: ${JSON.stringify(params.platforms)}
LIVE TRENDS: ${JSON.stringify(trends)}
PLATFORM INTELLIGENCE: ${JSON.stringify(platformIntel)}

AWARENESS AGENT MANDATE:
- Maximize REACH and BRAND VISIBILITY — zero paid budget
- Use algorithm arbitrage: post when platforms boost organic content
- Each post must be designed to be SHARED or SAVED (not just liked)
- Days 1-5: Brand story & problem definition (highest reach formats: Reels, Carousels)
- Days 6-12: Trend hijacking + viral hooks
- Days 13-20: Community building + UGC encouragement  
- Days 21+: Momentum posts that capitalize on existing reach

PLATFORM-SPECIFIC ALGORITHM HACKS TO APPLY:
- TikTok: trending sounds, text overlays, fast cuts, POV hooks
- Instagram: Reels get 3x more reach, carousel saves boost distribution
- Facebook: video posts with captions get 135% more organic reach
- LinkedIn: native document posts get highest reach, polls boost visibility
- Twitter/X: thread starters with images get 313% more engagement

For each platform selected, create tasks that exploit its current algorithm priorities.
Task types: POST, REEL, STORY, CAROUSEL, THREAD, HASHTAG_CAMPAIGN, POLL

Return JSON:
{
  "campaign_theme": "string",
  "viral_hooks": ["hook 1", "hook 2"],
  "daily_tasks": [
    {
      "day": 1,
      "platform": "instagram",
      "task_type": "REEL",
      "hour": 7,
      "minute": 0,
      "headline": "string",
      "body": "Caption text",
      "image_prompt": "Imagen 3 visual prompt",
      "hashtags": ["tag1"],
      "cta": "string",
      "virality_hook": "specific hook to maximize shares",
      "algorithm_exploit": "which algorithm rule this exploits"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        const plan = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            await this.buildSkill({
                problem: 'Awareness plan returned empty — need fallback viral content strategy',
                context: `Product: ${params.product?.name}, Platforms: ${params.platforms.join(', ')}`,
                strategyId: params.strategyId
            });
            return;
        }

        const now = new Date();
        const tasks = plan.daily_tasks.map((task: any) => {
            const scheduleDate = new Date(now);
            scheduleDate.setDate(scheduleDate.getDate() + (task.day - 1));
            scheduleDate.setHours(task.hour || 7, task.minute || 0, 0, 0);

            return {
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: 'AWARENESS',
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
                    virality_hook: task.virality_hook,
                    algorithm_exploit: task.algorithm_exploit
                }
            };
        });

        const { error } = await this.supabase.from('agent_tasks').insert(tasks);
        if (error) this.log(`Schedule error: ${error.message}`);
        else this.log(`Scheduled ${tasks.length} AWARENESS tasks`);

        await this.supabase.from('strategies').update({
            is_active: true,
            agent_type: 'AWARENESS',
            current_execution_plan: {
                campaign_theme: plan.campaign_theme,
                viral_hooks: plan.viral_hooks,
                total_tasks: tasks.length
            }
        }).eq('id', params.strategyId);

        // Schedule Google Maps business discovery as part of achieving the awareness goal —
        // finds local businesses to reach out to whether the strategy is for a product, brand, or service.
        const gmapsTasks = await this.scheduleGoogleMapsOutreachTasks({
            strategyId: params.strategyId,
            userId: params.userId,
            product: params.product,
            strategy: params.strategy,
            agentType: 'AWARENESS',
            durationDays: params.durationDays,
        });
        if (gmapsTasks > 0) {
            this.log(`AWARENESS: scheduled ${gmapsTasks} Google Maps outreach tasks to support brand reach goal`);
        }
    }

    /**
     * EXECUTE: Publish an awareness task with reach-optimized content
     */
    async executeTask(taskId: string): Promise<void> {
        const { data: task } = await this.supabase
            .from('agent_tasks')
            .select('*, strategies(product_id, goal, estimated_outcomes)')
            .eq('id', taskId)
            .single();

        if (!task) return;

        this.log(`Executing AWARENESS task ${taskId} — ${task.task_type} on ${task.platform}`);
        await this.supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', taskId);

        try {
            const tokens = await this.getTokens(task.user_id);
            const product = await this.getProductDetails(task.strategies?.product_id);
            const intel = await this.getLatestPlatformIntelligence(task.platform);
            const trends = await this.getTrendingTopics(product?.category || 'general');

            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'AWARENESS',
                product,
                context: `${task.content.headline || ''} ${task.content.body}`,
                taskType: task.task_type,
                dayNumber: 1,
                totalDays: 30,
                trends,
                instructionOverride: task.content.virality_hook
                    ? `Apply virality hook: ${task.content.virality_hook}. Algorithm target: ${task.content.algorithm_exploit}`
                    : undefined
            });

            const hashtags = (finalContent.hashtags || []).slice(0, 20).map((h: string) => `#${h}`).join(' ');
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
            } else if (task.platform === 'tiktok' && tokens.tiktok) {
                let tiktokVideoUrl: string | undefined = task.content?.video_url;

                if (!tiktokVideoUrl) {
                    const { data: strategyData } = await this.supabase
                        .from('strategies')
                        .select('current_execution_plan, product_id')
                        .eq('id', task.strategy_id)
                        .single();

                    const userVideoUrl: string | undefined = strategyData?.current_execution_plan?.user_video_url;
                    const taskProduct = await this.getProductDetails(strategyData?.product_id || task.content?.product_id);

                    // Consult Director Agent for visual direction + video decision
                    const { DirectorAgent } = await import('./directorAgent');
                    const director = new DirectorAgent();
                    const direction = await director.getDirection({
                        userId: task.user_id,
                        productId: strategyData?.product_id,
                        strategyId: task.strategy_id,
                        product: taskProduct,
                        platform: 'tiktok',
                        goal: 'AWARENESS — maximum reach and virality',
                        hasUserVideo: !!userVideoUrl,
                    });

                    // Consult Psychologist Engine
                    const { PsychologistEngine } = await import('../services/psychologistEngine');
                    const psychologist = new PsychologistEngine();
                    const psychProfile = await psychologist.getProfileForProduct(
                        strategyData?.product_id || '',
                        taskProduct?.category
                    );

                    if (direction.should_use_user_video && userVideoUrl) {
                        this.log(`TikTok awareness ${taskId}: Director chose user video — checking for edit job...`);
                        const { SmartVideoEditor } = await import('../services/smartVideoEditor');
                        const editor = new SmartVideoEditor();
                        tiktokVideoUrl = await editor.getBestVideoForStrategy(task.strategy_id, userVideoUrl) || userVideoUrl;
                    } else {
                        // Check subscription tier before generating
                        const { checkFeatureAccess } = await import('../services/subscriptionGuard');
                        const access = await checkFeatureAccess(task.user_id, 'video_asset', this.supabase as any);

                        if (!access.allowed) {
                            this.log(`TikTok awareness ${taskId}: AI video blocked — ${access.reason}. Using user video or skipping.`);
                            tiktokVideoUrl = userVideoUrl;
                        } else {
                            this.log(`TikTok awareness ${taskId}: Director chose AI generation with Director+Psychologist direction...`);
                            const creative = new (await import('../services/creativeService')).CreativeService();
                            tiktokVideoUrl = await creative.generateTikTokVideo(
                                taskProduct || { name: 'Product', description: '' },
                                direction,
                                psychProfile
                            ) || userVideoUrl || undefined;
                        }
                    }

                    if (!tiktokVideoUrl) {
                        this.log(`TikTok awareness ${taskId}: no video available — rescheduling in 30 min.`);
                        await this.supabase.from('agent_tasks').update({
                            status: 'pending',
                            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                            notes: 'No video available — will retry in 30 minutes',
                        }).eq('id', taskId);
                        return;
                    }

                    await this.supabase.from('agent_tasks').update({
                        content: { ...task.content, video_url: tiktokVideoUrl },
                    }).eq('id', taskId);

                    this.log(`TikTok awareness ${taskId}: video ready (Director: ${direction.should_use_user_video ? 'user_video' : 'ai_generated'})`);
                }

                result = await this.publishToTikTok(tokens.tiktok, body, tiktokVideoUrl);
            } else {
                throw new Error(`No token for: ${task.platform}`);
            }

            await this.completeTask(taskId, { ...result, final_content: finalContent });
            this.log(`Published awareness post — platform_id: ${result?.platform_post_id}`);

        } catch (err: any) {
            this.log(`AWARENESS task ${taskId} failed: ${err.message}`);
            await this.failTask(taskId, err.message);
        }
    }

    /**
     * CROSS-POST BLITZ: Simultaneously push one piece of content to ALL connected platforms
     * Used when a piece of content goes viral — amplify it everywhere
     */
    async crossPostBlitz(params: {
        strategyId: string;
        userId: string;
        content: string;
        imagePrompt?: string;
    }): Promise<void> {
        this.log(`Executing CROSS-POST BLITZ for strategy ${params.strategyId}`);

        const tokens = await this.getTokens(params.userId);
        const platforms = Object.keys(tokens).filter(p => tokens[p as keyof typeof tokens]);

        for (const platform of platforms) {
            const adapted = await this.generatePlatformContent({
                platform,
                goal: 'AWARENESS',
                product: null,
                context: params.content,
                taskType: 'BLITZ_POST',
                dayNumber: 1,
                totalDays: 1
            });

            const body = `${adapted.headline}\n\n${adapted.body}`;

            try {
                if (platform === 'facebook' && tokens.facebook) {
                    await this.publishToFacebook(tokens.facebook, body);
                } else if (platform === 'instagram' && tokens.instagram) {
                    await this.publishToInstagram(tokens.instagram, body);
                } else if (platform === 'twitter' && tokens.twitter) {
                    await this.publishToTwitter(tokens.twitter, body.slice(0, 280));
                } else if (platform === 'linkedin' && tokens.linkedin) {
                    await this.publishToLinkedIn(tokens.linkedin, body);
                } else if (platform === 'tiktok' && tokens.tiktok) {
                    // TikTok requires video — blitz text posts are skipped, log for awareness
                    this.log(`TikTok blitz skipped: no video asset available for blitz post`);
                }
                this.log(`Blitz published to ${platform}`);
            } catch (err: any) {
                this.log(`Blitz failed on ${platform}: ${err.message}`);
            }
        }
    }

    /**
     * OPTIMIZE: If reach is below target, pivot to higher-reach formats and schedule catch-up content
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
            .limit(20);

        const totalReach = (perf || []).reduce((sum: number, p: any) => sum + (p.reach || 0), 0);
        const targetReach = strategy.estimated_outcomes?.reach || 50000;
        const paidEquivalent = (perf || []).reduce((sum: number, p: any) => sum + (p.paid_equivalent_usd || 0), 0);

        this.log(`Reach: ${totalReach}/${targetReach} | Paid equivalent: $${paidEquivalent}`);

        if (totalReach < targetReach * 0.4) {
            this.log('Reach below 40% of target — initiating AWARENESS intervention');

            const trends = await this.getTrendingTopics(strategy.product_memory?.category || 'general');
            const platformIntel: Record<string, any> = {};
            for (const platform of strategy.platforms || []) {
                platformIntel[platform] = await this.getLatestPlatformIntelligence(platform);
            }

            const optimizePrompt = `
AWARENESS AGENT EMERGENCY OPTIMIZATION.
Current reach ${totalReach} is only ${Math.round((totalReach / targetReach) * 100)}% of target.

STRATEGY: ${JSON.stringify(strategy)}
PLATFORM INTELLIGENCE: ${JSON.stringify(platformIntel)}
TRENDING TOPICS: ${JSON.stringify(trends)}

What IMMEDIATE format or content pivot will 3-5x our organic reach this week?
Be specific: name exact content formats, hooks, posting times, and hashtag strategies.

Return JSON:
{
  "problem": "string",
  "thinking": "detailed algorithm analysis",
  "action": "Specific pivot instruction for the agent",
  "format_change": "e.g. switch from static posts to Reels",
  "hook_strategy": "specific hook formula",
  "impact_score": 0.0
}
`;
            const response = await this.ai.generateStrategy({}, optimizePrompt);
            const intervention = response.parsedJson;

            if (intervention?.action) {
                await this.logIntervention({
                    strategyId,
                    problem: intervention.problem,
                    action: intervention.action,
                    thinking: intervention.thinking,
                    impactScore: intervention.impact_score || 0.6,
                    intelligence: { reach_gap: targetReach - totalReach, trends }
                });

                await this.supabase.from('strategies').update({
                    current_execution_plan: {
                        ...(strategy.current_execution_plan || {}),
                        instruction_override: `${intervention.format_change}. ${intervention.hook_strategy}`,
                        override_timestamp: new Date().toISOString()
                    }
                }).eq('id', strategyId);

                // Schedule a blitz post immediately
                await this.supabase.from('agent_tasks').insert({
                    strategy_id: strategyId,
                    user_id: userId,
                    agent_type: 'AWARENESS',
                    task_type: 'HASHTAG_CAMPAIGN',
                    platform: (strategy.platforms || ['facebook'])[0],
                    scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                    status: 'pending',
                    content: {
                        body: `INTERVENTION POST — ${intervention.hook_strategy}`,
                        image_prompt: `High-impact ${strategy.platforms?.[0]} post for awareness campaign`,
                        hashtags: trends.slice(0, 10)
                    }
                });

                this.log(`Awareness intervention scheduled: ${intervention.action}`);
            }
        }
    }
}
