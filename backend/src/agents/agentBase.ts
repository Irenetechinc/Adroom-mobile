import { SupabaseClient } from '@supabase/supabase-js';
import { AIEngine } from '../config/ai-models';
import fetch from 'node-fetch';

export interface AgentTokens {
    facebook?: { access_token: string; page_id: string };
    instagram?: { access_token: string; instagram_account_id: string };
    twitter?: { access_token: string; refresh_token?: string };
    linkedin?: { access_token: string; person_urn?: string; org_urn?: string };
    tiktok?: { access_token: string; open_id?: string };
}

export interface AgentTask {
    strategy_id: string;
    user_id: string;
    agent_type: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';
    task_type: string;
    platform: string;
    scheduled_at: string;
    content: {
        headline?: string;
        body: string;
        image_prompt?: string;
        hashtags?: string[];
        cta?: string;
        recipient_id?: string;
        link?: string;
        target_post_id?: string;
    };
}

export interface PublishResult {
    platform_post_id: string;
    platform: string;
    published_at: string;
    url?: string;
}

const FB_GRAPH = 'https://graph.facebook.com/v19.0';
const TWITTER_API = 'https://api.twitter.com/2';
const LINKEDIN_API = 'https://api.linkedin.com/v2';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export class AgentBase {
    protected ai: AIEngine;
    protected supabase: SupabaseClient;
    protected agentType: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';

    constructor(supabase: SupabaseClient, agentType: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH') {
        this.ai = AIEngine.getInstance();
        this.supabase = supabase;
        this.agentType = agentType;
    }

    protected log(msg: string, data?: any) {
        const ts = new Date().toISOString();
        if (data) {
            console.log(`[${this.agentType}] [${ts}] ${msg}`, typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : data);
        } else {
            console.log(`[${this.agentType}] [${ts}] ${msg}`);
        }
    }

    // ─── TOKEN MANAGEMENT ────────────────────────────────────────────────────────

    async getTokens(userId: string): Promise<AgentTokens> {
        const { data: configs } = await this.supabase
            .from('ad_configs')
            .select('*')
            .eq('user_id', userId);

        const tokens: AgentTokens = {};
        for (const c of configs || []) {
            const platform = (c.platform || '').toLowerCase();
            if (platform === 'facebook' && c.access_token && c.page_id) {
                tokens.facebook = { access_token: c.access_token, page_id: c.page_id };
            }
            if (platform === 'instagram' && c.access_token && c.instagram_account_id) {
                tokens.instagram = { access_token: c.access_token, instagram_account_id: c.instagram_account_id };
            }
            if ((platform === 'twitter' || platform === 'x') && c.access_token) {
                tokens.twitter = { access_token: c.access_token, refresh_token: c.refresh_token };
            }
            if (platform === 'linkedin' && c.access_token) {
                tokens.linkedin = { access_token: c.access_token, person_urn: c.person_urn, org_urn: c.org_urn };
            }
            if (platform === 'tiktok' && c.access_token) {
                tokens.tiktok = { access_token: c.access_token, open_id: c.open_id };
            }
        }
        return tokens;
    }

    // ─── CONTENT GENERATION ──────────────────────────────────────────────────────

    async generatePlatformContent(params: {
        platform: string;
        goal: string;
        product: any;
        context: string;
        taskType: string;
        dayNumber: number;
        totalDays: number;
        brandVoice?: string;
        trends?: string[];
        emotionalData?: any;
        socialData?: any;
        platformIntel?: any;
        instructionOverride?: string;
    }): Promise<{ headline: string; body: string; image_prompt: string; hashtags: string[]; cta: string }> {
        const prompt = `
You are the AdRoom ${this.agentType} Agent generating PRODUCTION-READY social content.

PLATFORM: ${params.platform.toUpperCase()}
GOAL: ${params.goal}
AGENT: ${this.agentType}
PRODUCT: ${JSON.stringify(params.product)}
DAY: ${params.dayNumber} of ${params.totalDays}
TASK TYPE: ${params.taskType}
BRAND VOICE: ${params.brandVoice || 'authentic, confident, direct'}
TRENDING TOPICS: ${JSON.stringify(params.trends || [])}
EMOTIONAL INTELLIGENCE: ${JSON.stringify(params.emotionalData || {})}
SOCIAL LISTENING: ${JSON.stringify(params.socialData || [])}
PLATFORM INTELLIGENCE: ${JSON.stringify(params.platformIntel || {})}
CONTEXT: ${params.context}
${params.instructionOverride ? `PRIORITY OVERRIDE: ${params.instructionOverride}` : ''}

PLATFORM RULES:
- Facebook: 400-500 chars, storytelling, 1-2 emojis, 3-5 hashtags
- Instagram: 150-200 chars + 15-20 hashtags, visual-first language
- Twitter/X: under 280 chars, punchy hook, 2-3 hashtags
- LinkedIn: 200-300 chars, professional tone, business value, 3-5 hashtags
- TikTok: 100-150 chars, trend-aware, viral hook, 5-8 hashtags

AGENT MANDATE:
${this.agentType === 'SALESMAN' ? '- DRIVE CONVERSIONS: strong CTA, urgency, social proof, direct offer. Every word must push toward a sale.' : ''}
${this.agentType === 'AWARENESS' ? '- MAXIMIZE REACH: viral hooks, trending sounds, cultural moments, shareability. Think mass exposure.' : ''}
${this.agentType === 'PROMOTION' ? '- CREATE FOMO: scarcity, countdown urgency, offer clarity, exclusivity. Limited time energy.' : ''}
${this.agentType === 'LAUNCH' ? '- BUILD HYPE: anticipation, exclusivity, announcement energy, narrative dominance, countdown.' : ''}

Return STRICT JSON only (no markdown, no explanation):
{
  "headline": "Attention-grabbing first line (max 80 chars)",
  "body": "Full post body ready to publish",
  "image_prompt": "Detailed Imagen 3 prompt for a professional ad image",
  "hashtags": ["hashtag1", "hashtag2"],
  "cta": "Clear call to action"
}
`;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || {
            headline: 'Check this out',
            body: params.context,
            image_prompt: `Professional marketing image for ${params.product?.product_name || 'product'}`,
            hashtags: [],
            cta: 'Learn more'
        };
    }

    // ─── PUBLISHING ENGINE ───────────────────────────────────────────────────────

    async publishToFacebook(tokens: AgentTokens['facebook'], body: string, imageUrl?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        const { access_token, page_id } = tokens;
        this.log(`Publishing to Facebook page ${page_id}`);

        let postId: string;

        if (imageUrl) {
            const params = new URLSearchParams({ url: imageUrl, caption: body, access_token });
            const resp = await fetch(`${FB_GRAPH}/${page_id}/photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });
            if (!resp.ok) {
                const err: any = await resp.json();
                throw new Error(`Facebook Photo Post: ${err?.error?.message || resp.statusText}`);
            }
            const data: any = await resp.json();
            postId = data.post_id || data.id;
        } else {
            const resp = await fetch(`${FB_GRAPH}/${page_id}/feed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: body, access_token }),
            });
            if (!resp.ok) {
                const err: any = await resp.json();
                throw new Error(`Facebook Feed Post: ${err?.error?.message || resp.statusText}`);
            }
            const data: any = await resp.json();
            postId = data.id;
        }

        this.log(`Facebook post published: ${postId}`);
        return { platform: 'facebook', platform_post_id: postId, published_at: new Date().toISOString(), url: `https://facebook.com/${postId}` };
    }

    async editFacebookPost(tokens: AgentTokens['facebook'], postId: string, newBody: string): Promise<void> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        this.log(`Editing Facebook post ${postId}`);
        const resp = await fetch(`${FB_GRAPH}/${postId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: newBody, access_token: tokens.access_token }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Facebook Edit Post: ${err?.error?.message || resp.statusText}`);
        }
        this.log(`Facebook post ${postId} edited`);
    }

    async replyToFacebookComment(tokens: AgentTokens['facebook'], commentId: string, reply: string): Promise<string> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        this.log(`Replying to Facebook comment ${commentId}`);
        const resp = await fetch(`${FB_GRAPH}/${commentId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: reply, access_token: tokens.access_token }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Facebook Reply Comment: ${err?.error?.message || resp.statusText}`);
        }
        const data: any = await resp.json();
        this.log(`Facebook comment ${commentId} replied — reply ID: ${data.id}`);
        return data.id;
    }

    async likeFacebookObject(tokens: AgentTokens['facebook'], objectId: string): Promise<void> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        const resp = await fetch(`${FB_GRAPH}/${objectId}/likes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: tokens.access_token }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            this.log(`Facebook like failed: ${err?.error?.message}`);
        }
    }

    async sendFacebookDM(tokens: AgentTokens['facebook'], recipientId: string, message: string): Promise<void> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        this.log(`Sending Facebook DM to ${recipientId}`);
        const resp = await fetch(`${FB_GRAPH}/me/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: message },
                access_token: tokens.access_token,
            }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Facebook DM: ${err?.error?.message || resp.statusText}`);
        }
        this.log(`Facebook DM sent to ${recipientId}`);
    }

    async publishToInstagram(tokens: AgentTokens['instagram'], body: string, imageUrl?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Instagram tokens not configured');
        const { access_token, instagram_account_id } = tokens;
        this.log(`Publishing to Instagram account ${instagram_account_id}`);

        if (!imageUrl) {
            // Text-only post as carousel stub (Instagram requires media — use a reel for text-only)
            throw new Error('Instagram requires an image or video URL');
        }

        const containerResp = await fetch(`${FB_GRAPH}/${instagram_account_id}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl, caption: body, access_token }),
        });
        if (!containerResp.ok) {
            const err: any = await containerResp.json();
            throw new Error(`Instagram Media Create: ${err?.error?.message || containerResp.statusText}`);
        }
        const { id: creation_id }: any = await containerResp.json();

        const publishResp = await fetch(`${FB_GRAPH}/${instagram_account_id}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id, access_token }),
        });
        if (!publishResp.ok) {
            const err: any = await publishResp.json();
            throw new Error(`Instagram Publish: ${err?.error?.message || publishResp.statusText}`);
        }
        const data: any = await publishResp.json();
        this.log(`Instagram post published: ${data.id}`);
        return { platform: 'instagram', platform_post_id: data.id, published_at: new Date().toISOString() };
    }

    async replyToInstagramComment(tokens: AgentTokens['instagram'], commentId: string, reply: string): Promise<string> {
        if (!tokens) throw new Error('Instagram tokens not configured');
        this.log(`Replying to Instagram comment ${commentId}`);
        const resp = await fetch(`${FB_GRAPH}/${commentId}/replies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: reply, access_token: tokens.access_token }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Instagram Reply: ${err?.error?.message || resp.statusText}`);
        }
        const data: any = await resp.json();
        this.log(`Instagram comment replied — reply ID: ${data.id}`);
        return data.id;
    }

    async sendInstagramDM(tokens: AgentTokens['instagram'], recipientId: string, message: string): Promise<void> {
        if (!tokens) throw new Error('Instagram tokens not configured');
        this.log(`Sending Instagram DM to ${recipientId}`);
        const resp = await fetch(`${FB_GRAPH}/me/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: message },
                access_token: tokens.access_token,
            }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Instagram DM: ${err?.error?.message || resp.statusText}`);
        }
        this.log(`Instagram DM sent to ${recipientId}`);
    }

    async publishToTwitter(tokens: AgentTokens['twitter'], body: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Twitter tokens not configured');
        this.log(`Publishing to Twitter`);
        const resp = await fetch(`${TWITTER_API}/tweets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
            },
            body: JSON.stringify({ text: body }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Twitter Post: ${JSON.stringify(err?.errors || err?.detail || resp.statusText)}`);
        }
        const data: any = await resp.json();
        const postId = data.data?.id;
        this.log(`Twitter post published: ${postId}`);
        return { platform: 'twitter', platform_post_id: postId, published_at: new Date().toISOString(), url: `https://twitter.com/i/status/${postId}` };
    }

    async replyToTwitterPost(tokens: AgentTokens['twitter'], inReplyToTweetId: string, reply: string): Promise<string> {
        if (!tokens) throw new Error('Twitter tokens not configured');
        this.log(`Replying to Twitter post ${inReplyToTweetId}`);
        const resp = await fetch(`${TWITTER_API}/tweets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
            },
            body: JSON.stringify({ text: reply, reply: { in_reply_to_tweet_id: inReplyToTweetId } }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Twitter Reply: ${JSON.stringify(err?.errors || resp.statusText)}`);
        }
        const data: any = await resp.json();
        this.log(`Twitter reply posted: ${data.data?.id}`);
        return data.data?.id;
    }

    async sendTwitterDM(tokens: AgentTokens['twitter'], recipientId: string, message: string): Promise<void> {
        if (!tokens) throw new Error('Twitter tokens not configured');
        this.log(`Sending Twitter DM to ${recipientId}`);
        const resp = await fetch(`${TWITTER_API}/dm_conversations/with/${recipientId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
            },
            body: JSON.stringify({ text: message }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Twitter DM: ${JSON.stringify(err?.errors || resp.statusText)}`);
        }
        this.log(`Twitter DM sent to ${recipientId}`);
    }

    async publishToLinkedIn(tokens: AgentTokens['linkedin'], body: string, imageUrn?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('LinkedIn tokens not configured');
        const authorUrn = tokens.org_urn || tokens.person_urn;
        if (!authorUrn) throw new Error('LinkedIn author URN not configured');
        this.log(`Publishing to LinkedIn as ${authorUrn}`);

        const shareContent: any = {
            shareCommentary: { text: body },
            shareMediaCategory: 'NONE',
        };
        if (imageUrn) {
            shareContent.shareMediaCategory = 'IMAGE';
            shareContent.media = [{ status: 'READY', media: imageUrn }];
        }

        const payload = {
            author: authorUrn,
            lifecycleState: 'PUBLISHED',
            specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        };

        const resp = await fetch(`${LINKEDIN_API}/ugcPosts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
                'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`LinkedIn Post: ${err?.message || resp.statusText}`);
        }
        const postId = resp.headers.get('x-restli-id') || 'unknown';
        this.log(`LinkedIn post published: ${postId}`);
        return { platform: 'linkedin', platform_post_id: postId, published_at: new Date().toISOString() };
    }

    async replyToLinkedInComment(tokens: AgentTokens['linkedin'], commentUrn: string, reply: string): Promise<void> {
        if (!tokens) throw new Error('LinkedIn tokens not configured');
        this.log(`Replying to LinkedIn comment ${commentUrn}`);
        const authorUrn = tokens.org_urn || tokens.person_urn;
        const resp = await fetch(`${LINKEDIN_API}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
                'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify({
                actor: authorUrn,
                message: { text: reply },
                parentComment: commentUrn,
            }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`LinkedIn Reply: ${err?.message || resp.statusText}`);
        }
        this.log(`LinkedIn comment replied`);
    }

    async sendLinkedInMessage(tokens: AgentTokens['linkedin'], recipientUrn: string, message: string): Promise<void> {
        if (!tokens) throw new Error('LinkedIn tokens not configured');
        this.log(`Sending LinkedIn message to ${recipientUrn}`);
        const resp = await fetch(`${LINKEDIN_API}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
                'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify({
                recipients: [recipientUrn],
                subject: '',
                body: message,
            }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`LinkedIn Message: ${err?.message || resp.statusText}`);
        }
        this.log(`LinkedIn message sent to ${recipientUrn}`);
    }

    async publishToTikTok(tokens: AgentTokens['tiktok'], body: string, videoUrl?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('TikTok tokens not configured');
        this.log(`Publishing to TikTok (open_id: ${tokens.open_id})`);

        // TikTok requires video content — text-only posts are via the Share API
        if (!videoUrl) {
            // Use direct post API for text-only (caption) — TikTok doesn't support text-only posts
            // We create a photo post with the caption if no video
            throw new Error('TikTok requires a video URL. Queue as video task or generate video first.');
        }

        const resp = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
                post_info: {
                    title: body.substring(0, 150),
                    privacy_level: 'PUBLIC_TO_EVERYONE',
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false,
                },
                source_info: {
                    source: 'PULL_FROM_URL',
                    video_url: videoUrl,
                },
            }),
        });

        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`TikTok Post: ${err?.error?.message || JSON.stringify(err) || resp.statusText}`);
        }
        const data: any = await resp.json();
        const postId = data?.data?.publish_id || data?.data?.post_id || 'pending';
        this.log(`TikTok post submitted — publish_id: ${postId}`);
        return { platform: 'tiktok', platform_post_id: postId, published_at: new Date().toISOString() };
    }

    async replyToTikTokComment(tokens: AgentTokens['tiktok'], videoId: string, commentId: string, reply: string): Promise<void> {
        if (!tokens) throw new Error('TikTok tokens not configured');
        this.log(`Replying to TikTok comment ${commentId} on video ${videoId}`);
        const resp = await fetch(`${TIKTOK_API}/comment/reply/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
                video_id: videoId,
                text: reply,
                comment_id: commentId,
            }),
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`TikTok Reply: ${err?.error?.message || resp.statusText}`);
        }
        this.log(`TikTok comment ${commentId} replied`);
    }

    // ─── UNIFIED PUBLISH DISPATCHER ──────────────────────────────────────────────

    async publishToplatform(platform: string, tokens: AgentTokens, body: string, mediaUrl?: string): Promise<PublishResult> {
        this.log(`Dispatching publish to ${platform}`);
        switch (platform.toLowerCase()) {
            case 'facebook': return this.publishToFacebook(tokens.facebook, body, mediaUrl);
            case 'instagram': return this.publishToInstagram(tokens.instagram, body, mediaUrl);
            case 'twitter': case 'x': return this.publishToTwitter(tokens.twitter, body);
            case 'linkedin': return this.publishToLinkedIn(tokens.linkedin, body);
            case 'tiktok': return this.publishToTikTok(tokens.tiktok, body, mediaUrl);
            default: throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async replyToComment(platform: string, tokens: AgentTokens, commentId: string, reply: string, videoId?: string): Promise<void> {
        this.log(`Dispatching reply on ${platform} to comment ${commentId}`);
        switch (platform.toLowerCase()) {
            case 'facebook': await this.replyToFacebookComment(tokens.facebook, commentId, reply); break;
            case 'instagram': await this.replyToInstagramComment(tokens.instagram, commentId, reply); break;
            case 'twitter': case 'x': await this.replyToTwitterPost(tokens.twitter, commentId, reply); break;
            case 'linkedin': await this.replyToLinkedInComment(tokens.linkedin, commentId, reply); break;
            case 'tiktok': if (!videoId) throw new Error('TikTok reply requires videoId'); await this.replyToTikTokComment(tokens.tiktok, videoId, commentId, reply); break;
            default: throw new Error(`Unsupported platform for reply: ${platform}`);
        }
    }

    async sendDM(platform: string, tokens: AgentTokens, recipientId: string, message: string): Promise<void> {
        this.log(`Dispatching DM on ${platform} to ${recipientId}`);
        switch (platform.toLowerCase()) {
            case 'facebook': await this.sendFacebookDM(tokens.facebook, recipientId, message); break;
            case 'instagram': await this.sendInstagramDM(tokens.instagram, recipientId, message); break;
            case 'twitter': case 'x': await this.sendTwitterDM(tokens.twitter, recipientId, message); break;
            case 'linkedin': await this.sendLinkedInMessage(tokens.linkedin, recipientId, message); break;
            case 'tiktok': throw new Error('TikTok does not support agent DMs via API');
            default: throw new Error(`Unsupported platform for DM: ${platform}`);
        }
    }

    // ─── TASK MANAGEMENT ─────────────────────────────────────────────────────────

    async scheduleTask(task: AgentTask): Promise<string> {
        const { data, error } = await this.supabase
            .from('agent_tasks')
            .insert({
                strategy_id: task.strategy_id,
                user_id: task.user_id,
                agent_type: task.agent_type,
                task_type: task.task_type,
                platform: task.platform,
                scheduled_at: task.scheduled_at,
                content: task.content,
                status: 'pending',
            })
            .select('id')
            .single();
        if (error) throw new Error(`Failed to schedule task: ${error.message}`);
        return data.id;
    }

    async completeTask(taskId: string, result: PublishResult & Record<string, any>): Promise<void> {
        await this.supabase.from('agent_tasks').update({
            status: 'done',
            executed_at: new Date().toISOString(),
            result,
        }).eq('id', taskId);
    }

    async failTask(taskId: string, error: string, retry: boolean = true): Promise<void> {
        const { data: task } = await this.supabase
            .from('agent_tasks')
            .select('retry_count')
            .eq('id', taskId)
            .single();
        const retryCount = (task?.retry_count || 0) + 1;
        const shouldRetry = retry && retryCount < 3;
        await this.supabase.from('agent_tasks').update({
            status: shouldRetry ? 'pending' : 'failed',
            error_message: error,
            retry_count: retryCount,
            ...(shouldRetry ? { scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() } : {}),
        }).eq('id', taskId);
    }

    // ─── SKILL BUILDER ───────────────────────────────────────────────────────────

    async buildSkill(params: { problem: string; context: string; strategyId: string }): Promise<string> {
        this.log(`Building new skill for: ${params.problem}`);
        const prompt = `
You are the AdRoom ${this.agentType} Agent. You encountered a gap and need to CREATE A NEW REUSABLE SKILL.

PROBLEM: ${params.problem}
CONTEXT: ${params.context}

Design a new autonomous marketing skill.
Return JSON:
{
  "skill_name": "snake_case_unique_name",
  "skill_description": "What this skill does",
  "trigger_condition": "Exactly when this skill should auto-activate",
  "execution_prompt": "GPT-4o prompt template. Use {{product}}, {{platform}}, {{goal}} as variables.",
  "parameters": { "required_inputs": ["list", "of", "keys"] },
  "success_metric": "How to measure if this skill worked"
}
`;
        const response = await this.ai.generateStrategy({}, prompt);
        const skill = response.parsedJson;
        if (!skill?.skill_name) { this.log('Skill builder returned invalid response'); return ''; }

        const { error } = await this.supabase.from('agent_skills').upsert({
            agent_type: this.agentType,
            skill_name: skill.skill_name,
            skill_description: skill.skill_description,
            trigger_condition: skill.trigger_condition,
            execution_prompt: skill.execution_prompt,
            parameters: skill.parameters || {},
            success_metric: skill.success_metric,
            created_by_agent_run: params.strategyId,
        }, { onConflict: 'skill_name' });

        if (error) this.log(`Failed to store skill: ${error.message}`);
        else this.log(`New skill stored: ${skill.skill_name}`);
        return skill.skill_name;
    }

    async useSkill(skillName: string, variables: Record<string, any>): Promise<any> {
        const { data: skill } = await this.supabase.from('agent_skills').select('*').eq('skill_name', skillName).single();
        if (!skill) { this.log(`Skill not found: ${skillName}`); return null; }

        let prompt = skill.execution_prompt;
        for (const [key, value] of Object.entries(variables)) {
            prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        const response = await this.ai.generateStrategy({}, prompt);
        await this.supabase.from('agent_skills').update({ used_count: (skill.used_count || 0) + 1, last_used_at: new Date().toISOString() }).eq('skill_name', skillName);
        return response.parsedJson || response.text;
    }

    // ─── PERFORMANCE TRACKING ────────────────────────────────────────────────────

    async fetchFacebookPostMetrics(postId: string, token: string): Promise<Record<string, number>> {
        try {
            const resp = await fetch(
                `${FB_GRAPH}/${postId}/insights?metric=post_impressions,post_reach,post_reactions_by_type_total,post_comments,post_shares&access_token=${token}`
            );
            if (!resp.ok) return {};
            const data: any = await resp.json();
            const metrics: Record<string, number> = {};
            for (const item of data?.data || []) {
                metrics[item.name] = item.values?.[item.values.length - 1]?.value || 0;
            }
            return metrics;
        } catch { return {}; }
    }

    async fetchTwitterPostMetrics(tweetId: string, token: string): Promise<Record<string, number>> {
        try {
            const resp = await fetch(
                `${TWITTER_API}/tweets/${tweetId}?tweet.fields=public_metrics`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) return {};
            const data: any = await resp.json();
            const m = data?.data?.public_metrics || {};
            return {
                impressions: m.impression_count || 0,
                likes: m.like_count || 0,
                replies: m.reply_count || 0,
                retweets: m.retweet_count || 0,
                quotes: m.quote_count || 0,
            };
        } catch { return {}; }
    }

    async recordPerformance(params: {
        strategyId: string;
        userId: string;
        taskId: string;
        platform: string;
        platformPostId: string;
        metrics: Record<string, number>;
    }): Promise<void> {
        const paidEquivalent = this.calculatePaidEquivalent(params.metrics, params.platform);
        await this.supabase.from('agent_performance').insert({
            strategy_id: params.strategyId,
            user_id: params.userId,
            agent_type: this.agentType,
            task_id: params.taskId,
            platform: params.platform,
            platform_post_id: params.platformPostId,
            impressions: params.metrics['post_impressions'] || params.metrics['impressions'] || 0,
            reach: params.metrics['post_reach'] || params.metrics['reach'] || 0,
            likes: params.metrics['post_reactions_by_type_total'] || params.metrics['likes'] || 0,
            comments: params.metrics['post_comments'] || params.metrics['comments'] || 0,
            shares: params.metrics['post_shares'] || params.metrics['shares'] || 0,
            paid_equivalent_usd: paidEquivalent,
            raw_platform_data: params.metrics,
        });
    }

    private calculatePaidEquivalent(metrics: Record<string, number>, platform: string): number {
        const reach = metrics['post_reach'] || metrics['reach'] || metrics['impressions'] || 0;
        const engagement = (metrics['post_comments'] || metrics['comments'] || 0) + (metrics['post_shares'] || metrics['retweets'] || 0);
        const CPM: Record<string, number> = { facebook: 8.5, instagram: 9.2, twitter: 6.1, linkedin: 28.0, tiktok: 4.5 };
        const cpm = CPM[platform] || 7;
        return parseFloat(((reach / 1000) * cpm + engagement * 0.5).toFixed(2));
    }

    // ─── INTERVENTION LOGGING ─────────────────────────────────────────────────────

    async logIntervention(params: {
        strategyId: string;
        problem: string;
        action: string;
        thinking: string;
        impactScore: number;
        intelligence: any;
    }): Promise<void> {
        await this.supabase.from('agent_interventions').insert({
            strategy_id: params.strategyId,
            agent_type: this.agentType,
            problem_detected: params.problem,
            thinking_process: params.thinking,
            action_taken: params.action,
            impact_score: params.impactScore,
            intelligence_used: params.intelligence,
        });
    }

    // ─── INTELLIGENCE RETRIEVAL ──────────────────────────────────────────────────

    async getLatestPlatformIntelligence(platform: string): Promise<any> {
        const { data } = await this.supabase
            .from('platform_intelligence')
            .select('*')
            .eq('platform', platform)
            .order('captured_at', { ascending: false })
            .limit(1)
            .single();
        return data;
    }

    async getTrendingTopics(category: string): Promise<string[]> {
        const { data } = await this.supabase
            .from('social_conversations')
            .select('topics')
            .eq('category', category)
            .order('collected_at', { ascending: false })
            .limit(50);
        const allTopics = (data || []).flatMap((r: any) => r.topics || []);
        const freq: Record<string, number> = {};
        for (const t of allTopics) freq[t] = (freq[t] || 0) + 1;
        return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
    }

    protected async getEmotionalOwnership(category: string): Promise<any[]> {
        const { data } = await this.supabase
            .from('emotional_ownership')
            .select('*')
            .eq('category', category)
            .order('ownership_percentage', { ascending: false })
            .limit(10);
        return data || [];
    }

    async getGeoNarratives(productName: string): Promise<any[]> {
        const { data } = await this.supabase
            .from('narrative_snapshots')
            .select('*')
            .ilike('query', `%${productName}%`)
            .order('captured_at', { ascending: false })
            .limit(5);
        return data || [];
    }

    async getProductDetails(productId: string): Promise<any> {
        if (!productId) return null;
        const { data } = await this.supabase.from('product_memory').select('*').eq('product_id', productId).single();
        return data;
    }
}
