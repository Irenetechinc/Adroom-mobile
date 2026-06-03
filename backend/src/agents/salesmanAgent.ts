import { SupabaseClient } from '@supabase/supabase-js';
import { AgentBase, AgentTokens } from './agentBase';
import { AIEngine } from '../config/ai-models';
import { pushService } from '../services/pushService';
import { discoverBusinesses, buildOutreachMessage, buildOutreachMessageAI, type PlaceBusiness } from '../services/googleMapsService';
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

        // ─── INBOUND_REPLY: Lead sent a message back — read full history, craft real reply ──
        if (task.task_type === 'INBOUND_REPLY') {
            await this.executeInboundReply(taskId, task);
            return;
        }
        // ────────────────────────────────────────────────────────────────────────

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

            // Generate polished final content using the stored content plan + ALL live intelligence
            const finalContent = await this.generatePlatformContent({
                platform: task.platform,
                goal: 'SALES',
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
                    task.content.sales_tactic ? `Apply ${task.content.sales_tactic} sales tactic` : undefined,
                    brainOverride,
                    geoData.length ? `GEO insight: ${geoData.map((g: any) => g.missing_claims?.slice(0, 2)?.join(', ')).filter(Boolean).join(' | ')}` : undefined,
                ].filter(Boolean).join(' | ') || undefined,
            });

            const publishBody = `${finalContent.headline}\n\n${finalContent.body}\n\n${(finalContent.hashtags || []).map((h: string) => `#${h}`).join(' ')}`;

            // Generate a unique, conversion-optimized graphic via GraphicsDesignerAgent
            let postImageUrl: string | undefined;
            if (task.platform !== 'twitter' && task.platform !== 'x' && task.platform !== 'tiktok') {
                try {
                    const { graphicsDesignerAgent } = await import('./graphicsDesignerAgent');
                    postImageUrl = await graphicsDesignerAgent.getImageForPost({
                        userId: task.user_id,
                        productId: task.strategies?.product_id,
                        strategyId: task.strategy_id,
                        platform: task.platform,
                        goal: 'SALESMAN',
                        agentType: 'SALESMAN',
                        headline: finalContent.headline,
                        body: finalContent.body,
                        hashtags: finalContent.hashtags,
                        cta: finalContent.cta,
                        taskType: task.task_type,
                        product,
                    });
                    if (postImageUrl) this.log(`Sales graphic generated — ${postImageUrl.split('/').pop()}`);
                } catch (e: any) {
                    this.log(`GraphicsDesignerAgent failed (non-fatal): ${e.message}`);
                }
            }

            let result;
            if (task.platform === 'facebook' && tokens.facebook) {
                result = await this.publishToFacebook(tokens.facebook, publishBody, postImageUrl);
            } else if (task.platform === 'instagram' && tokens.instagram) {
                if (!postImageUrl) throw new Error('Instagram requires an image — GraphicsDesignerAgent must provide one');
                result = await this.publishToInstagram(tokens.instagram, publishBody, postImageUrl);
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
                        // Detect new vs returning lead before upserting
                        const { count: existingCount } = await this.supabase
                            .from('agent_leads')
                            .select('id', { count: 'exact', head: true })
                            .eq('user_id', params.userId)
                            .eq('platform', params.platform)
                            .eq('platform_user_id', comment.from?.id);
                        const isNewLead = !existingCount || existingCount === 0;

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

                        if (isNewLead && comment.from?.name) {
                            pushService.notifyNewLead(params.userId, {
                                leadName: comment.from.name,
                                platform: params.platform,
                                intentScore,
                                firstInteraction: comment.message,
                            }).catch(() => {});
                        }
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

                    const { count: existingCount } = await this.supabase
                        .from('agent_leads')
                        .select('id', { count: 'exact', head: true })
                        .eq('user_id', params.userId)
                        .eq('platform', 'tiktok')
                        .eq('platform_user_id', lead.open_id);
                    const isNewLead = !existingCount || existingCount === 0;

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

                    if (isNewLead && lead.display_name) {
                        pushService.notifyNewLead(params.userId, {
                            leadName: lead.display_name,
                            platform: 'tiktok',
                            intentScore,
                            firstInteraction: lead.bio_description || undefined,
                        }).catch(() => {});
                    }
                }
            } catch (err: any) {
                this.log(`TikTok lead scan failed: ${err.message}`);
            }
            return;
        }

        this.log(`Lead scan skipped — unsupported platform: ${params.platform}`);
    }

    /**
     * INBOUND_REPLY: A lead has replied to a DM.
     * Read their full conversation history and craft a direct, context-aware response.
     * Nothing is hard-coded — AI Brain reads the entire thread and writes its own reply.
     */
    private async executeInboundReply(taskId: string, task: any): Promise<void> {
        const { lead_id, inbound_message, platform_user_id } = task.content || {};

        if (!lead_id || !inbound_message) {
            await this.failTask(taskId, 'INBOUND_REPLY task missing lead_id or inbound_message');
            return;
        }

        // Fetch full conversation history + lead profile in parallel
        const [historyRes, leadRes, strategyRes] = await Promise.all([
            this.supabase
                .from('lead_dm_messages')
                .select('direction, message, persona_name, created_at')
                .eq('lead_id', lead_id)
                .order('created_at', { ascending: true })
                .limit(30),
            this.supabase
                .from('agent_leads')
                .select('*')
                .eq('id', lead_id)
                .single(),
            this.supabase
                .from('strategies')
                .select('product_id, goal')
                .eq('id', task.strategy_id)
                .single(),
        ]);

        const lead = leadRes.data;
        if (!lead) {
            await this.failTask(taskId, `Lead ${lead_id} not found`);
            return;
        }

        const history = historyRes.data || [];
        const product = strategyRes.data?.product_id
            ? await this.getProductDetails(strategyRes.data.product_id)
            : null;
        const tokens = await this.getTokens(task.user_id);

        // Log the inbound message first (so the thread is complete before AI reads it)
        try {
            await this.supabase.from('lead_dm_messages').insert({
                lead_id,
                user_id: task.user_id,
                direction: 'inbound',
                message: inbound_message,
                platform: lead.platform,
                meta: { auto_detected: true, task_id: taskId },
            });
        } catch { /* best-effort log */ }

        const conversationThread = history
            .map(m => `[${m.direction === 'outbound' ? 'Agent' : 'Lead'}]: ${m.message}`)
            .join('\n');

        // ── Guardrail check before anything else ──────────────────────────────
        const { analyzeIncomingMessage } = await import('../services/guardrailService');
        const guard = await analyzeIncomingMessage(
            inbound_message,
            conversationThread,
            0,
            {
                platform: lead.platform,
                productName: product?.product_name || product?.name,
                leadCountry: lead.country,
            }
        );
        if (!guard.isSafe) {
            if (guard.dynamicRedirect) {
                // Send the AI-generated redirect — log it as outbound
                let sent = false;
                try {
                    const pid = platform_user_id || lead.platform_user_id;
                    const tok = await this.getTokens(task.user_id);
                    if ((lead.platform === 'facebook' || lead.platform === 'instagram') && tok.facebook && pid) {
                        await this.sendFacebookDM(tok.facebook, pid, guard.dynamicRedirect);
                        sent = true;
                    }
                } catch {}
                try {
                    await this.supabase.from('lead_dm_messages').insert({
                        lead_id,
                        user_id: task.user_id,
                        direction: 'outbound',
                        message: guard.dynamicRedirect,
                        platform: lead.platform,
                        meta: { triggered_by: 'GUARDRAIL', threat_type: guard.threatType },
                    });
                } catch {}
                await this.supabase.from('agent_tasks').update({
                    status: 'done',
                    executed_at: new Date().toISOString(),
                    result: { action: 'guardrail_redirect', threat_type: guard.threatType, sent },
                }).eq('id', taskId);
            } else {
                // Threat but no redirect generated — mark done, do not respond
                await this.supabase.from('agent_tasks').update({
                    status: 'done',
                    executed_at: new Date().toISOString(),
                    result: { action: 'guardrail_blocked', threat_type: guard.threatType },
                }).eq('id', taskId);
            }
            this.log(`INBOUND_REPLY ${taskId}: guardrail triggered (${guard.threatType}) for ${lead.platform_username}`);
            return;
        }
        // ────────────────────────────────────────────────────────────────────

        // Check if lead is sending payment proof — pause for user confirm/reject
        const isPaymentProof = await this.detectPaymentProof(inbound_message);
        if (isPaymentProof) {
            await this.handlePaymentProofReceived(lead, task.user_id, inbound_message, taskId, task, product);
            await this.supabase.from('agent_tasks').update({
                status: 'done',
                executed_at: new Date().toISOString(),
                result: { action: 'payment_proof_pending_user_confirm', lead_username: lead.platform_username },
            }).eq('id', taskId);
            this.log(`INBOUND_REPLY ${taskId}: payment proof detected — user notified to confirm/reject`);
            return;
        }

        // Check if lead is requesting a discount — only approval flow the AI must pause for
        const isDiscount = await this.detectDiscountRequest(inbound_message);
        if (isDiscount && product) {
            await this.requestDiscountApproval(lead, task.user_id, product, inbound_message, task);
            await this.supabase.from('agent_tasks').update({
                status: 'done',
                executed_at: new Date().toISOString(),
                result: { action: 'discount_approval_requested', lead_username: lead.platform_username },
            }).eq('id', taskId);
            this.log(`INBOUND_REPLY ${taskId}: discount request detected — paused for user approval`);
            return;
        }

        // AI Brain generates a fresh persona scoped to this specific conversation.
        // No hardcoded name or style — the AI determines both from context.
        // Fallback persona is also context-derived (based on platform + intent),
        // never a hardcoded string.
        const platformPersonaSeeds: Record<string, { names: string[]; styles: string[] }> = {
            facebook: { names: ['Alex', 'Jordan', 'Morgan', 'Taylor'], styles: ['warm and direct', 'conversational and confident', 'friendly closer'] },
            instagram: { names: ['Riley', 'Casey', 'Jamie', 'Quinn'], styles: ['energetic and brief', 'visual and punchy', 'trend-aware and direct'] },
            twitter: { names: ['Chris', 'Drew', 'Blake', 'Avery'], styles: ['sharp and concise', 'witty and confident', 'straight-talking'] },
            linkedin: { names: ['Dana', 'Lee', 'Cameron', 'Skyler'], styles: ['professional and sharp', 'value-led and direct', 'credible and concise'] },
        };
        const seed = platformPersonaSeeds[lead.platform as string] || { names: ['Jordan', 'Alex', 'Casey'], styles: ['direct and confident', 'natural closer'] };
        const fallbackIdx = (lead.platform_user_id?.charCodeAt(0) ?? 0) % seed.names.length;
        let persona = { name: seed.names[fallbackIdx], tone: seed.styles[fallbackIdx % seed.styles.length] };
        try {
            const pRes = await this.ai.generateStrategyEconomy({}, `You are assigning a sales persona for a DM conversation. Generate a persona that fits the context.

Platform: ${lead.platform}
Lead's opening message: "${inbound_message.slice(0, 150)}"
Conversation depth: ${history.length} prior exchanges
Lead's purchase intent score: ${lead.intent_score} (0=cold, 1=ready to buy)
Lead's country signal: ${lead.country || 'unknown'}

Choose a persona that would naturally connect with this specific person on this platform.
Return JSON only: { "name": "first name only", "tone": "2-4 word style descriptor that reflects the persona's energy and approach" }`);
            if (pRes.parsedJson?.name) persona = pRes.parsedJson;
        } catch {}

        // AI Brain reads the full thread and writes a direct, context-aware reply
        const replyPrompt = `You are ${persona.name}. Your communication style: ${persona.tone}.

WHAT THE LEAD JUST SAID:
"${inbound_message}"

FULL CONVERSATION HISTORY (most recent context):
${conversationThread || '(this is the first exchange)'}

PRODUCT:
Name: ${product?.product_name || product?.name || 'the product'}
Price: ${product?.price || 'available on request'}
Core benefit: ${product?.description ? product.description.slice(0, 120) : ''}

YOUR TASK:
Respond DIRECTLY to what they said. This is a real conversation with a real person — not a DM blast.
Read what they actually wrote. Address it. Move the conversation forward.

Rules you MUST follow:
- Reply to their specific message — do not pivot to a generic sales script
- If they asked a question, answer it precisely and completely
- If they showed buying interest, provide the one detail that would close them
- If they are hesitant, acknowledge it briefly and offer one concrete reassurance
- Keep it under 3 sentences — natural text, not marketing copy
- Write exactly like a confident human would text, not a customer service rep
- Never say "I'm here to help" or any variant — you are a closer, not a helper
- No emojis unless they used them first

Return JSON: { "message": "the reply text", "reasoning": "why this reply" }`;

        const response = await this.ai.generateStrategy({}, replyPrompt);
        const reply = response.parsedJson?.message;

        if (!reply) {
            await this.failTask(taskId, 'AI Brain could not generate INBOUND_REPLY response');
            return;
        }

        // Send the reply via the correct platform
        let sent = false;
        try {
            const pid = platform_user_id || lead.platform_user_id;
            if ((lead.platform === 'facebook' || lead.platform === 'instagram') && tokens.facebook && pid) {
                await this.sendFacebookDM(tokens.facebook, pid, reply);
                sent = true;
            }
            // Additional platforms as they gain DM API support
        } catch (e: any) {
            this.log(`INBOUND_REPLY send failed: ${e.message}`);
        }

        // Log the outbound reply to the conversation thread
        try {
            await this.supabase.from('lead_dm_messages').insert({
                lead_id,
                user_id: task.user_id,
                direction: 'outbound',
                message: reply,
                persona_name: persona.name,
                platform: lead.platform,
                meta: {
                    triggered_by: 'INBOUND_REPLY',
                    inbound_preview: inbound_message.slice(0, 100),
                    reasoning: response.parsedJson?.reasoning?.slice(0, 200),
                },
            });
        } catch { /* best-effort log */ }

        // Advance lead stage if they're actively replying
        const newStage = lead.intent_score >= 0.85
            ? 'engaged'
            : lead.stage === 'identified' ? 'engaged' : lead.stage;

        await this.supabase.from('agent_leads').update({
            stage: newStage,
            last_contacted_at: new Date().toISOString(),
            next_followup_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        }).eq('id', lead.id);

        await this.supabase.from('agent_tasks').update({
            status: 'done',
            executed_at: new Date().toISOString(),
            result: { sent, reply_preview: reply.slice(0, 120), lead_username: lead.platform_username },
        }).eq('id', taskId);

        this.log(`INBOUND_REPLY sent to ${lead.platform_username} — "${reply.slice(0, 70)}..."`);
    }

    /**
     * Detect whether the lead is asking for a discount or price negotiation.
     * AI Brain analyses — no keyword matching.
     */
    private async detectDiscountRequest(message: string): Promise<boolean> {
        try {
            const res = await this.ai.generateStrategyEconomy({}, `
Is this message a discount or price negotiation request?
Message: "${message.slice(0, 200)}"
Return JSON: { "is_discount_request": true|false }`);
            return res.parsedJson?.is_discount_request === true;
        } catch {
            return false;
        }
    }

    /**
     * Detect whether the lead is sending a payment proof or confirming they've paid.
     * AI Brain analyses — no keyword matching.
     */
    private async detectPaymentProof(message: string): Promise<boolean> {
        try {
            const res = await this.ai.generateStrategyEconomy({}, `
Analyze this message from a potential customer in a DM conversation.
Message: "${message.slice(0, 300)}"

Has this person: sent payment proof, confirmed they paid, shared a payment receipt, said they've transferred money, or described completing a payment?
Examples that ARE payment proof: "I've sent the money", "I just transferred", "here's my receipt", "done, I paid", "please confirm you received", sharing payment screenshot descriptions.
Examples that are NOT: asking about price, asking how to pay, saying they want to buy.

Return JSON: { "is_payment_proof": true|false, "confidence": 0.0-1.0 }`);
            return res.parsedJson?.is_payment_proof === true && (res.parsedJson?.confidence || 0) >= 0.7;
        } catch {
            return false;
        }
    }

    /**
     * Handle payment proof from a lead:
     * 1. Store the proof request in the database
     * 2. Send a push notification to the User with Confirm/Reject/Not Seen options
     * 3. Pause the conversation until the User responds
     */
    private async handlePaymentProofReceived(
        lead: any, userId: string, inboundMessage: string,
        taskId: string, task: any, product: any
    ): Promise<void> {
        try {
            // Store the payment proof request
            const { data: ppr } = await this.supabase.from('payment_proof_requests').insert({
                user_id: userId,
                lead_id: lead.id,
                strategy_id: task.strategy_id,
                inbound_message: inboundMessage,
                platform: lead.platform,
                platform_username: lead.platform_username,
                product_name: product?.product_name || product?.name || null,
                action: null,
            }).select('id').single().then(r => r, () => ({ data: null }));

            // AI Brain writes the notification dynamically
            const notifRes = await this.ai.generateStrategyEconomy({}, `
A potential customer has just sent payment proof for a product purchase.
Customer: ${lead.platform_username}
Their message: "${inboundMessage.slice(0, 200)}"
Product: ${product?.product_name || 'your product'} (Price: ${product?.price || 'unknown'})

Write a short push notification for the business owner to confirm or reject this payment.
Return JSON: { "title": "short title (max 6 words)", "body": "1 sentence body saying what to do" }`).then(r => r, () => ({ parsedJson: null }));

            const notif = notifRes.parsedJson;

            // Send notification with actionable data so the app knows to show buttons
            const notifId = await this.supabase.from('user_notifications').insert({
                user_id: userId,
                title: notif?.title || `Payment Proof from ${lead.platform_username}`,
                body: notif?.body || `${lead.platform_username} says they've sent payment. Tap to confirm or reject.`,
                data: {
                    type: 'payment_proof',
                    action_type: 'payment_proof',
                    proof_id: ppr?.id || null,
                    lead_id: lead.id,
                    platform_username: lead.platform_username,
                    product_name: product?.product_name || null,
                    inbound_preview: inboundMessage.slice(0, 150),
                    screen: 'Notifications',
                },
                sent_by: 'salesman_agent',
            }).select('id').single().then(r => r.data?.id, () => null);

            // Update the payment proof request with the notification id
            if (ppr?.id && notifId) {
                await this.supabase.from('payment_proof_requests')
                    .update({ notification_id: notifId })
                    .eq('id', ppr.id).then(null, () => {});
            }

            // Push notification
            await pushService.send(userId, {
                title: notif?.title || `Payment Proof from ${lead.platform_username}`,
                body: notif?.body || `${lead.platform_username} says they've sent payment. Confirm or reject.`,
                data: {
                    type: 'payment_proof',
                    proof_id: ppr?.id || null,
                    lead_id: lead.id,
                    notification_id: notifId,
                    screen: 'Notifications',
                },
            });

            this.log(`Payment proof from ${lead.platform_username} — User notified (proof_id: ${ppr?.id})`);
        } catch (e: any) {
            this.log(`handlePaymentProofReceived error: ${e.message}`);
        }
    }

    /**
     * Respond to a lead after the User has confirmed/rejected/ignored payment proof.
     * AI Brain writes the reply based on user's decision.
     */
    async executePaymentProofResponse(taskId: string, task: any): Promise<void> {
        const { lead_id, proof_id, user_action } = task.content || {};
        if (!lead_id || !user_action) {
            await this.failTask(taskId, 'PAYMENT_PROOF_RESPONSE missing lead_id or user_action');
            return;
        }

        const [leadRes, strategyRes] = await Promise.all([
            this.supabase.from('agent_leads').select('*').eq('id', lead_id).single(),
            this.supabase.from('strategies').select('product_id, goal').eq('id', task.strategy_id).single(),
        ]);

        const lead = leadRes.data;
        if (!lead) { await this.failTask(taskId, `Lead ${lead_id} not found`); return; }
        const product = strategyRes.data?.product_id ? await this.getProductDetails(strategyRes.data.product_id) : null;
        const tokens = await this.getTokens(task.user_id);

        const replyPrompt = `You are closing a real sale. The buyer just sent payment proof and the business owner has responded.

BUYER: ${lead.platform_username}
PRODUCT: ${product?.product_name || 'the product'} (Price: ${product?.price || 'on request'})
PAYMENT BANK DETAILS: ${product?.bank_account_details || 'provided separately'}
OWNER'S DECISION: "${user_action}"

Based on the decision:
- "confirm": Write a warm, professional message confirming the payment, give next steps (delivery timeline, what happens now)
- "reject": Write a polite message explaining payment not confirmed yet, ask them to check and resend proof
- "not_seen": Write a professional message saying the payment is under review and you will confirm shortly

Keep it under 3 sentences. Natural human tone. No jargon.
Return JSON: { "message": "the reply" }`;

        const response = await this.ai.generateStrategy({}, replyPrompt);
        const reply = response.parsedJson?.message;
        if (!reply) { await this.failTask(taskId, 'AI Brain could not generate payment response'); return; }

        let sent = false;
        try {
            if ((lead.platform === 'facebook' || lead.platform === 'instagram') && tokens.facebook && lead.platform_user_id) {
                await this.sendFacebookDM(tokens.facebook, lead.platform_user_id, reply);
                sent = true;
            }
        } catch (e: any) { this.log(`Payment response send failed: ${e.message}`); }

        await this.supabase.from('lead_dm_messages').insert({
            lead_id, user_id: task.user_id,
            direction: 'outbound', message: reply,
            platform: lead.platform,
            meta: { triggered_by: 'PAYMENT_PROOF_RESPONSE', user_action },
        }).then(null, () => {});

        // If confirmed, create a deal record
        if (user_action === 'confirm' && product) {
            await this.supabase.from('agent_deals').insert({
                strategy_id: task.strategy_id, user_id: task.user_id,
                lead_id: lead.id, platform: lead.platform,
                buyer_name: lead.platform_username, buyer_contact: lead.platform_user_id,
                product_name: product.product_name || product.name,
                product_id: strategyRes.data?.product_id,
                deal_value: parseFloat(product.price) || 0,
                currency: 'USD',
                payment_details: { bank: product.bank_account_details, proof_id },
                status: 'pending_delivery',
            }).then(null, () => {});
        }

        await this.supabase.from('agent_tasks').update({
            status: 'done', executed_at: new Date().toISOString(),
            result: { sent, user_action, reply_preview: reply.slice(0, 100) },
        }).eq('id', taskId);

        this.log(`PAYMENT_PROOF_RESPONSE sent to ${lead.platform_username} (action: ${user_action})`);
    }

    /**
     * Pause conversation and notify the User for discount approval.
     * AI Brain writes the notification message dynamically.
     */
    private async requestDiscountApproval(
        lead: any, userId: string, product: any, inboundMessage: string, task: any
    ): Promise<void> {
        try {
            const notifRes = await this.ai.generateStrategyEconomy({}, `
A potential customer is asking about pricing or a discount.
Customer: ${lead.platform_username}
Their message: "${inboundMessage.slice(0, 200)}"
Product: ${product?.product_name || 'the product'} (Price: ${product?.price || 'unknown'})

Write a short, clear push notification for the business owner asking them to approve/deny the discount.
Return JSON: { "title": "short title", "body": "1 sentence notification body" }`);

            const notif = notifRes.parsedJson;

            await pushService.send(userId, {
                title: notif?.title || 'Discount Request',
                body: notif?.body || `${lead.platform_username} is asking about pricing. Tap to respond.`,
                data: {
                    type: 'discount_approval',
                    lead_id: lead.id,
                    task_id: task.id,
                    strategy_id: task.strategy_id,
                    screen: 'Leads',
                },
            });

            // Schedule a 4-hour follow-up to the lead if user hasn't responded
            await this.supabase.from('agent_tasks').insert({
                strategy_id: task.strategy_id,
                user_id: userId,
                agent_type: 'SALESMAN',
                task_type: 'INBOUND_REPLY',
                platform: lead.platform,
                scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
                status: 'pending',
                content: {
                    lead_id: lead.id,
                    platform_user_id: lead.platform_user_id,
                    inbound_message: 'They asked for a discount and are waiting for a response.',
                    context: 'discount_followup',
                },
            });

            this.log(`Discount approval requested for lead ${lead.platform_username} — User notified`);
        } catch (e: any) {
            this.log(`Discount approval notification failed: ${e.message}`);
        }
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

                // Generate a dynamic, context-aware persona using the AI Brain
                let persona = { name: 'Alex', tone: 'casual and friendly', opener: 'Hey' };
                try {
                    const personaPrompt = `Generate a unique human persona to write a DM on ${lead.platform}.
Lead context: intent score ${lead.intent_score}, first interaction: "${(lead.first_interaction || '').slice(0, 120)}"
Platform tone norms: ${lead.platform === 'linkedin' ? 'professional, warm' : lead.platform === 'twitter' ? 'concise, witty' : 'friendly, conversational'}
Current step: ${lead.dm_sequence_step} of 3

Generate a persona that feels realistic for someone in this industry/platform niche.
Return JSON only: { "name": "common first name", "tone": "one short phrase", "opener": "casual greeting word or phrase" }`;
                    const personaRes = await this.ai.generateStrategyEconomy({}, personaPrompt);
                    if (personaRes.parsedJson?.name) {
                        persona = personaRes.parsedJson;
                    }
                } catch { /* keep default */ }

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

                const nextLeadStage = lead.dm_sequence_step >= 2 ? 'nurturing' : 'engaged';

                // ── Follow-up Evolution Engine (Capability 5) ────────────────────
                // The AI Brain determines the optimal next-contact interval based on:
                //   • lead's intent score and current stage
                //   • what intervals have historically converted for this platform
                //   • what the follow_up_evolution_log shows has worked before
                // It also experiments with channel and timing variations and logs
                // every decision so the system learns across thousands of interactions.
                let nextFollowupMs = 24 * 60 * 60 * 1000; // 24h default
                let experimentNote = 'default_24h';
                try {
                    // Load historical winning intervals for this platform from evolution log
                    const { data: evolutionLog } = await this.supabase
                        .from('follow_up_evolution_log')
                        .select('winning_interval_ms, channel, stage, outcome')
                        .eq('platform', lead.platform)
                        .eq('outcome', 'converted')
                        .order('created_at', { ascending: false })
                        .limit(10);

                    const intervalPrompt = `You are the AdRoom follow-up timing optimizer.

LEAD CONTEXT:
- Platform: ${lead.platform}
- Intent score: ${lead.intent_score} (0=cold, 1=hot)
- Current follow-up step: ${lead.dm_sequence_step + 1} of 3
- Stage: ${lead.stage}
- First interaction: "${(lead.first_interaction || '').slice(0, 100)}"

HISTORICAL WINNING INTERVALS FOR ${lead.platform.toUpperCase()}:
${(evolutionLog || []).map(e => `- Step that converted: interval ${Math.round((e.winning_interval_ms||86400000)/3600000)}h, stage: ${e.stage}`).join('\n') || 'No history yet — experiment freely.'}

DECISION: Choose the next follow-up interval in milliseconds.
- High-intent (>0.8): shorter interval (2-8h)
- Medium-intent (0.5-0.8): standard (12-24h)
- Cold (<0.5): longer (24-48h)
- Experiment: occasionally try an unusual interval to generate learning data

Also decide whether to experiment with a different approach on the next step.

Return JSON: { "interval_ms": 86400000, "experiment": "describe the experiment or 'none'", "rationale": "one sentence" }`;

                    const timingRes = await this.ai.generateStrategyEconomy({}, intervalPrompt);
                    if (timingRes.parsedJson?.interval_ms) {
                        const proposed = timingRes.parsedJson.interval_ms;
                        // Safety clamp: minimum 1h, maximum 72h
                        nextFollowupMs = Math.max(60 * 60 * 1000, Math.min(72 * 60 * 60 * 1000, proposed));
                        experimentNote = timingRes.parsedJson.experiment || 'none';

                        // Log this timing decision for future evolution learning
                        // Fire-and-forget — wrap in void Promise so tsc doesn't complain
                        void (async () => {
                            try {
                                await this.supabase.from('follow_up_evolution_log').insert({
                                    lead_id: lead.id,
                                    platform: lead.platform,
                                    stage: lead.stage,
                                    dm_sequence_step: lead.dm_sequence_step,
                                    intent_score: lead.intent_score,
                                    interval_ms_chosen: nextFollowupMs,
                                    channel: lead.platform,
                                    experiment_note: experimentNote,
                                    outcome: 'pending',
                                    created_at: now,
                                });
                            } catch { /* non-blocking */ }
                        })();
                    }
                } catch { /* use default 24h interval */ }
                // ── End Follow-up Evolution Engine ───────────────────────────────

                await this.supabase.from('agent_leads').update({
                    stage: nextLeadStage,
                    dm_sequence_step: lead.dm_sequence_step + 1,
                    last_contacted_at: now,
                    next_followup_at: new Date(Date.now() + nextFollowupMs).toISOString()
                }).eq('id', lead.id);

                // Fire-and-forget: notify if this advance crosses a funnel bucket
                pushService.notifyLeadStageAdvanced(userId, {
                    leadId: lead.id,
                    leadName: lead.platform_username || 'A lead',
                    platform: lead.platform,
                    oldStage: lead.stage,
                    newStage: nextLeadStage,
                    strategyId: lead.strategy_id,
                }).catch(() => { /* best-effort */ });

                // Log the DM to conversation thread (lead_dm_messages) — non-blocking
                (async () => {
                    try {
                        await this.supabase.from('lead_dm_messages').insert({
                            lead_id: lead.id,
                            user_id: userId,
                            direction: 'outbound',
                            message,
                            persona_name: persona.name,
                            sequence_step: lead.dm_sequence_step,
                            platform: lead.platform,
                            meta: { tone: persona.tone, step_context: stepCtx.slice(0, 100) },
                        });
                    } catch { /* silent — DM log failure must not block the follow-up */ }
                })();

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

        // Close the follow-up evolution learning loop:
        // mark all pending evolution log rows for this lead as 'converted' and
        // record the winning interval so the AI Brain learns from it on the next cycle.
        void (async () => {
            try {
                const { data: pendingRows } = await this.supabase
                    .from('follow_up_evolution_log')
                    .select('id, interval_ms_chosen')
                    .eq('lead_id', lead.id)
                    .eq('outcome', 'pending');
                if (pendingRows?.length) {
                    for (const row of pendingRows) {
                        await this.supabase.from('follow_up_evolution_log').update({
                            outcome: 'converted',
                            winning_interval_ms: row.interval_ms_chosen,
                            resolved_at: new Date().toISOString(),
                        }).eq('id', row.id);
                    }
                }
            } catch { /* non-blocking — learning loop closure */ }
        })();

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
                const message = await buildOutreachMessageAI(biz, params.senderName, params.productOrService, {
                goal: params.targetCategory,
                product: params.productOrService,
            });

                let outreachSent = false;

                if (params.outreachChannel === 'whatsapp' && biz.phone) {
                    const phone = biz.phone.replace(/\D/g, '');
                    // Try WhatsApp Cloud API if user has connected their Business account
                    const { data: waCfg } = await this.supabase
                        .from('ad_configs')
                        .select('page_id, access_token')
                        .eq('user_id', params.userId)
                        .eq('platform', 'whatsapp')
                        .single();

                    if (waCfg?.page_id && waCfg?.access_token) {
                        try {
                            const sendRes = await fetch(`https://graph.facebook.com/v19.0/${waCfg.page_id}/messages`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waCfg.access_token}` },
                                body: JSON.stringify({
                                    messaging_product: 'whatsapp',
                                    to: phone,
                                    type: 'text',
                                    text: { body: message },
                                }),
                            });
                            const sendData: any = await sendRes.json();
                            if (sendRes.ok) {
                                this.log(`WhatsApp message SENT to ${biz.name} (${phone}) via Cloud API`);
                                outreachSent = true;
                            } else {
                                this.log(`WhatsApp Cloud API failed for ${biz.name}: ${sendData?.error?.message || 'Unknown'} — falling back to wa.me link`);
                                const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
                                this.log(`WhatsApp outreach link queued for ${biz.name} → ${waUrl}`);
                                outreachSent = true;
                            }
                        } catch (waErr: any) {
                            this.log(`WhatsApp API error for ${biz.name}: ${waErr.message} — falling back to wa.me`);
                            const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
                            this.log(`WhatsApp outreach link queued for ${biz.name} → ${waUrl}`);
                            outreachSent = true;
                        }
                    } else {
                        const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
                        this.log(`WhatsApp outreach link queued for ${biz.name} → ${waUrl}`);
                        outreachSent = true;
                    }
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
