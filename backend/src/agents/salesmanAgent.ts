import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase, AgentTokens } from './agentBase';
import { AIEngine } from '../config/ai-models';

export class SalesmanAgent extends AgentBase {
    constructor(supabase: SupabaseClient) {
        super(supabase, 'SALESMAN');
    }

    /**
     * PLAN: Generate full sales content calendar for the entire campaign duration.
     * Posts go in agent_tasks with exact scheduled_at timestamps.
     */
    async plan(params: {
        strategyId: string;
        userId: string;
        strategy: any;
        product: any;
        platforms: string[];
        durationDays: number;
    }): Promise<void> {
        this.log(`Planning ${params.durationDays}-day SALES campaign for strategy ${params.strategyId}`);

        const trends = await this.getTrendingTopics(params.product?.category || 'general');
        const platformIntel: Record<string, any> = {};
        for (const platform of params.platforms) {
            platformIntel[platform] = await this.getLatestPlatformIntelligence(platform);
        }

        const planPrompt = `
You are the AdRoom SALESMAN Agent. Create a detailed ${params.durationDays}-day sales campaign execution plan.

PRODUCT: ${JSON.stringify(params.product)}
STRATEGY: ${JSON.stringify(params.strategy)}
PLATFORMS: ${JSON.stringify(params.platforms)}
TRENDS: ${JSON.stringify(trends)}
PLATFORM INTELLIGENCE: ${JSON.stringify(platformIntel)}

SALES AGENT MANDATE:
- Every piece of content must drive toward CONVERSION — sign-ups, purchases, DMs, link clicks
- Day 1-3: Trust building (social proof, testimonials, problem awareness)
- Day 4-7: Desire creation (demo, benefits, transformation)
- Day 8-14: Urgency + offer (CTA-heavy, limited availability)
- Day 15+: Retargeting engaged users, lead follow-up sequences

Create a specific post for EACH DAY per PLATFORM (max 3 platforms × days).
Each task type must be one of: POST, REEL, STORY, DM_BLAST, THREAD, HASHTAG_CAMPAIGN

Return JSON:
{
  "campaign_theme": "string",
  "daily_tasks": [
    {
      "day": 1,
      "platform": "facebook",
      "task_type": "POST",
      "hour": 9,
      "minute": 0,
      "headline": "string",
      "body": "Ready-to-publish post text",
      "image_prompt": "Imagen 3 prompt",
      "hashtags": ["tag1"],
      "cta": "string",
      "sales_tactic": "social_proof|urgency|benefit|demo|offer"
    }
  ]
}
`;
        const response = await this.ai.generateStrategy({}, planPrompt);
        const plan = response.parsedJson;

        if (!plan?.daily_tasks?.length) {
            this.log('Plan generation returned empty tasks — building skill to handle this');
            await this.buildSkill({
                problem: 'Sales plan generation returned empty tasks',
                context: `Product: ${params.product?.name}, Platforms: ${params.platforms.join(', ')}`,
                strategyId: params.strategyId
            });
            return;
        }

        const now = new Date();
        const tasksToSchedule = [];

        for (const task of plan.daily_tasks) {
            const scheduleDate = new Date(now);
            scheduleDate.setDate(scheduleDate.getDate() + (task.day - 1));
            scheduleDate.setHours(task.hour || 9, task.minute || 0, 0, 0);

            tasksToSchedule.push({
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: 'SALESMAN' as const,
                task_type: task.task_type || 'POST',
                platform: task.platform,
                scheduled_at: scheduleDate.toISOString(),
                content: {
                    headline: task.headline,
                    body: task.body,
                    image_prompt: task.image_prompt,
                    hashtags: task.hashtags || [],
                    cta: task.cta,
                    sales_tactic: task.sales_tactic
                }
            });
        }

        // Batch insert all tasks
        const { error } = await this.supabase.from('agent_tasks').insert(
            tasksToSchedule.map(t => ({ ...t, status: 'pending' }))
        );

        if (error) {
            this.log(`Failed to schedule tasks: ${error.message}`);
        } else {
            this.log(`Scheduled ${tasksToSchedule.length} SALES tasks across ${params.durationDays} days`);
        }

        // Mark strategy as active
        await this.supabase.from('strategies').update({
            is_active: true,
            agent_type: 'SALESMAN',
            current_execution_plan: { campaign_theme: plan.campaign_theme, total_tasks: tasksToSchedule.length }
        }).eq('id', params.strategyId);
    }

