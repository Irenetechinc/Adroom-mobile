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

        const planPrompt = `
You are the AdRoom PROMOTION Agent. Create a ${params.durationDays}-day ORGANIC PROMOTION campaign.

PRODUCT: ${JSON.stringify(params.product)}
STRATEGY: ${JSON.stringify(params.strategy)}
PLATFORMS: ${JSON.stringify(params.platforms)}
TRENDING TOPICS: ${JSON.stringify(trends)}
EMOTIONAL OWNERSHIP DATA: ${JSON.stringify(emotionalOwnership)}

PROMOTION AGENT MANDATE:
- Drive ENGAGEMENT and OFFER UPTAKE through organic FOMO and scarcity
- NO paid ads — create psychological urgency through organic storytelling
- Days 1-3: "Problem Agitation" — make the audience feel the PAIN your offer solves
- Days 4-7: "Solution Reveal" — introduce your offer as THE answer
- Days 8-12: FOMO Ignition — limited time, limited availability, social proof
- Days 13+: Urgency Finale — countdown, last chance, testimonials

PROMOTION TACTICS:
- Countdown posts (7 days to go, 3 days left, LAST DAY)
- Social proof posts (testimonials, results, before/after)
- Scarcity posts (limited availability, exclusive offer)
- Community challenge posts (encourages UGC)
- Emotional trigger posts (tap into the dominant emotion for the category)

Task types: POST, STORY, COUNTDOWN_POST, TESTIMONIAL_REQUEST, GIVEAWAY_TEASE, OFFER_REVEAL

Return JSON:
{
  "campaign_theme": "string",
  "offer_hook": "The core offer statement",
  "emotional_trigger": "Primary emotion to activate",
  "daily_tasks": [
    {
      "day": 1,
      "platform": "facebook",
      "task_type": "POST",
      "hour": 10,
      "minute": 0,
      "headline": "string",
      "body": "Post ready to publish",
      "image_prompt": "Imagen 3 prompt",
      "hashtags": ["tag1"],
      "cta": "string",
      "promo_phase": "problem_agitation|solution_reveal|fomo_ignition|urgency_finale",
      "emotional_trigger": "curiosity|fear_of_missing_out|excitement|trust"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        const plan = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            await this.buildSkill({
                problem: 'Promotion plan returned empty tasks',
                context: `Product: ${params.product?.name}, Platforms: ${params.platforms.join(', ')}`,
                strategyId: params.strategyId
            });
            return;
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

            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'PROMOTION',
                product,
                context: `${task.content.headline || ''} ${task.content.body}`,
                taskType: task.task_type,
                dayNumber: 1,
                totalDays: 30,
                instructionOverride: [
                    `Promo phase: ${task.content.promo_phase}`,
                    `Emotional trigger: ${task.content.emotional_trigger}`,
                    `Offer hook: ${offerHook}`
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
