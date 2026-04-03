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
            console.log(`[${this.agentType}] [${ts}] ${msg}`, typeof data === 'object' ? JSON.stringify(data).slice(0, 400) : data);
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
        instructionOverride?: string;
    }): Promise<{ headline: string; body: string; image_prompt: string; hashtags: string[]; cta: string }> {
        const prompt = `
You are the AdRoom ${this.agentType} Agent generating PRODUCTION-READY social content.

PLATFORM: ${params.platform}
GOAL: ${params.goal}
AGENT TYPE: ${this.agentType}
PRODUCT: ${JSON.stringify(params.product)}
DAY: ${params.dayNumber} of ${params.totalDays}
TASK TYPE: ${params.taskType}
BRAND VOICE: ${params.brandVoice || 'authentic, confident, direct'}
CURRENT TRENDS: ${JSON.stringify(params.trends || [])}
CONTEXT: ${params.context}
${params.instructionOverride ? `PRIORITY INSTRUCTION: ${params.instructionOverride}` : ''}

PLATFORM RULES:
- Facebook: 400-500 chars, storytelling tone, 1-2 emojis, 3-5 hashtags
- Instagram: 150-200 chars caption + 15-20 hashtags, visual-first
- Twitter/X: under 280 chars, punchy, 2-3 hashtags, strong hook
- LinkedIn: professional, 200-300 chars, business value, 3-5 hashtags
- TikTok: trend-aware, 100-150 chars, viral hook, 5-8 hashtags

AGENT GOAL CALIBRATION:
${this.agentType === 'SALESMAN' ? '- Focus on CONVERSION: strong CTA, urgency, social proof, direct offer' : ''}
${this.agentType === 'AWARENESS' ? '- Focus on REACH: viral hooks, trending sounds, cultural moments, shareability' : ''}
${this.agentType === 'PROMOTION' ? '- Focus on ENGAGEMENT: FOMO, scarcity, countdown urgency, offer clarity' : ''}
${this.agentType === 'LAUNCH' ? '- Focus on HYPE: anticipation, exclusivity, announcement energy, narrative dominance' : ''}

Return STRICT JSON, no markdown:
{
  "headline": "Attention-grabbing first line (max 80 chars)",
  "body": "Full post body ready to publish",
  "image_prompt": "Detailed prompt for Imagen 3 to generate an image for this post",
  "hashtags": ["hashtag1", "hashtag2"],
  "cta": "Clear call to action"
}
`;
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || {
            headline: 'New update from us',
            body: params.context,
            image_prompt: `Professional marketing image for ${params.product?.name || 'product'}`,
            hashtags: [],
            cta: 'Learn more'
        };
    }

    // ─── PUBLISHING ENGINE ───────────────────────────────────────────────────────

    async publishToFacebook(tokens: AgentTokens['facebook'], body: string, imageBase64?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        const { access_token, page_id } = tokens;

        let endpoint = `${FB_GRAPH}/${page_id}/feed`;
        const payload: any = { message: body, access_token };

        if (imageBase64) {
            endpoint = `${FB_GRAPH}/${page_id}/photos`;
            payload.source = imageBase64;
            payload.published = true;
        }

        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Facebook API: ${err?.error?.message || resp.statusText}`);
        }

        const data: any = await resp.json();
        return { platform: 'facebook', platform_post_id: data.id, published_at: new Date().toISOString() };
    }

    async publishToInstagram(tokens: AgentTokens['instagram'], body: string, imageUrl?: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Instagram tokens not configured');
        const { access_token, instagram_account_id } = tokens;

        if (!imageUrl) {
            throw new Error('Instagram requires an image URL');
        }

        const containerResp = await fetch(
            `${FB_GRAPH}/${instagram_account_id}/media`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: imageUrl, caption: body, access_token })
            }
        );

        if (!containerResp.ok) {
            const err: any = await containerResp.json();
            throw new Error(`Instagram Media Create: ${err?.error?.message || containerResp.statusText}`);
        }

        const { id: creation_id }: any = await containerResp.json();

        const publishResp = await fetch(
            `${FB_GRAPH}/${instagram_account_id}/media_publish`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id, access_token })
            }
        );

        if (!publishResp.ok) {
            const err: any = await publishResp.json();
            throw new Error(`Instagram Publish: ${err?.error?.message || publishResp.statusText}`);
        }

        const data: any = await publishResp.json();
        return { platform: 'instagram', platform_post_id: data.id, published_at: new Date().toISOString() };
    }

    async publishToTwitter(tokens: AgentTokens['twitter'], body: string): Promise<PublishResult> {
        if (!tokens) throw new Error('Twitter tokens not configured');

        const resp = await fetch(`${TWITTER_API}/tweets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`
            },
            body: JSON.stringify({ text: body })
        });

        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Twitter API: ${JSON.stringify(err?.errors || err?.detail || resp.statusText)}`);
        }

        const data: any = await resp.json();
        return { platform: 'twitter', platform_post_id: data.data?.id, published_at: new Date().toISOString() };
    }

    async publishToLinkedIn(tokens: AgentTokens['linkedin'], body: string): Promise<PublishResult> {
        if (!tokens) throw new Error('LinkedIn tokens not configured');

        const authorUrn = tokens.org_urn || tokens.person_urn;
        if (!authorUrn) throw new Error('LinkedIn author URN not configured');

        const payload = {
            author: authorUrn,
            lifecycleState: 'PUBLISHED',
            specificContent: {
                'com.linkedin.ugc.ShareContent': {
                    shareCommentary: { text: body },
                    shareMediaCategory: 'NONE'
                }
            },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        };

        const resp = await fetch(`${LINKEDIN_API}/ugcPosts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.access_token}`,
                'X-Restli-Protocol-Version': '2.0.0'
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`LinkedIn API: ${err?.message || resp.statusText}`);
        }

        const postId = resp.headers.get('x-restli-id') || 'unknown';
        return { platform: 'linkedin', platform_post_id: postId, published_at: new Date().toISOString() };
    }

    async sendFacebookDM(tokens: AgentTokens['facebook'], recipientId: string, message: string): Promise<void> {
        if (!tokens) throw new Error('Facebook tokens not configured');
        const resp = await fetch(`${FB_GRAPH}/me/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: message },
                access_token: tokens.access_token
            })
        });
        if (!resp.ok) {
            const err: any = await resp.json();
            throw new Error(`Facebook DM: ${err?.error?.message || resp.statusText}`);
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
                status: 'pending'
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
            result
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
            scheduled_at: shouldRetry
                ? new Date(Date.now() + 10 * 60 * 1000).toISOString() // retry in 10 mins
                : undefined
        }).eq('id', taskId);
    }

    // ─── SKILL BUILDER ───────────────────────────────────────────────────────────

    async buildSkill(params: {
        problem: string;
        context: string;
        strategyId: string;
    }): Promise<string> {
        this.log(`Building new skill for problem: ${params.problem}`);

        const prompt = `
You are the AdRoom ${this.agentType} Agent. You encountered a marketing problem and need to CREATE A NEW REUSABLE SKILL to solve it.

PROBLEM: ${params.problem}
CONTEXT: ${params.context}

Design a new autonomous marketing skill that can be reused in the future.

Return JSON:
{
  "skill_name": "snake_case_unique_name",
  "skill_description": "What this skill does",
  "trigger_condition": "Describe exactly when this skill should auto-activate",
  "execution_prompt": "The exact GPT-4o prompt template to execute this skill. Use {{product}}, {{platform}}, {{goal}} as variables.",
  "parameters": { "required_inputs": ["list", "of", "keys"] },
  "success_metric": "How to measure if this skill worked"
}
`;
        const response = await this.ai.generateStrategy({}, prompt);
        const skill = response.parsedJson;

        if (!skill?.skill_name) {
            this.log('Skill builder returned invalid response');
            return '';
        }

        const { error } = await this.supabase
            .from('agent_skills')
            .upsert({
                agent_type: this.agentType,
                skill_name: skill.skill_name,
                skill_description: skill.skill_description,
                trigger_condition: skill.trigger_condition,
                execution_prompt: skill.execution_prompt,
                parameters: skill.parameters || {},
                success_metric: skill.success_metric,
                created_by_agent_run: params.strategyId
            }, { onConflict: 'skill_name' });

        if (error) this.log(`Failed to store skill: ${error.message}`);
        else this.log(`New skill stored: ${skill.skill_name}`);

        return skill.skill_name;
    }

    async useSkill(skillName: string, variables: Record<string, any>): Promise<any> {
        const { data: skill } = await this.supabase
            .from('agent_skills')
            .select('*')
            .eq('skill_name', skillName)
            .single();

        if (!skill) {
            this.log(`Skill not found: ${skillName}`);
            return null;
        }

        let prompt = skill.execution_prompt;
        for (const [key, value] of Object.entries(variables)) {
            prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), typeof value === 'object' ? JSON.stringify(value) : String(value));
        }

        const response = await this.ai.generateStrategy({}, prompt);

        await this.supabase.from('agent_skills').update({
            used_count: (skill.used_count || 0) + 1,
            last_used_at: new Date().toISOString()
        }).eq('skill_name', skillName);

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
        } catch {
            return {};
        }
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
            raw_platform_data: params.metrics
        });
    }

    private calculatePaidEquivalent(metrics: Record<string, number>, platform: string): number {
        const reach = metrics['post_reach'] || metrics['reach'] || 0;
        const engagement = (metrics['post_comments'] || 0) + (metrics['post_shares'] || 0);
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
            intelligence_used: params.intelligence
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

    async getProductDetails(productId: string): Promise<any> {
        if (!productId) return null;
        const { data } = await this.supabase
            .from('product_memory')
            .select('*')
            .eq('product_id', productId)
            .single();
        return data;
    }
}