    /**
     * EXECUTE: Run a single pending task — generate final content and publish it.
     */
    async executeTask(taskId: string): Promise<void> {
        const { data: task, error } = await this.supabase
            .from('agent_tasks')
            .select('*, strategies(product_id, goal, user_id)')
            .eq('id', taskId)
            .single();

        if (error || !task) {
            this.log(`Task ${taskId} not found: ${error?.message}`);
            return;
        }

        this.log(`Executing SALESMAN task ${taskId} — ${task.task_type} on ${task.platform}`);

        await this.supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', taskId);

        try {
            const tokens = await this.getTokens(task.user_id);
            const product = await this.getProductDetails(task.strategies?.product_id);

            // Generate polished final content using the stored content plan + latest intelligence
            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'SALES',
                product,
                context: `${task.content.headline || ''} ${task.content.body}`,
                taskType: task.task_type,
                dayNumber: 1,
                totalDays: 30,
                instructionOverride: task.content.sales_tactic
                    ? `Apply ${task.content.sales_tactic} sales tactic`
                    : undefined
            });

            const publishBody = `${finalContent.headline}\n\n${finalContent.body}\n\n${(finalContent.hashtags || []).map((h: string) => `#${h}`).join(' ')}`;

            let result;
            if (task.platform === 'facebook' && tokens.facebook) {
                result = await this.publishToFacebook(tokens.facebook, publishBody);
            } else if (task.platform === 'instagram' && tokens.instagram) {
                result = await this.publishToInstagram(tokens.instagram, publishBody);
            } else if (task.platform === 'twitter' && tokens.twitter) {
                result = await this.publishToTwitter(tokens.twitter, publishBody.slice(0, 280));
            } else if (task.platform === 'linkedin' && tokens.linkedin) {
                result = await this.publishToLinkedIn(tokens.linkedin, publishBody);
            } else if (task.platform === 'tiktok' && tokens.tiktok) {
                let tiktokVideoUrl: string | undefined = task.content?.video_url;

                if (!tiktokVideoUrl) {
                    // Step 1: check if strategy has a user-supplied video URL
                    const { data: strategyData } = await this.supabase
                        .from('strategies')
                        .select('current_execution_plan, product_id')
                        .eq('id', task.strategy_id)
                        .single();

                    tiktokVideoUrl = strategyData?.current_execution_plan?.user_video_url;

                    if (!tiktokVideoUrl) {
                        // Step 2: auto-generate a TikTok video from product details
                        this.log(`TikTok task ${taskId}: no video found — auto-generating from product details...`);
                        const creative = new (await import('../services/creativeService')).CreativeService();
                        const product = await this.getProductDetails(strategyData?.product_id || task.content?.product_id);
                        tiktokVideoUrl = await creative.generateTikTokVideo(product || { name: 'Product', description: '' }) || undefined;
                    }

                    if (!tiktokVideoUrl) {
                        // Fallback: reschedule if generation also failed
                        this.log(`TikTok task ${taskId}: video generation failed — rescheduling in 30 min.`);
                        await this.supabase.from('agent_tasks').update({
                            status: 'pending',
                            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                            notes: 'Video generation failed — will retry in 30 minutes',
                        }).eq('id', taskId);
                        return;
                    }

                    // Cache the generated URL back into the task so next runs reuse it
                    await this.supabase.from('agent_tasks').update({
                        content: { ...task.content, video_url: tiktokVideoUrl },
                    }).eq('id', taskId);

                    this.log(`TikTok task ${taskId}: video ready — ${tiktokVideoUrl}`);
                }

                result = await this.publishToTikTok(tokens.tiktok, publishBody, tiktokVideoUrl);
            } else {
                throw new Error(`No token available for platform: ${task.platform}`);
            }

