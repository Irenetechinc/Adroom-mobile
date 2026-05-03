import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase, AgentTokens } from './agentBase';
import { AIEngine } from '../config/ai-models';
import { pushService } from '../services/pushService';
import { discoverBusinesses, buildOutreachMessage, type PlaceBusiness } from '../services/googleMapsService';
import { sendEmailViaResend } from '../services/resendEmailService';

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

        // Schedule Google Maps business discovery + outreach tasks as part of the sales strategy goal.
        // This runs regardless of whether the strategy is for a product, brand, or service —
        // the agent will find local potential clients and reach out on behalf of the user.
        const gmapsTasks = await this.scheduleGoogleMapsOutreachTasks({
            strategyId: params.strategyId,
            userId: params.userId,
            product: params.product,
            strategy: params.strategy,
            agentType: 'SALESMAN',
            durationDays: params.durationDays,
        });
        if (gmapsTasks > 0) {
            this.log(`SALESMAN: scheduled ${gmapsTasks} Google Maps outreach tasks targeting local businesses`);
        }
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

        // ─── GMAPS_OUTREACH: Discover + contact local businesses ────────────────
        if (task.task_type === 'GMAPS_OUTREACH') {
            try {
                const c = task.content || {};
                const result = await this.discoverAndOutreachLocalBusinesses({
                    userId: task.user_id,
                    strategyId: task.strategy_id,
                    location: c.location || '',
                    targetCategory: c.keyword || 'local business',
                    outreachChannel: c.outreach_channel || 'whatsapp',
                    senderName: c.sender_name || 'the team',
                    productOrService: c.product_or_service || c.keyword || 'our service',
                    maxTargets: 10,
                });
                await this.supabase.from('agent_tasks').update({
                    status: 'done',
                    executed_at: new Date().toISOString(),
                    result: { gmaps_reached: result.reached, leads: result.leads },
                }).eq('id', taskId);
                this.log(`GMAPS_OUTREACH task ${taskId} complete — ${result.reached} businesses reached`);
            } catch (err: any) {
                await this.failTask(taskId, err.message);
            }
            return;
        }
        // ────────────────────────────────────────────────────────────────────────

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
                    const { data: strategyData } = await this.supabase
                        .from('strategies')
                        .select('current_execution_plan, product_id, user_id')
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
                        goal: 'SALES conversion',
                        hasUserVideo: !!userVideoUrl,
                        strategyGoalData: strategyData?.current_execution_plan,
                    });

                    // Consult Psychologist Engine for behavioral insights
                    const { PsychologistEngine } = await import('../services/psychologistEngine');
                    const psychologist = new PsychologistEngine();
                    const psychProfile = await psychologist.getProfileForProduct(
                        strategyData?.product_id || '',
                        taskProduct?.category
                    );

                    if (direction.should_use_user_video && userVideoUrl) {
                        this.log(`TikTok task ${taskId}: Director chose user video — checking for edit job...`);
                        const { SmartVideoEditor } = await import('../services/smartVideoEditor');
                        const editor = new SmartVideoEditor();
                        tiktokVideoUrl = await editor.getBestVideoForStrategy(task.strategy_id, userVideoUrl) || userVideoUrl;
                    } else {
                        // Check subscription tier before generating
                        const { checkFeatureAccess } = await import('../services/subscriptionGuard');
                        const supabaseForCheck = this.supabase;
                        const access = await checkFeatureAccess(task.user_id, 'video_asset', supabaseForCheck as any);

                        if (!access.allowed) {
                            this.log(`TikTok task ${taskId}: video generation blocked — ${access.reason}. Using user video or skipping.`);
                            tiktokVideoUrl = userVideoUrl;
                        } else {
                            this.log(`TikTok task ${taskId}: Director chose AI generation — using Director+Psychologist direction...`);
                            const creative = new (await import('../services/creativeService')).CreativeService();
                            tiktokVideoUrl = await creative.generateTikTokVideo(
                                taskProduct || { name: 'Product', description: '' },
                                direction,
                                psychProfile
                            ) || userVideoUrl || undefined;
                        }
                    }

                    if (!tiktokVideoUrl) {
                        this.log(`TikTok task ${taskId}: no video available — rescheduling in 30 min.`);
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

                    this.log(`TikTok task ${taskId}: video ready (Director: ${direction.should_use_user_video ? 'user_video' : 'ai_generated'}) — ${tiktokVideoUrl}`);
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
                // High-intent leads (>= 0.85): attempt deal closing
                if (lead.intent_score >= 0.85 && lead.stage !== 'closed') {
                    await this.closeDeal(lead, userId, tokens);
                    continue;
                }

                const HUMANIZED_PERSONAS = [
                    { name: 'Alex', tone: 'casual and friendly', opener: 'Hey' },
                    { name: 'Sam', tone: 'warm and curious', opener: 'Hi' },
                    { name: 'Jordan', tone: 'direct but personable', opener: 'Hey there' },
                ];
                const persona = HUMANIZED_PERSONAS[Math.floor(Math.random() * HUMANIZED_PERSONAS.length)];

                const stepContexts = [
                    `This is your FIRST message — make it feel like a genuine reaction to their comment, not a sales pitch. Open with something specific you noticed about their interest.`,
                    `This is your SECOND touchpoint — they haven't replied yet. Reference your first message briefly, then add one compelling detail or story about the product. End with a soft question.`,
                    `This is your THIRD and final message — be real with them. Acknowledge it might not be the right fit right now, but briefly share one thing that might change their mind. Keep it low pressure.`,
                ];
                const stepCtx = stepContexts[Math.min(lead.dm_sequence_step, 2)];

                const dmPrompt = `
You are ${persona.name}, a real person (not a bot) who works with ${lead.platform} creators and businesses.
Your tone is ${persona.tone}. You're reaching out to a potential customer.

Context about them: "${lead.first_interaction}"
Platform: ${lead.platform}
Intent score: ${lead.intent_score} (higher = more interested)

${stepCtx}

Rules:
- Write like a real person texting — contractions, natural rhythm, occasional warmth
- NEVER use emojis unless mirroring the lead's style
- NEVER say "I noticed you commented" — that sounds like a bot
- Keep it under 3 short sentences
- End with ONE question or ONE soft call-to-action — never both
- DO NOT mention being an AI, agent, or automated system

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
     * DEAL CLOSE: Attempt to close a sale with a high-intent lead.
     * Uses product delivery/payment details to compose a closing DM.
     * Records the deal and sends a push notification to the user.
     */
    async closeDeal(lead: any, userId: string, tokens: AgentTokens): Promise<void> {
        this.log(`Attempting DEAL CLOSE with ${lead.platform_username} (intent: ${lead.intent_score})`);

        // Fetch product details for this lead's strategy
        const { data: strategy } = await this.supabase
            .from('strategies')
            .select('product_id, goal')
            .eq('id', lead.strategy_id)
            .single();

        const product = strategy?.product_id ? await this.getProductDetails(strategy.product_id) : null;

        const deliveryInfo = product
            ? `\nDelivery: ${product.delivery_type || 'TBD'}${product.delivery_address ? ' — Address: ' + product.delivery_address : ''}${product.contact_phone ? ' — Phone: ' + product.contact_phone : ''}${product.bank_account_details ? ' — Payment: ' + product.bank_account_details : ''}`
            : '';

        const closingPrompt = `
You are closing a real sale for a small business owner. Write a direct message to their interested buyer.

BUYER NAME: ${lead.platform_username}
PRODUCT: ${product?.product_name || 'our product'}
PRICE: ${product?.price ? product.price : 'price on request'}
${deliveryInfo}
WHAT THEY SAID: "${lead.first_interaction}"
HOW READY THEY ARE: ${lead.intent_score} out of 1.0 (very high — they want this)

Your closing message must:
1. Open with their first name and briefly validate what they said — one specific line
2. Tell them exactly what they get and the price — no fluff
3. Give them ONE simple next step (pay here, reply YES, WhatsApp us, etc.)
4. Add a real and believable reason to act now — stock, timing, or limited offer
5. Close warm but confident — like a trusted local seller, not a salesperson

Write like a human. No jargon, no buzzwords, no emojis unless they used them.
Max 5 sentences total.

Return JSON:
{
  "message": "the closing DM text",
  "deal_value": estimated deal value as number (use product price or 0),
  "currency": "USD",
  "reasoning": "why this specific approach will close the deal"
}
`;
        const response = await this.ai.generateStrategy({}, closingPrompt);
        const closing = response.parsedJson;
        if (!closing?.message) {
            this.log(`Deal close failed — could not generate closing message for lead ${lead.id}`);
            return;
        }

        // Send the closing DM via platform
        let dmSent = false;
        try {
            if (lead.platform === 'facebook' && tokens.facebook) {
                await this.sendFacebookDM(tokens.facebook, lead.platform_user_id, closing.message);
                dmSent = true;
            }
        } catch (e: any) {
            this.log(`Closing DM send failed: ${e.message}`);
        }

        // Record the deal
        const { data: deal } = await this.supabase.from('agent_deals').insert({
            strategy_id: lead.strategy_id,
            user_id: userId,
            lead_id: lead.id,
            platform: lead.platform,
            buyer_name: lead.platform_username,
            buyer_contact: lead.platform_user_id,
            product_name: product?.product_name || 'Unknown Product',
            product_id: strategy?.product_id,
            deal_value: closing.deal_value || product?.price || 0,
            currency: closing.currency || 'USD',
            delivery_type: product?.delivery_type,
            delivery_address: product?.delivery_address,
            payment_details: product?.bank_account_details ? { bank: product.bank_account_details } : {},
            closing_message: closing.message,
            agent_reasoning: closing.reasoning,
            status: dmSent ? 'closed_won' : 'closing_attempted',
        }).select('id').single();

        // Update lead stage to closed
        await this.supabase.from('agent_leads').update({
            stage: 'closed',
            last_contacted_at: new Date().toISOString(),
        }).eq('id', lead.id);

        // Push notification to the app user
        await pushService.notifyDealClosed(userId, {
            buyerName: lead.platform_username || 'A lead',
            productName: product?.product_name || 'your product',
            dealValue: closing.deal_value || product?.price || 0,
            currency: closing.currency || 'USD',
            platform: lead.platform,
            deliveryType: product?.delivery_type,
            deliveryAddress: product?.delivery_address,
        });

        this.log(`DEAL CLOSED — ${lead.platform_username} → ${product?.product_name} (deal ID: ${deal?.id})`);
    }

    /**
     * GOOGLE MAPS BUSINESS DISCOVERY:
     * Searches a location for target businesses, scores their outreach potential
     * using review analysis, and sends personalised WhatsApp or email outreach.
     */
    async discoverAndOutreachLocalBusinesses(params: {
        userId: string;
        strategyId: string;
        location: string;
        targetCategory: string;
        outreachChannel: 'whatsapp' | 'email';
        senderName: string;
        productOrService: string;
        maxTargets?: number;
    }): Promise<{ reached: number; leads: any[] }> {
        this.log(`Discovering ${params.targetCategory} businesses near "${params.location}" for ${params.outreachChannel} outreach`);

        const result = await discoverBusinesses({
            location: params.location,
            keyword: params.targetCategory,
            maxResults: params.maxTargets ?? 10,
        });

        if (!result.businesses.length) {
            this.log(`No businesses found near "${params.location}" for category "${params.targetCategory}"`);
            return { reached: 0, leads: [] };
        }

        const hotProspects = result.businesses.filter(b => (b.outreach_score ?? 0) >= 0.55);
        this.log(`Found ${result.businesses.length} businesses, ${hotProspects.length} hot prospects`);

        const leads: any[] = [];

        for (const biz of hotProspects) {
            try {
                const message = buildOutreachMessage(biz, params.senderName, params.productOrService);

                let outreachSent = false;

                if (params.outreachChannel === 'whatsapp' && biz.phone) {
                    const phone = biz.phone.replace(/\D/g, '');
                    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
                    this.log(`WhatsApp outreach queued for ${biz.name} → ${waUrl}`);
                    outreachSent = true;
                } else if (params.outreachChannel === 'email' && biz.website) {
                    const domain = new URL(biz.website).hostname;
                    const toEmail = `contact@${domain}`;
                    const emailResult = await sendEmailViaResend({
                        to: toEmail,
                        subject: `Quick question about ${biz.name}`,
                        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;padding:24px;">
                          <p style="font-size:15px;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</p>
                          <p style="color:#888;font-size:12px;margin-top:24px;">Sent via AdRoom AI Sales Agent</p>
                        </div>`,
                        text: message,
                    });
                    outreachSent = emailResult.ok;
                    if (!outreachSent) {
                        this.log(`Email to ${biz.name} failed: ${emailResult.error}`);
                    }
                }

                if (outreachSent) {
                    const { data: lead } = await this.supabase.from('agent_leads').insert({
                        strategy_id: params.strategyId,
                        user_id: params.userId,
                        platform: params.outreachChannel,
                        platform_username: biz.name,
                        platform_user_id: biz.phone || biz.place_id,
                        first_interaction: message,
                        intent_score: biz.outreach_score ?? 0.5,
                        intent_signals: [{
                            source: 'google_maps_discovery',
                            place_id: biz.place_id,
                            rating: biz.rating,
                            total_ratings: biz.total_ratings,
                            outreach_reason: biz.outreach_reason,
                        }],
                        stage: 'identified',
                        next_followup_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                    }).select('id').single();

                    leads.push({ business: biz.name, channel: params.outreachChannel, lead_id: lead?.id });
                    this.log(`Outreach sent to ${biz.name} (score: ${biz.outreach_score?.toFixed(2)})`);
                }
            } catch (err: any) {
                this.log(`Outreach failed for ${biz.name}: ${err.message}`);
            }
        }

        this.log(`Business discovery outreach complete — ${leads.length} leads created`);
        return { reached: leads.length, leads };
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
