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

const FB_GRAPH = 'https://graph.facebook.com/v25.0';
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
        userId?: string;
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
        const content = response.parsedJson || {
            headline: 'Check this out',
            body: params.context,
            image_prompt: `Professional marketing image for ${params.product?.product_name || 'product'}`,
            hashtags: [],
            cta: 'Learn more'
        };

        // Fire-and-forget critic evaluation (never blocks the pipeline)
        try {
            const { criticAgentService } = await import('../services/criticAgentService');
            const reviewText = [
                content.headline,
                content.body,
                content.cta,
                (content.hashtags || []).join(' '),
            ].filter(Boolean).join('\n\n');
            criticAgentService.analyze({
                output:    reviewText,
                agentType: this.agentType,
                taskType:  params.taskType,
                platform:  params.platform,
                userId:    params.userId,
                operation: `${params.taskType}_day${params.dayNumber}`,
            });
        } catch { /* critic is non-critical — never throw */ }

        return content;
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

        // TikTok requires video content — fall back to photo post API when no video URL
        if (!videoUrl) {
            this.log('No video URL provided — falling back to TikTok photo post');
            const photoResp = await fetch(`${TIKTOK_API}/post/publish/content/init/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                body: JSON.stringify({
                    post_info: {
                        title: body.substring(0, 150),
                        description: body.substring(0, 2200),
                        privacy_level: 'PUBLIC_TO_EVERYONE',
                        disable_duet: false,
                        disable_comment: false,
                        disable_stitch: false,
                        auto_add_music: true,
                    },
                    source_info: {
                        source: 'POST_API',
                        photo_cover_index: 0,
                        photo_images: [],
                    },
                    post_mode: 'DIRECT_POST',
                    media_type: 'PHOTO',
                }),
            });
            if (!photoResp.ok) {
                const err: any = await photoResp.json().catch(() => ({}));
                throw new Error(`TikTok Photo Post: ${err?.error?.message || JSON.stringify(err) || photoResp.statusText}`);
            }
            const photoData: any = await photoResp.json();
            const postId = photoData?.data?.publish_id || photoData?.data?.post_id || 'pending';
            this.log(`TikTok photo post submitted — publish_id: ${postId}`);
            return { platform: 'tiktok', platform_post_id: postId, published_at: new Date().toISOString() };
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

    async likeTikTokComment(tokens: AgentTokens['tiktok'], videoId: string, commentId: string): Promise<void> {
        if (!tokens) throw new Error('TikTok tokens not configured');
        this.log(`Liking TikTok comment ${commentId} on video ${videoId}`);
        const resp = await fetch(`${TIKTOK_API}/comment/like/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({ video_id: videoId, comment_id: commentId }),
        });
        if (!resp.ok) {
            const err: any = await resp.json().catch(() => ({}));
            this.log(`TikTok like comment failed: ${err?.error?.message || resp.statusText}`);
        } else {
            this.log(`TikTok comment ${commentId} liked`);
        }
    }

    async fetchTikTokVideoMetrics(tokens: AgentTokens['tiktok'], videoId: string): Promise<Record<string, number>> {
        if (!tokens) return {};
        try {
            const resp = await fetch(`${TIKTOK_API}/video/query/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                body: JSON.stringify({
                    filters: { video_ids: [videoId] },
                    fields: ['id', 'like_count', 'comment_count', 'share_count', 'view_count', 'play_count'],
                }),
            });
            if (!resp.ok) return {};
            const data: any = await resp.json();
            const video = data?.data?.videos?.[0] || {};
            return {
                likes: video.like_count || 0,
                comments: video.comment_count || 0,
                shares: video.share_count || 0,
                views: video.view_count || video.play_count || 0,
            };
        } catch { return {}; }
    }

    async scanTikTokLeads(tokens: AgentTokens['tiktok'], videoId: string): Promise<Array<{ open_id: string; display_name: string; bio_description?: string }>> {
        if (!tokens) return [];
        try {
            // Fetch top commenters on this video — they are warm leads who engaged.
            const resp = await fetch(`${TIKTOK_API}/comment/list/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                body: JSON.stringify({
                    video_id: videoId,
                    count: 50,
                    fields: ['id', 'text', 'create_time', 'user.open_id', 'user.display_name', 'user.bio_description'],
                }),
            });
            if (!resp.ok) return [];
            const data: any = await resp.json();
            const comments: any[] = data?.data?.comments || [];
            const seen = new Set<string>();
            const leads: Array<{ open_id: string; display_name: string; bio_description?: string }> = [];
            for (const c of comments) {
                const uid = c?.user?.open_id;
                if (uid && !seen.has(uid)) {
                    seen.add(uid);
                    leads.push({
                        open_id: uid,
                        display_name: c?.user?.display_name || '',
                        bio_description: c?.user?.bio_description || undefined,
                    });
                }
            }
            this.log(`TikTok lead scan: found ${leads.length} unique commenters on video ${videoId}`);
            return leads;
        } catch { return []; }
    }

    async sendTikTokOutreach(tokens: AgentTokens['tiktok'], videoId: string, targetCommentId: string, message: string): Promise<void> {
        // TikTok's public API does not support direct messaging to arbitrary users.
        // The best available engagement alternative is replying publicly to their comment,
        // which surfaces the message to the lead directly in their notification feed.
        await this.replyToTikTokComment(tokens, videoId, targetCommentId, message);
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
            case 'tiktok':
                // TikTok public API does not support DMs. We outreach via comment reply instead.
                // recipientId should be formatted as "videoId:commentId" for TikTok outreach.
                {
                    const [videoId, commentId] = recipientId.split(':');
                    if (videoId && commentId) {
                        await this.sendTikTokOutreach(tokens.tiktok, videoId, commentId, message);
                    } else {
                        this.log(`TikTok outreach skipped: recipientId must be "videoId:commentId", got "${recipientId}"`);
                    }
                }
                break;
            default: throw new Error(`Unsupported platform for DM: ${platform}`);
        }
    }

    async likeObject(platform: string, tokens: AgentTokens, objectId: string, videoId?: string): Promise<void> {
        this.log(`Liking object ${objectId} on ${platform}`);
        switch (platform.toLowerCase()) {
            case 'facebook': await this.likeFacebookObject(tokens.facebook, objectId); break;
            case 'tiktok':
                if (!videoId) { this.log('TikTok like requires videoId'); return; }
                await this.likeTikTokComment(tokens.tiktok, videoId, objectId);
                break;
            default: this.log(`Like not implemented for ${platform}`);
        }
    }

    async fetchPostMetrics(platform: string, tokens: AgentTokens, postId: string): Promise<Record<string, number>> {
        switch (platform.toLowerCase()) {
            case 'facebook': return this.fetchFacebookPostMetrics(postId, tokens.facebook?.access_token || '');
            case 'twitter': case 'x': return this.fetchTwitterPostMetrics(postId, tokens.twitter?.access_token || '');
            case 'tiktok': return this.fetchTikTokVideoMetrics(tokens.tiktok, postId);
            default: return {};
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
        // The AI Brain designs the skill as a pure description — NO templates,
        // NO placeholders, NO fixed strings. When the skill is USED, the AI Brain
        // writes a completely fresh prompt from the description and live variables.
        const prompt = `You are the AdRoom ${this.agentType} Agent. You encountered a gap and must create a reusable autonomous marketing skill.

PROBLEM ENCOUNTERED: ${params.problem}
EXECUTION CONTEXT: ${params.context}

Design a skill that the AI Brain can invoke autonomously in the future.
Return JSON — all fields must be prose descriptions, NOT templates with placeholders:
{
  "skill_name": "snake_case_unique_name_max_60_chars",
  "skill_description": "What this skill does in plain prose — describe the goal, the approach, and the expected output in 2-3 sentences",
  "trigger_condition": "Describe the exact situation that should activate this skill in one sentence",
  "what_data_to_use": "List the data the AI Brain should gather before executing — e.g. product name, lead message, platform performance. This guides fresh prompt construction at runtime.",
  "what_to_produce": "Describe in prose what the AI Brain should output when using this skill — e.g. a direct sales reply, a content post, an analysis report",
  "success_metric": "How to measure whether the skill execution was successful"
}`;
        const response = await this.ai.generateStrategy({}, prompt);
        const skill = response.parsedJson;
        if (!skill?.skill_name) { this.log('Skill builder returned invalid response'); return ''; }

        const { error } = await this.supabase.from('agent_skills').upsert({
            agent_type: this.agentType,
            skill_name: skill.skill_name,
            skill_description: skill.skill_description,
            trigger_condition: skill.trigger_condition,
            // execution_prompt now stores a prose description — NOT a template.
            // useSkill() will have the AI Brain write a fresh prompt from this each time.
            execution_prompt: `SKILL GOAL: ${skill.skill_description}\n\nDATA TO USE: ${skill.what_data_to_use}\n\nOUTPUT EXPECTED: ${skill.what_to_produce}`,
            parameters: { what_data_to_use: skill.what_data_to_use, what_to_produce: skill.what_to_produce },
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

        // The AI Brain writes a completely fresh prompt each time — never reuses or
        // substitutes into a stored template. The stored description tells it what to
        // do and what data matters; the live variables provide the actual content.
        const freshPromptBuilder = `You are the AdRoom ${this.agentType} AI Brain executing a learned skill.

SKILL DESCRIPTION:
${skill.execution_prompt}

LIVE DATA AVAILABLE FOR THIS EXECUTION:
${Object.entries(variables).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300)}`).join('\n')}

Based only on the skill description and the live data above, produce the output now. Write a response that directly executes the skill goal. Be specific, use the live data, and produce immediately actionable output. Do not reference the skill name or description in your response.`;

        const response = await this.ai.generateStrategy({}, freshPromptBuilder);
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

    // ─── INSTAGRAM EXTENDED ACTIVITIES ───────────────────────────────────────────

    async likeInstagramComment(tokens: AgentTokens['instagram'], commentId: string): Promise<void> {
        if (!tokens) return;
        try {
            await fetch(`${FB_GRAPH}/${commentId}/likes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: tokens.access_token }),
            });
            this.log(`Instagram comment ${commentId} liked`);
        } catch (e: any) { this.log(`Instagram like comment failed: ${e.message}`); }
    }

    async fetchInstagramPostMetrics(tokens: AgentTokens['instagram'], mediaId: string): Promise<Record<string, number>> {
        if (!tokens) return {};
        try {
            const fields = 'impressions,reach,likes_count,comments_count,shares,saved,total_interactions,plays';
            const resp = await fetch(
                `${FB_GRAPH}/${mediaId}/insights?metric=${fields}&access_token=${tokens.access_token}`
            );
            if (!resp.ok) return {};
            const data: any = await resp.json();
            const metrics: Record<string, number> = {};
            for (const item of data?.data || []) {
                metrics[item.name] = item.values?.[item.values.length - 1]?.value ?? item.value ?? 0;
            }
            return metrics;
        } catch { return {}; }
    }

    async fetchInstagramComments(tokens: AgentTokens['instagram'], mediaId: string): Promise<Array<{ id: string; text: string; username: string; timestamp: string }>> {
        if (!tokens) return [];
        try {
            const resp = await fetch(
                `${FB_GRAPH}/${mediaId}/comments?fields=id,text,username,timestamp&access_token=${tokens.access_token}`
            );
            if (!resp.ok) return [];
            const data: any = await resp.json();
            return (data?.data || []).map((c: any) => ({
                id: c.id,
                text: c.text || '',
                username: c.username || '',
                timestamp: c.timestamp || '',
            }));
        } catch { return []; }
    }

    // ─── TWITTER/X EXTENDED ACTIVITIES ───────────────────────────────────────────

    async likeTweet(tokens: AgentTokens['twitter'], tweetId: string, twitterUserId: string): Promise<void> {
        if (!tokens) return;
        try {
            const resp = await fetch(`${TWITTER_API}/users/${twitterUserId}/likes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
                body: JSON.stringify({ tweet_id: tweetId }),
            });
            if (resp.ok) this.log(`Tweet ${tweetId} liked`);
        } catch (e: any) { this.log(`Twitter like failed: ${e.message}`); }
    }

    async retweetPost(tokens: AgentTokens['twitter'], tweetId: string, twitterUserId: string): Promise<void> {
        if (!tokens) return;
        try {
            const resp = await fetch(`${TWITTER_API}/users/${twitterUserId}/retweets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
                body: JSON.stringify({ tweet_id: tweetId }),
            });
            if (resp.ok) this.log(`Tweet ${tweetId} retweeted`);
        } catch (e: any) { this.log(`Twitter retweet failed: ${e.message}`); }
    }

    async quoteTweet(tokens: AgentTokens['twitter'], quotedTweetId: string, comment: string): Promise<string | null> {
        if (!tokens) return null;
        try {
            const resp = await fetch(`${TWITTER_API}/tweets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
                body: JSON.stringify({ text: comment.slice(0, 250), quote_tweet_id: quotedTweetId }),
            });
            if (!resp.ok) return null;
            const data: any = await resp.json();
            const newTweetId = data.data?.id || null;
            if (newTweetId) this.log(`Quote tweet posted: ${newTweetId}`);
            return newTweetId;
        } catch (e: any) { this.log(`Quote tweet failed: ${e.message}`); return null; }
    }

    async fetchTwitterMentions(tokens: AgentTokens['twitter'], twitterUserId: string, sinceId?: string): Promise<Array<{ id: string; text: string; authorId: string; createdAt: string }>> {
        if (!tokens) return [];
        try {
            const params = new URLSearchParams({
                'tweet.fields': 'author_id,created_at,public_metrics',
                max_results: '25',
            });
            if (sinceId) params.set('since_id', sinceId);
            const resp = await fetch(`${TWITTER_API}/users/${twitterUserId}/mentions?${params}`, {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` },
            });
            if (!resp.ok) return [];
            const data: any = await resp.json();
            return (data?.data || []).map((t: any) => ({
                id: t.id,
                text: t.text,
                authorId: t.author_id,
                createdAt: t.created_at,
            }));
        } catch { return []; }
    }

    async fetchTwitterReplies(tokens: AgentTokens['twitter'], tweetId: string): Promise<Array<{ id: string; text: string; authorId: string }>> {
        if (!tokens) return [];
        try {
            const resp = await fetch(
                `${TWITTER_API}/tweets/search/recent?query=conversation_id:${tweetId}&tweet.fields=author_id,public_metrics&max_results=25`,
                { headers: { 'Authorization': `Bearer ${tokens.access_token}` } }
            );
            if (!resp.ok) return [];
            const data: any = await resp.json();
            return (data?.data || []).map((t: any) => ({ id: t.id, text: t.text, authorId: t.author_id }));
        } catch { return []; }
    }

    // ─── LINKEDIN EXTENDED ACTIVITIES ────────────────────────────────────────────

    async likeLinkedInPost(tokens: AgentTokens['linkedin'], postUrn: string): Promise<void> {
        if (!tokens) return;
        try {
            const authorUrn = tokens.org_urn || tokens.person_urn;
            const resp = await fetch(`${LINKEDIN_API}/reactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'X-Restli-Protocol-Version': '2.0.0',
                },
                body: JSON.stringify({
                    actor: authorUrn,
                    object: postUrn,
                    reactionType: 'LIKE',
                }),
            });
            if (resp.ok) this.log(`LinkedIn post ${postUrn} liked`);
        } catch (e: any) { this.log(`LinkedIn like failed: ${e.message}`); }
    }

    async fetchLinkedInPostMetrics(tokens: AgentTokens['linkedin'], postUrn: string): Promise<Record<string, number>> {
        if (!tokens) return {};
        try {
            const encodedUrn = encodeURIComponent(postUrn);
            const resp = await fetch(
                `${LINKEDIN_API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodedUrn}&shareUrns[0]=${encodedUrn}`,
                {
                    headers: {
                        'Authorization': `Bearer ${tokens.access_token}`,
                        'X-Restli-Protocol-Version': '2.0.0',
                    },
                }
            );
            if (!resp.ok) return {};
            const data: any = await resp.json();
            const stats = data?.elements?.[0]?.totalShareStatistics || {};
            return {
                impressions: stats.impressionCount || 0,
                clicks: stats.clickCount || 0,
                likes: stats.likeCount || 0,
                comments: stats.commentCount || 0,
                shares: stats.shareCount || 0,
                engagement: stats.engagement || 0,
                reach: stats.uniqueImpressionsCount || 0,
            };
        } catch { return {}; }
    }

    async fetchLinkedInComments(tokens: AgentTokens['linkedin'], postUrn: string): Promise<Array<{ id: string; text: string; authorUrn: string; createdAt: number }>> {
        if (!tokens) return [];
        try {
            const encodedUrn = encodeURIComponent(postUrn);
            const resp = await fetch(
                `${LINKEDIN_API}/comments?q=object&object=${encodedUrn}&count=25`,
                {
                    headers: {
                        'Authorization': `Bearer ${tokens.access_token}`,
                        'X-Restli-Protocol-Version': '2.0.0',
                    },
                }
            );
            if (!resp.ok) return [];
            const data: any = await resp.json();
            return (data?.elements || []).map((c: any) => ({
                id: c.id || c.$URN || '',
                text: c.message?.text || '',
                authorUrn: c.actor || '',
                createdAt: c.created?.time || 0,
            }));
        } catch { return []; }
    }

    // ─── QUICK REPLY GENERATOR ───────────────────────────────────────────────────

    /**
     * Generate a quick, contextual reply to a comment or mention.
     * Natural, human-sounding, goal-aligned.
     */
    async generateQuickReply(commentText: string, goal: string, product: any, platform = 'social'): Promise<string | null> {
        try {
            // ── Guardrail check before generating any reply ──────────────────
            const { analyzeIncomingMessage } = await import('../services/guardrailService');
            const guard = await analyzeIncomingMessage(commentText, '', 0, {
                platform,
                productName: product?.name || product?.product_name,
            });
            if (!guard.isSafe && guard.dynamicRedirect) {
                this.log(`Guardrail triggered (${guard.threatType}) — sending dynamic redirect`);
                return guard.dynamicRedirect.substring(0, 120);
            }
            // ────────────────────────────────────────────────────────────────

            const result = await this.ai.generateStrategy({}, `
You are the AdRoom ${this.agentType} Agent replying to a social media comment.

COMMENT: "${commentText}"
PRODUCT: ${JSON.stringify(product)}
GOAL: ${goal}

Write a genuine, human reply (max 120 chars). No marketing jargon. No "I noticed you commented". Feels like a real person replied.
For SALESMAN goal: warm, helpful, nudge toward purchase without being pushy.
For AWARENESS goal: enthusiastic, invite to share, build community.
For PROMOTION goal: create mild urgency, mention offer if relevant.
For LAUNCH goal: build excitement, exclusive energy.

Return ONLY the reply text, nothing else.
`);
            return result.text?.trim().replace(/^"|"$/g, '').substring(0, 120) || null;
        } catch { return null; }
    }

    // ─── UNIFIED COMMENT SCANNER ──────────────────────────────────────────────────

    /**
     * COMMENT SCAN & SMART REPLY: Fetch comments on a published post, use AI to
     * identify high-intent or engaged commenters, and reply to them intelligently.
     * Self-aware: learns from what type of comments drive conversions for this goal.
     */
    async scanAndReplyComments(params: {
        platform: string;
        tokens: AgentTokens;
        postId: string;
        goal: string;
        product: any;
        strategyId: string;
        userId: string;
    }): Promise<{ replied: number; leads: number }> {
        this.log(`Scanning comments on ${params.platform} post ${params.postId}`);
        let comments: Array<{ id: string; text: string; username?: string; authorId?: string }> = [];

        try {
            switch (params.platform.toLowerCase()) {
                case 'facebook':
                    {
                        const resp = await fetch(
                            `${FB_GRAPH}/${params.postId}/comments?fields=id,message,from&access_token=${params.tokens.facebook?.access_token}`
                        );
                        if (resp.ok) {
                            const data: any = await resp.json();
                            comments = (data?.data || []).map((c: any) => ({ id: c.id, text: c.message || '', username: c.from?.name, authorId: c.from?.id }));
                        }
                    }
                    break;
                case 'instagram':
                    if (params.tokens.instagram) {
                        const igComments = await this.fetchInstagramComments(params.tokens.instagram, params.postId);
                        comments = igComments.map(c => ({ id: c.id, text: c.text, username: c.username }));
                    }
                    break;
                case 'twitter':
                case 'x':
                    if (params.tokens.twitter) {
                        const replies = await this.fetchTwitterReplies(params.tokens.twitter, params.postId);
                        comments = replies.map(r => ({ id: r.id, text: r.text, authorId: r.authorId }));
                    }
                    break;
                case 'linkedin':
                    if (params.tokens.linkedin) {
                        const liComments = await this.fetchLinkedInComments(params.tokens.linkedin, params.postId);
                        comments = liComments.map(c => ({ id: c.id, text: c.text, authorId: c.authorUrn }));
                    }
                    break;
                case 'tiktok':
                    if (params.tokens.tiktok) {
                        const tikLeads = await this.scanTikTokLeads(params.tokens.tiktok, params.postId);
                        comments = tikLeads.map(l => ({ id: l.open_id, text: l.bio_description || '', username: l.display_name }));
                    }
                    break;
            }
        } catch (e: any) {
            this.log(`Comment fetch failed on ${params.platform}: ${e.message}`);
            return { replied: 0, leads: 0 };
        }

        if (!comments.length) return { replied: 0, leads: 0 };

        // ── Step 1: Pull interaction history for each commenter from social_conversations ──
        const authorIds = comments.map(c => c.authorId || c.username).filter(Boolean);
        let historyByAuthor: Record<string, string> = {};
        try {
            if (authorIds.length > 0) {
                const { data: histRows } = await this.supabase
                    .from('social_conversations')
                    .select('author, content, intent, sentiment, collected_at')
                    .eq('source', params.platform)
                    .in('author', authorIds)
                    .order('collected_at', { ascending: false })
                    .limit(40);
                for (const row of (histRows || [])) {
                    if (!historyByAuthor[row.author]) {
                        historyByAuthor[row.author] = `Previous (${new Date(row.collected_at).toLocaleDateString()}): "${(row.content || '').slice(0, 80)}" [intent: ${row.intent || 'unknown'}, sentiment: ${row.sentiment?.toFixed(2) ?? 'n/a'}]`;
                    }
                }
            }
        } catch { /* history fetch failure must never block replies */ }

        // ── Step 2: Use AI Brain to classify each comment and generate smart replies ──
        // History context is injected per-commenter so the AI can personalize replies
        const classifyPrompt = `
You are the AdRoom ${this.agentType} Agent analyzing comments on a ${params.platform} post.

PRODUCT: ${JSON.stringify(params.product)}
GOAL: ${params.goal}
COMMENTS (max 20):
${comments.slice(0, 20).map((c, i) => {
    const authorKey = c.authorId || c.username || '';
    const history = historyByAuthor[authorKey] ? `\n   [History: ${historyByAuthor[authorKey]}]` : '';
    return `${i + 1}. "${c.text}" — ${c.username || c.authorId || 'user'}${history}`;
}).join('\n')}

For EACH comment, analyze:
- intent: what does this person actually want? (question, praise, complaint, buying_intent, price_inquiry, spam)
- sentiment: positive / neutral / negative
- urgency: does this need a fast reply?
- relationship: are they a returning commenter? (check history if available)

Then decide:
1. HIGH-INTENT lead (asking price, where to buy, "interested", want to order) → reply + mark as lead
2. Positive engagement (compliment, share, love it) → reply warmly to amplify
3. Question → answer helpfully to build trust and authority
4. Negative but genuine → acknowledge and resolve, do NOT skip
5. Spam / irrelevant → skip

REPLY RULES:
- Natural, human, max 120 chars — sounds like a real person, not a brand account
- Never say "I noticed you commented", "As an AI", or generic marketing phrases
- If history shows this person has engaged before, acknowledge the relationship naturally
- Match the tone and energy of their comment

Return JSON:
{
  "replies": [
    {
      "comment_index": 0,
      "should_reply": true,
      "is_lead": true,
      "intent": "buying_intent",
      "sentiment": "positive",
      "reply": "reply text (natural, human, max 120 chars)",
      "lead_intent": "buying_intent|curiosity|price_inquiry|general_interest",
      "is_returning": false
    }
  ]
}
Only include comments that should be replied to.`;

        let replyPlan: any[] = [];
        try {
            const aiResult = await this.ai.generateStrategy({}, classifyPrompt);
            replyPlan = aiResult.parsedJson?.replies || [];
        } catch { return { replied: 0, leads: 0 }; }

        let replied = 0;
        let leads = 0;
        const now = new Date().toISOString();

        // Track per-author guardrail attempt counts for this scan run
        const guardrailAttempts: Record<string, number> = {};
        const { analyzeIncomingMessage } = await import('../services/guardrailService');

        for (const plan of replyPlan.slice(0, 8)) {
            if (!plan.should_reply) continue;
            const comment = comments[plan.comment_index];
            if (!comment) continue;

            try {
                // ── Guardrail check: run before posting any reply ────────────
                const authorKey = comment.authorId || comment.username || comment.id;
                const priorAttempts = guardrailAttempts[authorKey] || 0;
                const guard = await analyzeIncomingMessage(
                    comment.text,
                    historyByAuthor[authorKey] || '',
                    priorAttempts,
                    { platform: params.platform, productName: params.product?.name || params.product?.product_name }
                );
                if (!guard.isSafe) {
                    guardrailAttempts[authorKey] = guard.attemptCount;
                    if (guard.dynamicRedirect) {
                        plan.reply = guard.dynamicRedirect.substring(0, 120);
                    } else {
                        continue; // no redirect available — skip this comment silently
                    }
                }
                // ────────────────────────────────────────────────────────────

                // ── Step 3: Post the reply on the platform ──
                switch (params.platform.toLowerCase()) {
                    case 'facebook':
                        if (params.tokens.facebook) {
                            await this.replyToFacebookComment(params.tokens.facebook, comment.id, plan.reply);
                        }
                        break;
                    case 'instagram':
                        if (params.tokens.instagram) {
                            await this.replyToInstagramComment(params.tokens.instagram, comment.id, plan.reply);
                        }
                        break;
                    case 'twitter':
                    case 'x':
                        if (params.tokens.twitter) {
                            await this.replyToTwitterPost(params.tokens.twitter, comment.id, plan.reply);
                        }
                        break;
                    case 'linkedin':
                        if (params.tokens.linkedin) {
                            await this.replyToLinkedInComment(params.tokens.linkedin, comment.id, plan.reply);
                        }
                        break;
                    case 'tiktok':
                        if (params.tokens.tiktok) {
                            await this.replyToTikTokComment(params.tokens.tiktok, params.postId, comment.id, plan.reply);
                        }
                        break;
                }
                replied++;

                // ── Step 4: Store interaction in social_conversations for future learning ──
                // This enables history-aware replies on subsequent encounters with the same user
                const authorKeyLog = comment.authorId || comment.username || 'unknown';
                (async () => {
                    try {
                        await this.supabase.from('social_conversations').upsert({
                            id: `${params.platform}-${comment.id}`,
                            source: params.platform,
                            source_id: comment.id,
                            content: comment.text,
                            author: authorKeyLog,
                            posted_at: now,
                            collected_at: now,
                            category: params.product?.category || 'general',
                            intent: plan.intent || plan.lead_intent || 'general_interest',
                            sentiment: plan.sentiment === 'positive' ? 0.8 : plan.sentiment === 'negative' ? 0.2 : 0.5,
                            topics: [params.platform, params.goal, plan.intent].filter(Boolean),
                            entities: {
                                reply_sent: plan.reply,
                                is_lead: plan.is_lead,
                                is_returning: plan.is_returning || false,
                                strategy_id: params.strategyId,
                                post_id: params.postId,
                                agent_type: this.agentType,
                            },
                        }, { onConflict: 'id' });
                    } catch { /* non-blocking */ }
                })();

                // ── Step 5: Register as lead if high intent ──
                if (plan.is_lead && comment.authorId) {
                    await this.supabase.from('agent_leads').upsert({
                        user_id: params.userId,
                        strategy_id: params.strategyId,
                        platform: params.platform,
                        platform_user_id: comment.authorId,
                        platform_username: comment.username || comment.authorId,
                        lead_type: 'COMMENT_LEAD',
                        intent: plan.lead_intent || 'general_interest',
                        stage: plan.is_returning ? 'warm' : 'new',
                        intent_score: plan.intent === 'buying_intent' ? 0.85 : plan.intent === 'price_inquiry' ? 0.75 : 0.55,
                        first_interaction: comment.text.substring(0, 300),
                        dm_sequence_step: 0,
                        created_at: new Date().toISOString(),
                    }, { onConflict: 'platform,platform_user_id,user_id' });
                    leads++;
                }
            } catch (e: any) {
                this.log(`Reply failed on comment ${comment.id}: ${e.message}`);
            }
        }

        this.log(`Comment scan complete on ${params.platform}: ${replied} replies sent, ${leads} new leads (history-aware)`);
        return { replied, leads };
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

    /**
     * Fetches ALL 4 intelligence streams in parallel for a given task context.
     * Call this at the start of every executeTask and pass the result straight
     * into generatePlatformContent so every agent always works with live data.
     */
    async fetchLiveIntelligence(params: {
        platform: string;
        category: string;
        productName: string;
    }): Promise<{ platformIntel: any; socialData: any[]; emotionalData: any[]; geoData: any[] }> {
        const [platformIntel, socialData, emotionalData, geoData] = await Promise.all([
            this.getLatestPlatformIntelligence(params.platform),
            this.getLatestSocialConversations(params.category),
            this.getEmotionalOwnership(params.category),
            this.getGeoNarratives(params.productName),
        ]);
        return { platformIntel, socialData, emotionalData, geoData };
    }

    private async getLatestSocialConversations(category: string): Promise<any[]> {
        const { data } = await this.supabase
            .from('social_conversations')
            .select('content, topics, sentiment, intent, entities')
            .eq('category', category)
            .order('collected_at', { ascending: false })
            .limit(20);
        return data || [];
    }

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

    /**
     * GOOGLE MAPS OUTREACH SCHEDULING:
     * Called by every agent's plan() after scheduling social content tasks.
     * Schedules GMAPS_OUTREACH tasks at Day 1, 7, 14, 21... so the agent
     * automatically discovers and contacts local businesses throughout the
     * campaign — regardless of strategy type (product / brand / service).
     *
     * Location priority: product.delivery_address → product.location →
     * product.address → product.city → strategy.target_location → (skip)
     */
    async scheduleGoogleMapsOutreachTasks(params: {
        strategyId: string;
        userId: string;
        product: any;
        strategy: any;
        agentType: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';
        durationDays: number;
    }): Promise<number> {
        const p = params.product || {};
        const s = params.strategy || {};

        // Resolve best available location
        const location: string =
            p.delivery_address ||
            p.location ||
            p.address ||
            p.city ||
            s.target_location ||
            s.location ||
            (s.estimated_outcomes?.target_market) ||
            '';

        if (!location || location.trim().length < 3) {
            this.log(`scheduleGoogleMapsOutreachTasks: no location found — skipping for strategy ${params.strategyId}`);
            return 0;
        }

        // Resolve search keyword from product category / goal type
        const keyword: string =
            p.category ||
            p.product_type ||
            p.service_type ||
            p.niche ||
            s.goal ||
            'local business';

        // Sender identity
        const senderName: string = p.contact_name || p.brand_name || p.product_name || 'the team';
        const productOrService: string = p.product_name || p.service_name || p.brand_name || keyword;

        // Outreach channel — prefer whatsapp; fall back to email
        const outreachChannel: 'whatsapp' | 'email' = 'whatsapp';

        // Schedule at Day 1 then every 7 days throughout campaign
        const intervals: number[] = [1];
        for (let d = 7; d <= params.durationDays; d += 7) intervals.push(d);

        const now = new Date();
        const tasks = intervals.map(day => {
            const scheduledAt = new Date(now);
            scheduledAt.setDate(scheduledAt.getDate() + (day - 1));
            scheduledAt.setHours(8, 30, 0, 0); // 08:30 — before business hours start

            return {
                strategy_id: params.strategyId,
                user_id: params.userId,
                agent_type: params.agentType,
                task_type: 'GMAPS_OUTREACH',
                platform: 'gmaps',
                scheduled_at: scheduledAt.toISOString(),
                status: 'pending',
                content: {
                    location,
                    keyword,
                    sender_name: senderName,
                    product_or_service: productOrService,
                    outreach_channel: outreachChannel,
                    campaign_day: day,
                }
            };
        });

        const { error } = await this.supabase.from('agent_tasks').insert(tasks);
        if (error) {
            this.log(`GMAPS task scheduling error: ${error.message}`);
            return 0;
        }

        this.log(`Scheduled ${tasks.length} GMAPS_OUTREACH tasks for location "${location}" (${keyword}) across ${params.durationDays}-day campaign`);
        return tasks.length;
    }

    // ─── SELF-LEARNING ENGINE ────────────────────────────────────────────────────
    /**
     * Runs after every task execution. Fetches fresh performance data, uses AI to
     * analyse what content/tactics worked best, and updates agent_skills so future
     * tasks automatically use the learned optimisations. Results are broadcast to
     * the admin network graph in real-time.
     */
    async selfLearnFromPerformance(strategyId: string, userId: string): Promise<void> {
        try {
            // Fetch recent completed tasks (last 20) + performance for this strategy
            const [tasksRes, perfRes, stratRes] = await Promise.all([
                this.supabase
                    .from('agent_tasks')
                    .select('id, task_type, platform, content, result, executed_at')
                    .eq('strategy_id', strategyId)
                    .eq('user_id', userId)
                    .eq('agent_type', this.agentType)
                    .eq('status', 'done')
                    .order('executed_at', { ascending: false })
                    .limit(20),
                this.supabase
                    .from('agent_performance')
                    .select('platform, reach, likes, comments, shares, conversions, fetched_at')
                    .eq('strategy_id', strategyId)
                    .eq('user_id', userId)
                    .order('fetched_at', { ascending: false })
                    .limit(10),
                this.supabase
                    .from('strategies')
                    .select('goal, current_execution_plan, product_memory')
                    .eq('id', strategyId)
                    .single(),
            ]);

            const recentTasks = tasksRes.data || [];
            const recentPerf = perfRes.data || [];
            const strategy = stratRes.data;

            if (recentTasks.length < 3 && recentPerf.length === 0) return; // Not enough data yet

            const totalReach = recentPerf.reduce((s: number, p: any) => s + (p.reach || 0), 0);
            const totalEngagement = recentPerf.reduce((s: number, p: any) => s + (p.likes || 0) + (p.comments || 0) + (p.shares || 0), 0);
            const platformBreakdown = recentPerf.reduce((acc: Record<string, any>, p: any) => {
                acc[p.platform] = { reach: (acc[p.platform]?.reach || 0) + (p.reach || 0), engagement: (acc[p.platform]?.engagement || 0) + (p.likes || 0) + (p.comments || 0) };
                return acc;
            }, {});
            const bestPlatform = Object.entries(platformBreakdown).sort((a: any, b: any) => b[1].reach - a[1].reach)[0]?.[0] || null;

            const prompt = `
You are the AdRoom ${this.agentType} Agent performing SELF-LEARNING after recent campaign execution.

STRATEGY GOAL: ${strategy?.goal || 'Unknown'}
RECENT TASKS: ${JSON.stringify(recentTasks.slice(0, 5))}
PERFORMANCE DATA: ${JSON.stringify(recentPerf)}
TOTAL REACH: ${totalReach}
TOTAL ENGAGEMENT: ${totalEngagement}
BEST PLATFORM: ${bestPlatform || 'unknown'}
PLATFORM BREAKDOWN: ${JSON.stringify(platformBreakdown)}

Analyse what worked, what didn't, and derive 1–2 concrete learnable tactics.
Return JSON ONLY:
{
  "key_insight": "One sentence: what's working or failing",
  "best_tactic": "The specific content/timing/platform tactic that drove the most results",
  "avoid_tactic": "What to stop doing based on low performance",
  "skill_name": "snake_case_skill_name (max 40 chars)",
  "skill_description": "Short description of the learned skill",
  "learning_description": "In plain prose (NO placeholders, NO templates): describe exactly what worked, what data drove the result, and what the AI Brain should do in the same situation in the future",
  "confidence": 0.0
}
`;
            const response = await this.ai.generateStrategy({}, prompt);
            const learning = response.parsedJson;

            if (!learning?.skill_name || (learning.confidence || 0) < 0.4) {
                this.log(`Self-learning: low confidence (${learning?.confidence ?? 0}) — skipping skill update`);
                return;
            }

            // Upsert the learned skill into agent_skills.
            // execution_prompt is stored as a prose description — no templates or
            // placeholders — so useSkill() can write a fresh prompt from it each time.
            const skillDesc = learning.learning_description || learning.skill_description || learning.best_tactic || '';
            await this.supabase.from('agent_skills').upsert({
                agent_type: this.agentType,
                skill_name: `${this.agentType.toLowerCase()}_${learning.skill_name}`.slice(0, 80),
                skill_description: learning.skill_description,
                trigger_condition: `Use when: ${learning.key_insight}`,
                execution_prompt: `SKILL GOAL: ${learning.skill_description}\n\nWHAT WORKED: ${skillDesc}\n\nAVOID: ${learning.avoid_tactic || 'nothing flagged'}`,
                parameters: { best_platform: bestPlatform, confidence: learning.confidence },
                success_metric: `Reach >${totalReach}, Engagement >${totalEngagement}`,
                created_by_agent_run: strategyId,
            }, { onConflict: 'skill_name' });

            // Store the learning as an intervention log entry
            await this.supabase.from('agent_interventions').insert({
                strategy_id: strategyId,
                user_id: userId,
                agent_type: this.agentType,
                problem: `Self-learning cycle — reach: ${totalReach}, engagement: ${totalEngagement}`,
                action: `Learned: ${learning.best_tactic}`,
                thinking: `Insight: ${learning.key_insight} | Avoid: ${learning.avoid_tactic}`,
                impact_score: learning.confidence,
                intelligence: { perf: recentPerf.slice(0, 3), tasks: recentTasks.length },
                created_at: new Date().toISOString(),
            });

            this.log(`Self-learning complete: skill "${learning.skill_name}" (confidence ${learning.confidence?.toFixed(2)})`);

            // Broadcast to admin network graph
            try {
                const { adminBroadcast } = await import('../admin/adminRouter');
                adminBroadcast('agent_learning', {
                    agent_type: this.agentType,
                    skill_name: learning.skill_name,
                    insight: learning.key_insight,
                    best_platform: bestPlatform,
                    reach: totalReach,
                    engagement: totalEngagement,
                    confidence: learning.confidence,
                });
            } catch {}
        } catch (e: any) {
            this.log(`Self-learning error: ${e.message}`);
        }
    }
}