            await this.completeTask(taskId, { ...result, final_content: finalContent });
            this.log(`Task ${taskId} published — post ID: ${result?.platform_post_id}`);

            // Schedule lead scanning 2 hours after post (check who engaged)
            await this.scheduleLeadScan({
                strategyId: task.strategy_id,
                userId: task.user_id,
                platform: task.platform,
                postId: result?.platform_post_id,
                taskId
            });

        } catch (err: any) {
            this.log(`Task ${taskId} failed: ${err.message}`);
            await this.failTask(taskId, err.message);
        }
    }

    /**
     * LEAD SCAN: After a post goes live, scan commenters for high-intent signals
     */
    async scanForLeads(params: {
        strategyId: string;
        userId: string;
        platform: string;
        postId: string;
        tokens: AgentTokens;
    }): Promise<void> {
        if (params.platform === 'facebook' && params.tokens.facebook) {
            this.log(`Scanning Facebook post ${params.postId} for sales leads`);
            try {
                const resp = await fetch(
                    `https://graph.facebook.com/v19.0/${params.postId}/comments?fields=id,message,from&access_token=${params.tokens.facebook.access_token}`
                );
                if (!resp.ok) return;

                const data: any = await resp.json();
                const comments = data?.data || [];

                for (const comment of comments) {
                    const intentScore = await this.scoreIntent(comment.message);
                    if (intentScore >= 0.6) {
                        await this.supabase.from('agent_leads').upsert({
                            strategy_id: params.strategyId,
                            user_id: params.userId,
                            platform: params.platform,
                            platform_user_id: comment.from?.id,
                            platform_username: comment.from?.name,
                            first_interaction: comment.message,
                            intent_score: intentScore,
                            intent_signals: [{ source: 'comment', text: comment.message, score: intentScore }],
                            stage: 'identified',
                            next_followup_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
                        }, { onConflict: 'user_id,platform,platform_user_id' });

                        this.log(`High-intent lead identified: ${comment.from?.name} (score: ${intentScore})`);
                    }
                }
            } catch (err: any) {
                this.log(`Facebook lead scan failed: ${err.message}`);
            }
            return;
        }

        if (params.platform === 'tiktok' && params.tokens.tiktok) {
            this.log(`Scanning TikTok video ${params.postId} for leads`);
            try {
                const leads = await this.scanTikTokLeads(params.tokens.tiktok, params.postId);
                for (const lead of leads) {
                    const bioScore = await this.scoreIntent(lead.bio_description || '');
                    const intentScore = Math.max(0.4, bioScore); // commenters are warm by default
                    await this.supabase.from('agent_leads').upsert({
                        strategy_id: params.strategyId,
                        user_id: params.userId,
                        platform: 'tiktok',
                        platform_user_id: lead.open_id,
                        platform_username: lead.display_name,
                        first_interaction: lead.bio_description || 'Commented on TikTok video',
                        intent_score: intentScore,
                        intent_signals: [{ source: 'tiktok_comment', display_name: lead.display_name, score: intentScore }],
                        stage: 'identified',
                        next_followup_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
                    }, { onConflict: 'user_id,platform,platform_user_id' });

                    this.log(`TikTok lead identified: ${lead.display_name}`);
                }
            } catch (err: any) {
                this.log(`TikTok lead scan failed: ${err.message}`);
            }
            return;
        }

        this.log(`Lead scan skipped — unsupported platform: ${params.platform}`);
    }

    private async scoreIntent(text: string): Promise<number> {
        const prompt = `
Score the PURCHASE INTENT of this social media comment on a scale 0.0 to 1.0.
High intent signals: asking price, "where to buy", "how to order", "DM me", "interested", "want this".
Low intent signals: casual comment, joke, unrelated.

Comment: "${text}"
Return JSON: { "intent_score": 0.0 }
`;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson?.intent_score || 0;
    }

    private async scheduleLeadScan(params: {
        strategyId: string;
        userId: string;
        platform: string;
        postId: string | undefined;
        taskId: string;
    }): Promise<void> {
        if (!params.postId) return;

        await this.supabase.from('agent_tasks').insert({
            strategy_id: params.strategyId,
            user_id: params.userId,
            agent_type: 'SALESMAN',
            task_type: 'LEAD_SCAN',
            platform: params.platform,
            scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            content: { post_id: params.postId, parent_task_id: params.taskId },
            status: 'pending'
        });
    }

    /**
     * LEAD FOLLOWUP: Send personalized DMs to hot leads
     */
    async followUpLeads(userId: string): Promise<void> {
        const now = new Date().toISOString();

        const { data: leads } = await this.supabase
            .from('agent_leads')
            .select('*')
            .eq('user_id', userId)
            .in('stage', ['identified', 'engaged', 'nurturing'])
            .lte('next_followup_at', now)
            .order('intent_score', { ascending: false })
            .limit(10);

        if (!leads?.length) return;

        const tokens = await this.getTokens(userId);

        for (const lead of leads) {
            try {
                const dmPrompt = `
Generate a personalized, conversational DM to a potential customer on ${lead.platform}.
Their first interaction was: "${lead.first_interaction}"
Intent score: ${lead.intent_score}
DM sequence step: ${lead.dm_sequence_step + 1}

The message must feel human and natural, NOT salesy. Max 3 sentences.
Step 1: Acknowledge their interest + add value
Step 2: Soft offer / invite
Step 3: Create mild urgency

Return JSON: { "message": "string" }
`;
                const response = await this.ai.generateStrategy({}, dmPrompt);
                const message = response.parsedJson?.message;
                if (!message) continue;

                if (lead.platform === 'facebook' && tokens.facebook) {
                    await this.sendFacebookDM(tokens.facebook, lead.platform_user_id, message);
                }

                await this.supabase.from('agent_leads').update({
                    stage: lead.dm_sequence_step >= 2 ? 'nurturing' : 'engaged',
                    dm_sequence_step: lead.dm_sequence_step + 1,
                    last_contacted_at: now,
                    next_followup_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }).eq('id', lead.id);

                this.log(`DM sent to ${lead.platform_username} (step ${lead.dm_sequence_step + 1})`);
            } catch (err: any) {
                this.log(`Follow-up failed for lead ${lead.id}: ${err.message}`);
            }
        }
    }

    /**
     * OPTIMIZE: Compare real performance to targets, intervene if behind
     */
    async optimizeStrategy(strategyId: string, userId: string): Promise<void> {
        const { data: strategy } = await this.supabase
            .from('strategies')
            .select('*, agent_interventions(*)')
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
        const totalConversions = (perf || []).reduce((sum: number, p: any) => sum + (p.conversions || 0), 0);
        const targetReach = strategy.estimated_outcomes?.reach || 10000;

        if (totalReach < targetReach * 0.3) {
            this.log(`SALES performance below threshold — triggering optimization`);

            const trends = await this.getTrendingTopics(strategy.product_memory?.category || 'general');

            const optimizePrompt = `
You are the SALESMAN Agent. SALES PERFORMANCE IS BELOW TARGET. Devise an emergency intervention.

CURRENT REACH: ${totalReach} (target: ${targetReach})
CONVERSIONS: ${totalConversions}
RECENT PERFORMANCE: ${JSON.stringify((perf || []).slice(0, 5))}
TRENDS: ${JSON.stringify(trends)}

What specific action will IMMEDIATELY boost conversion rate? Be very specific about the content change.

Return JSON:
{
  "problem": "string",
  "thinking": "string",
  "action": "string",
  "new_content_direction": "string",
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
                    impactScore: intervention.impact_score || 0.5,
                    intelligence: { performance: perf?.slice(0, 3) }
                });

                await this.supabase.from('strategies').update({
                    current_execution_plan: {
                        ...(strategy.current_execution_plan || {}),
                        instruction_override: intervention.new_content_direction,
                        override_timestamp: new Date().toISOString()
                    }
                }).eq('id', strategyId);

                this.log(`Intervention applied: ${intervention.action}`);
            }
        }
    }
}
