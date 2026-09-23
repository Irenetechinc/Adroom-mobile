import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase } from './agentBase';
import { AIEngine } from '../config/ai-models';

export class PromotionAgent extends AgentBase {
    constructor(supabase: SupabaseClient) {
        super(supabase, 'PROMOTION');
    }

    /**
     * PLAN: Create FOMO-driven promo content calendar with countdown sequences and offer amplification
     */
    async plan(params: {
        strategyId: string;
        userId: string;
        strategy: any;
        product: any;
        platforms: string[];
        durationDays: number;
    }): Promise<void> {
        this.log(`Planning ${params.durationDays}-day PROMOTION campaign for strategy ${params.strategyId}`);

        const trends = await this.getTrendingTopics(params.product?.category || 'general');
        const emotionalOwnership = await this.getEmotionalOwnership(params.product?.category || 'general');

        const liveContext = {
            strategyId: params.strategyId,
            goal: 'promotion',
            durationDays: params.durationDays,
            product: params.product,
            strategy: params.strategy,
            selectedPlatforms: Array.isArray(params.platforms) ? params.platforms : [],
            trends,
            emotionalOwnership,
            generatedAt: new Date().toISOString(),
        };

        const planPrompt = `
You are Adirum AI’s PROMOTION agent.

Use the live runtime context only. Never assume fixed day segments, fixed platforms, or a prebuilt urgency formula.

RUNTIME CONTEXT:
${JSON.stringify(liveContext, null, 2)}

Build the promotion plan from the actual product, strategy, current platform signals, real emotional ownership data, and selected platforms supplied above.

Constraints:
- Only use the selectedPlatforms list.
- Align the sequence to the actual durationDays and real-time offer/emotional evidence.
- Do not hardcode platform names or fixed hour/day rules.
- Return valid JSON only.

Schema:
{
  "campaign_theme": "string",
  "offer_hook": "string",
  "emotional_trigger": "string",
  "daily_tasks": [
    {
      "day": 1,
      "platform": "selected-platform-name",
      "task_type": "POST",
      "hour": 10,
      "minute": 0,
      "headline": "string",
      "body": "string",
      "image_prompt": "string",
      "hashtags": ["tag1"],
      "cta": "string",
      "promo_phase": "problem_agitation|solution_reveal|fomo_ignition|urgency_finale",
      "emotional_trigger": "curiosity|fear_of_missing_out|excitement|trust"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        let plan: any = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            const retryPrompt = `
You are Adirum AI’s PROMOTION agent.

Use the live product, offer details, selected platforms, and current emotional signal data only. Do not assume fixed platform names or fixed time/day buckets.

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
  "offer_hook": "string",
  "emotional_trigger": "string",
  "daily_tasks": [{ "day": 1, "platform": "selected-platform-name", "task_type": "POST", "hour": 10, "minute": 0, "headline": "string", "body": "string", "image_prompt": "string", "hashtags": ["tag"], "cta": "string", "promo_phase": "problem_agitation|solution_reveal|fomo_ignition|urgency_finale", "emotional_trigger": "fear_of_missing_out|trust|curiosity|excitement" }]
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
                    goalLabel: 'Promotion',
                });
                const { error } = await this.supabase.from('agent_tasks').insert(fallbackTasks.map((task) => ({ ...task, status: 'pending' })));
                if (error) throw new Error(`PROMOTION task generation failed and fallback scheduling also failed: ${error.message}`);
                this.log(`PROMOTION: inserted ${fallbackTasks.length} fallback tasks from live product/platform context`);
                return;
            }
            plan = retryPlan;
        }

        const now = new Date();
        const tasks = plan.daily_tasks.map((task: any) => {
            const scheduleDate = new Date(now);
            scheduleDate.setDate(scheduleDate.getDate() + (task.day - 1));
            scheduleDate.setHours(task.hour || 10, task.minute || 0, 0, 0);

            return {
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: 'PROMOTION',
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
                    promo_phase: task.promo_phase,
                    emotional_trigger: task.emotional_trigger
                }
            };
        });

        const { error } = await this.supabase.from('agent_tasks').insert(tasks);
        if (error) this.log(`Schedule error: ${error.message}`);
        else this.log(`Scheduled ${tasks.length} PROMOTION tasks`);

        await this.supabase.from('strategies').update({
            is_active: true,
            agent_type: 'PROMOTION',
            current_execution_plan: {
                campaign_theme: plan.campaign_theme,
                offer_hook: plan.offer_hook,
                emotional_trigger: plan.emotional_trigger,
                total_tasks: tasks.length
            }
        }).eq('id', params.strategyId);

        // Schedule Google Maps business discovery as part of the promotion goal —
        // finds local businesses that could be reached with the offer / promo,
        // regardless of whether the strategy is for a product, brand, or service.
        const gmapsTasks = await this.scheduleGoogleMapsOutreachTasks({
            strategyId: params.strategyId,
            userId: params.userId,
            product: params.product,
            strategy: params.strategy,
            agentType: 'PROMOTION',
            durationDays: params.durationDays,
        });
        if (gmapsTasks > 0) {
            this.log(`PROMOTION: scheduled ${gmapsTasks} Google Maps outreach tasks to amplify offer reach`);
        }
    }

    /**
     * EXECUTE: Publish a promotion task with emotion-calibrated content
     */
    async executeTask(taskId: string): Promise<void> {
        const { data: task } = await this.supabase
            .from('agent_tasks')
            .select('*, strategies(product_id, goal, current_execution_plan)')
            .eq('id', taskId)
            .single();

        if (!task) return;

        this.log(`Executing PROMOTION task ${taskId} — ${task.task_type} (${task.content.promo_phase})`);
        await this.supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', taskId);

        try {
            const tokens = await this.getTokens(task.user_id);
            const product = await this.getProductDetails(task.strategies?.product_id);
            const offerHook = task.strategies?.current_execution_plan?.offer_hook || '';

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
                goal: 'PROMOTION',
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
                    `Promo phase: ${task.content.promo_phase}`,
                    `Emotional trigger: ${task.content.emotional_trigger}`,
                    `Offer hook: ${offerHook}`,
                    brainOverride,
                    geoData.length ? `GEO: ${geoData.map((g: any) => g.missing_claims?.slice(0, 1)?.join(', ')).filter(Boolean).join(' | ')}` : undefined,
                ].filter(Boolean).join('. ') || undefined,
            });

            const hashtags = (finalContent.hashtags || []).slice(0, 15).map((h: string) => `#${h}`).join(' ');
            const body = `${finalContent.headline}\n\n${finalContent.body}\n\n${hashtags}`;

            // Generate a unique, urgency-optimized graphic via GraphicsDesignerAgent
            let postImageUrl: string | undefined;
            if (task.platform !== 'twitter' && task.platform !== 'x' && task.platform !== 'tiktok') {
                try {
                    const { graphicsDesignerAgent } = await import('./graphicsDesignerAgent');
                    postImageUrl = await graphicsDesignerAgent.getImageForPost({
                        userId: task.user_id,
                        productId: task.strategies?.product_id,
                        strategyId: task.strategy_id,
                        platform: task.platform,
                        goal: 'PROMOTION',
                        agentType: 'PROMOTION',
                        headline: finalContent.headline,
                        body: finalContent.body,
                        hashtags: finalContent.hashtags,
                        cta: finalContent.cta,
                        taskType: task.task_type,
                        dayNumber: task.content?.day_number,
                        product,
                    });
                    if (postImageUrl) this.log(`Promotion graphic generated — ${postImageUrl.split('/').pop()}`);
                } catch (e: any) {
                    throw new Error(`GraphicsDesignerAgent failed: ${e.message}`);
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
            } else {
                throw new Error(`No token for platform: ${task.platform}`);
            }

            await this.completeTask(taskId, { ...result, final_content: finalContent });
            this.log(`PROMOTION post published — ${result?.platform_post_id}`);

        } catch (err: any) {
            this.log(`PROMOTION task ${taskId} failed: ${err.message}`);
            await this.failTask(taskId, err.message);
        }
    }

    /**
     * URGENCY ESCALATION: When engagement drops, escalate urgency tone and frequency
     */
    async escalateUrgency(params: {
        strategyId: string;
        userId: string;
        currentEngagement: number;
        targetEngagement: number;
        daysRemaining: number;
    }): Promise<void> {
        this.log(`Escalating urgency — engagement at ${params.currentEngagement}/${params.targetEngagement}`);

        const urgencyPrompt = `
PROMOTION AGENT: Engagement is at ${Math.round((params.currentEngagement / params.targetEngagement) * 100)}% of target with ${params.daysRemaining} days remaining.

Create 3 URGENT ESCALATION posts to immediately boost engagement.
These must create strong FOMO and emotional urgency without being aggressive.

Return JSON:
{
  "escalation_strategy": "string",
  "posts": [
    {
      "platform": "facebook",
      "content": "Post text",
      "urgency_level": "medium|high|critical",
      "publish_in_hours": 1
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, urgencyPrompt);
        const escalation = response.parsedJson;

        if (!escalation?.posts?.length) return;

        for (const post of escalation.posts) {
            await this.supabase.from('agent_tasks').insert({
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: 'PROMOTION',
                task_type: 'URGENCY_POST',
                platform: post.platform || 'facebook',
                scheduled_at: new Date(Date.now() + (post.publish_in_hours || 1) * 60 * 60 * 1000).toISOString(),
                status: 'pending',
                content: {
                    body: post.content,
                    emotional_trigger: 'fear_of_missing_out',
                    promo_phase: 'urgency_finale',
                    urgency_level: post.urgency_level
                }
            });
        }

        this.log(`Scheduled ${escalation.posts.length} urgency escalation posts`);
    }

    /**
     * OPTIMIZE: If engagement below target, add urgency escalation and analyze what's not resonating
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

        const totalEngagement = (perf || []).reduce((sum: number, p: any) =>
            sum + (p.likes || 0) + (p.comments || 0) + (p.shares || 0), 0);
        const targetEngagement = strategy.estimated_outcomes?.engagement || 5000;

        if (totalEngagement < targetEngagement * 0.35) {
            const daysElapsed = Math.round(
                (Date.now() - new Date(strategy.created_at).getTime()) / (1000 * 60 * 60 * 24)
            );
            const daysTotal = strategy.duration || 30;
            const daysRemaining = Math.max(0, daysTotal - daysElapsed);

            await this.escalateUrgency({
                strategyId,
                userId,
                currentEngagement: totalEngagement,
                targetEngagement,
                daysRemaining
            });
        }
    }

    protected async getEmotionalOwnership(category: string): Promise<any[]> {
        const { data } = await this.supabase
            .from('emotional_ownership')
            .select('*')
            .eq('category', category)
            .order('ownership_percentage', { ascending: false })
            .limit(5);
        return data || [];
    }
}
