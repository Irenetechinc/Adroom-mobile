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

        const liveContext = {
            strategyId: params.strategyId,
            goal: 'awareness',
            durationDays: params.durationDays,
            product: params.product,
            strategy: params.strategy,
            selectedPlatforms: Array.isArray(params.platforms) ? params.platforms : [],
            trends,
            platformIntel,
            generatedAt: new Date().toISOString(),
        };

        const planPrompt = `
You are Adirum AI’s AWARENESS agent.

Use the live runtime context only. Never assume a fixed platform, fixed duration, fixed start time, fixed day buckets, or a canned content formula.

RUNTIME CONTEXT:
${JSON.stringify(liveContext, null, 2)}

Build the reach campaign using the exact product, strategy, selected platforms, real audience signals, live trends, and platform intelligence provided above.

Constraints:
- Use only the selectedPlatforms from the runtime context.
- Decide timing and sequence based on the actual live data and the exact durationDays value.
- Do not inject static platform rules or fixed day ranges.
- Return valid JSON only.

Schema:
{
  "campaign_theme": "string",
  "viral_hooks": ["hook 1"],
  "daily_tasks": [
    {
      "day": 1,
      "platform": "selected-platform-name",
      "task_type": "REEL",
      "hour": 7,
      "minute": 0,
      "headline": "string",
      "body": "string",
      "image_prompt": "string",
      "hashtags": ["tag1"],
      "cta": "string",
      "virality_hook": "string",
      "algorithm_exploit": "string"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        let plan: any = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            const retryPrompt = `
You are Adirum AI’s AWARENESS agent.

Use the live strategy, live product, selected platforms, and current intelligence only. Do not assume fixed platform names, fixed day buckets, or static timing.

RUNTIME CONTEXT:
${JSON.stringify({
    strategyId: params.strategyId,
    durationDays: params.durationDays,
    product: params.product,
    strategy: params.strategy,
    selectedPlatforms: Array.isArray(params.platforms) ? params.platforms : [],
    generatedAt: new Date().toISOString(),
}, null, 2)}

Return valid JSON only with this schema:
{
  "campaign_theme": "string",
  "viral_hooks": ["string"],
  "daily_tasks": [{ "day": 1, "platform": "selected-platform-name", "task_type": "REEL", "hour": 7, "minute": 0, "headline": "string", "body": "string", "image_prompt": "string", "hashtags": ["tag"], "cta": "string", "virality_hook": "string", "algorithm_exploit": "string" }]
}
`;
            const retry = await this.ai.generateStrategy({}, retryPrompt);
            const retryPlan = retry.parsedJson;
            if (!retryPlan?.daily_tasks?.length) {
                const fallbackTasks = this.buildDynamicFallbackTasks({
                    strategyId: params.strategyId,
                    userId: params.userId,
                    strategy: params.strategy,
                    product: params.product,
                    platforms: params.platforms,
                    durationDays: params.durationDays,
                    goalLabel: 'Awareness',
                });
                const { error } = await this.supabase.from('agent_tasks').insert(fallbackTasks.map((task) => ({ ...task, status: 'pending' })));
                if (error) throw new Error(`AWARENESS task generation failed and fallback scheduling also failed: ${error.message}`);
                this.log(`AWARENESS: inserted ${fallbackTasks.length} fallback tasks from live product/platform context`);
                return;
            }
            plan = retryPlan;
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

            // ── Fetch ALL 4 intelligence streams in parallel ──────────────────
            const [{ platformIntel, socialData, emotionalData, geoData }, trends] = await Promise.all([
                this.fetchLiveIntelligence({
                    platform: task.platform,
                    category: product?.category || 'general',
                    productName: product?.product_name || product?.name || '',
                }),
                this.getTrendingTopics(product?.category || 'general'),
            ]);

            // Brain override from last intelligence cycle (if any)
            const { data: strategyRow } = await this.supabase
                .from('strategies')
                .select('current_execution_plan')
                .eq('id', task.strategy_id)
                .single();
            const brainOverride: string | undefined = strategyRow?.current_execution_plan?.brain_instruction_override;

            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'AWARENESS',
                product,
                context: `${task.content.headline || ''} ${task.content.body}`,
                taskType: task.task_type,
                dayNumber: 1,
                totalDays: 30,
                trends,
                platformIntel,
                socialData,
                emotionalData,
                instructionOverride: [
                    task.content.virality_hook
                        ? `Virality hook: ${task.content.virality_hook}. Algorithm target: ${task.content.algorithm_exploit}`
                        : undefined,
                    brainOverride,
                    geoData.length ? `GEO narrative gaps: ${geoData.map((g: any) => g.missing_claims?.slice(0, 2)?.join(', ')).filter(Boolean).join(' | ')}` : undefined,
                ].filter(Boolean).join(' | ') || undefined,
            });

            const hashtags = (finalContent.hashtags || []).slice(0, 20).map((h: string) => `#${h}`).join(' ');
            const body = `${finalContent.headline}\n\n${finalContent.body}\n\n${hashtags}`;

            // Generate a unique, platform-optimized graphic via GraphicsDesignerAgent
            let postImageUrl: string | undefined;
            if (task.platform !== 'twitter' && task.platform !== 'x' && task.platform !== 'tiktok') {
                try {
                    const { graphicsDesignerAgent } = await import('./graphicsDesignerAgent');
                    postImageUrl = await graphicsDesignerAgent.getImageForPost({
                        userId: task.user_id,
                        productId: task.strategies?.product_id,
                        strategyId: task.strategy_id,
                        platform: task.platform,
                        goal: 'AWARENESS',
                        agentType: 'AWARENESS',
                        headline: finalContent.headline,
                        body: finalContent.body,
                        hashtags: finalContent.hashtags,
                        cta: finalContent.cta,
                        taskType: task.task_type,
                        dayNumber: task.content?.day_number,
                        product,
                    });
                    if (postImageUrl) this.log(`Graphic generated for ${task.platform} post — ${postImageUrl.split('/').pop()}`);
                } catch (e: any) {
                    this.log(`GraphicsDesignerAgent failed (non-fatal): ${e.message}`);
                }
            }

            let result;
            if (task.platform === 'facebook' && tokens.facebook) {
                result = await this.publishToplatform(task.platform, tokens, body, postImageUrl);
            } else if (task.platform === 'instagram' && tokens.instagram) {
                if (!postImageUrl) throw new Error('Instagram requires an image — GraphicsDesignerAgent must provide one');
                result = await this.publishToplatform(task.platform, tokens, body, postImageUrl);
            } else if (task.platform === 'twitter' && tokens.twitter) {
                result = await this.publishToplatform(task.platform, tokens, body.slice(0, 280));
            } else if (task.platform === 'linkedin' && tokens.linkedin) {
                result = await this.publishToplatform(task.platform, tokens, body);
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

                result = await this.publishToplatform(task.platform, tokens, body, tiktokVideoUrl);
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
                    await this.publishToplatform(platform, tokens, body);
                } else if (platform === 'instagram' && tokens.instagram) {
                    await this.publishToplatform(platform, tokens, body);
                } else if (platform === 'twitter' && tokens.twitter) {
                    await this.publishToplatform(platform, tokens, body.slice(0, 280));
                } else if (platform === 'linkedin' && tokens.linkedin) {
                    await this.publishToplatform(platform, tokens, body);
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
                const selectedPlatform = (strategy.platforms || [])[0];
                if (!selectedPlatform) return;
                await this.supabase.from('agent_tasks').insert({
                    strategy_id: strategyId,
                    user_id: userId,
                    agent_type: 'AWARENESS',
                    task_type: 'HASHTAG_CAMPAIGN',
                    platform: selectedPlatform,
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
