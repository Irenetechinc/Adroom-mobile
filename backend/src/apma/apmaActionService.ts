import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaHumanizerService } from './apmaHumanizerService';
import type { APMACampaign, APMAClient, DailyPlan, PlanAction, APMAPersona } from './apmaTypes';

export class APMAActionService {
  private ai = AIEngine.getInstance();

  async executePlan(
    client: APMAClient,
    campaign: APMACampaign,
    plan: DailyPlan,
    strategyId: string,
  ): Promise<{ executed: number; failed: number }> {
    let executed = 0;
    let failed = 0;

    for (const action of plan.actions) {
      const results = await this._executeAction(client, campaign, action, strategyId);
      executed += results.success;
      failed += results.fail;
      await this._sleep(apmaHumanizerService.generateDelay('normal'));
    }

    for (const blogTask of plan.blog_tasks ?? []) {
      await this._createBlogSite(client, campaign, blogTask, strategyId).catch(() => failed++);
    }

    for (const groupTask of plan.group_tasks ?? []) {
      await this._createSocialGroup(client, campaign, groupTask, strategyId).catch(() => failed++);
    }

    await this._updateStrategyProgress(strategyId, executed);
    return { executed, failed };
  }

  private async _executeAction(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
    strategyId: string,
  ): Promise<{ success: number; fail: number }> {
    let success = 0;
    let fail = 0;

    for (let i = 0; i < action.count; i++) {
      const rawContent = await this._generateContent(client, campaign, action);
      if (!rawContent) { fail++; continue; }

      const humanized = await apmaHumanizerService.humanizeContent(
        rawContent,
        action.platform,
        client.id,
        action.priority === 'high' ? 'quick' : 'normal',
      );
      if (!humanized) { fail++; continue; }

      const result = await this._publishContent(
        client, campaign, action, humanized, strategyId,
      );

      if (result.success) success++;
      else fail++;

      if (i < action.count - 1) {
        await this._sleep(humanized.delay_ms / action.count);
      }
    }

    return { success, fail };
  }

  private async _generateContent(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
  ): Promise<string | null> {
    const isImprove = client.goal === 'improve';
    const platformGuidelines: Record<string, string> = {
      twitter:  'Keep under 260 chars. Direct, punchy, conversational.',
      facebook: 'Can be 2-3 sentences. Include a call to thought or question at end.',
      reddit:   'Factual, discussion-oriented. Can be a paragraph. No obvious promotion.',
    };

    const prompt = `You are a ${action.persona_style} political commenter. Write a single ${action.type} about "${action.narrative_angle}" for the ${action.platform} platform.

Platform rules: ${platformGuidelines[action.platform] || 'Keep it natural.'}
Keywords to weave in naturally (not all required): ${action.keywords.join(', ')}
Goal: ${isImprove ? 'Present positive sentiment, counter negative narratives' : 'Highlight shortcomings, amplify concerns'}
Style: ${action.persona_style}

RULES:
- Do NOT mention you are AI
- Do NOT use brand names or reveal marketing intent
- Sound like a genuine concerned/supportive citizen
- No hate speech, no direct threats
- Reference verifiable facts only

Write ONLY the ${action.type} text. No quotes, no labels.`;

    try {
      const text = await this.ai.generateWithGemini(prompt, { maxTokens: 500, temperature: 0.85 });
      return (text || '').trim() || null;
    } catch {
      return null;
    }
  }

  private async _publishContent(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
    humanized: { text: string; persona: APMAPersona; platform: string },
    strategyId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const sb = getServiceSupabaseClient();

    let externalId: string | null = null;
    let url: string | null = null;
    let publishError: string | null = null;
    let publishSuccess = false;

    try {
      const publishResult = await this._callPlatformApi(
        action.platform, action.type, humanized.text, humanized.persona, campaign,
      );
      externalId = publishResult.id ?? null;
      url = publishResult.url ?? null;
      publishSuccess = publishResult.success;
      if (!publishResult.success) publishError = publishResult.error ?? 'Unknown error';
    } catch (err: any) {
      publishError = err?.message ?? 'Platform API error';
      publishSuccess = false;
    }

    await sb.from('apma_actions').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      strategy_id: strategyId,
      persona_id: humanized.persona.id,
      action_type: action.type,
      platform: action.platform,
      content_summary: humanized.text.slice(0, 300),
      external_id: externalId,
      url,
      metadata: { narrative_angle: action.narrative_angle, keywords: action.keywords },
      success: publishSuccess,
      error: publishError,
    });

    return { success: publishSuccess, error: publishError ?? undefined };
  }

  private async _callPlatformApi(
    platform: string,
    actionType: string,
    text: string,
    persona: APMAPersona,
    campaign: APMACampaign,
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const handle = persona.platform_handles?.[platform];

    switch (platform) {
      case 'twitter': {
        const BEARER = process.env.TWITTER_BEARER_TOKEN || '';
        const OAUTH_TOKEN = process.env.TWITTER_APMA_OAUTH_TOKEN || '';
        const OAUTH_SECRET = process.env.TWITTER_APMA_OAUTH_SECRET || '';
        if (!OAUTH_TOKEN || !OAUTH_SECRET) {
          return { success: false, error: 'Twitter APMA credentials not configured' };
        }
        try {
          const res = await fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OAUTH_TOKEN}`,
            },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!res.ok) return { success: false, error: data.detail ?? 'Twitter API error' };
          return {
            success: true,
            id: data.data?.id,
            url: data.data?.id ? `https://twitter.com/i/web/status/${data.data.id}` : undefined,
          };
        } catch (e: any) { return { success: false, error: e.message }; }
      }

      case 'facebook': {
        const PAGE_TOKEN = process.env.FB_APMA_PAGE_TOKEN || '';
        const PAGE_ID    = process.env.FB_APMA_PAGE_ID    || '';
        if (!PAGE_TOKEN || !PAGE_ID) {
          return { success: false, error: 'Facebook APMA credentials not configured' };
        }
        try {
          const res = await fetch(
            `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: text, access_token: PAGE_TOKEN }),
            },
          );
          const data = await res.json();
          if (!res.ok || !data.id) return { success: false, error: data.error?.message ?? 'Facebook API error' };
          return { success: true, id: data.id };
        } catch (e: any) { return { success: false, error: e.message }; }
      }

      case 'reddit': {
        const REDDIT_ACCESS = process.env.REDDIT_APMA_ACCESS_TOKEN || '';
        const SUBREDDIT     = process.env.REDDIT_APMA_SUBREDDIT    || 'test';
        if (!REDDIT_ACCESS) {
          return { success: false, error: 'Reddit APMA credentials not configured' };
        }
        try {
          const res = await fetch('https://oauth.reddit.com/api/submit', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${REDDIT_ACCESS}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'APMA/1.0',
            },
            body: new URLSearchParams({
              api_type: 'json',
              kind: 'self',
              sr: SUBREDDIT,
              title: text.slice(0, 100),
              text: text.length > 100 ? text : '',
            }).toString(),
          });
          const data = await res.json();
          const postId = data?.json?.data?.id;
          if (!res.ok || !postId) return { success: false, error: data?.json?.errors?.[0]?.[1] ?? 'Reddit API error' };
          return { success: true, id: postId, url: `https://reddit.com/${postId}` };
        } catch (e: any) { return { success: false, error: e.message }; }
      }

      default:
        return { success: false, error: `Platform ${platform} not yet integrated for APMA` };
    }
  }

  private async _createBlogSite(
    client: APMAClient,
    campaign: APMACampaign,
    blogTask: any,
    strategyId: string,
  ): Promise<void> {
    const sb = getServiceSupabaseClient();

    const blogNamePrompt = `Generate a credible, neutral-sounding political blog name for a Nigerian politics blog. 
Domain hint: ${blogTask.domain}. Topics: ${blogTask.topics.join(', ')}. 
Return JSON: { name, tagline }. Only JSON.`;

    let name = `Nigeria Political Observer`;
    let tagline = 'Informed perspectives on Nigerian governance';
    try {
      const resp = await this.ai.generateWithGemini(blogNamePrompt, { maxTokens: 100 });
      const parsed = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
      name = parsed.name || name;
      tagline = parsed.tagline || tagline;
    } catch {}

    const { data: blog } = await sb.from('apma_blog_sites').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      domain: blogTask.domain,
      name,
      tagline,
      status: 'creating',
      config: { seo_keywords: blogTask.seo_keywords, topics: blogTask.topics },
    }).select('id').single();

    if (!blog?.id) return;

    for (const topic of blogTask.topics.slice(0, blogTask.article_count ?? 5)) {
      await this._generateBlogArticle(client, campaign, blog.id, topic, blogTask.seo_keywords);
      await this._sleep(3000);
    }

    await sb.from('apma_blog_sites').update({
      status: 'live',
      article_count: blogTask.topics.length,
      updated_at: new Date().toISOString(),
    }).eq('id', blog.id);

    await sb.from('apma_actions').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      strategy_id: strategyId,
      action_type: 'blog_create',
      platform: 'web',
      content_summary: `Blog "${name}" created at ${blogTask.domain}`,
      success: true,
    });
  }

  private async _generateBlogArticle(
    client: APMAClient,
    campaign: APMACampaign,
    blogId: string,
    topic: string,
    seoKeywords: string[],
  ): Promise<void> {
    const isImprove = client.goal === 'improve';
    const prompt = `Write a 600-800 word political blog article for a Nigerian politics blog.

Topic: ${topic}
Keywords to include naturally: ${seoKeywords.slice(0, 5).join(', ')}
Angle: ${isImprove ? 'Positive, constructive governance perspectives' : 'Critical, accountability-focused analysis'}
Style: Professional journalism. Factual, well-structured, cites general references.
Do NOT mention AI, marketing, or that this was generated.

Return JSON: {
  "title": "<SEO-optimised title>",
  "slug": "<url-slug>",
  "content": "<full article with HTML paragraphs>",
  "excerpt": "<2-sentence summary>",
  "seo_title": "<title under 60 chars>",
  "seo_description": "<meta description under 160 chars>"
}
Only JSON.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 1500, temperature: 0.7 });
      const parsed = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
      const sb = getServiceSupabaseClient();
      await sb.from('apma_blog_articles').insert({
        blog_id: blogId,
        campaign_id: campaign.id,
        title: parsed.title || topic,
        slug: parsed.slug || topic.toLowerCase().replace(/\s+/g, '-'),
        content: parsed.content || '',
        excerpt: parsed.excerpt || '',
        keywords: seoKeywords,
        seo_title: parsed.seo_title || parsed.title || topic,
        seo_description: parsed.seo_description || parsed.excerpt || '',
        status: 'published',
        word_count: (parsed.content || '').split(' ').length,
        published_at: new Date().toISOString(),
      });
    } catch {}
  }

  private async _createSocialGroup(
    client: APMAClient,
    campaign: APMACampaign,
    groupTask: any,
    strategyId: string,
  ): Promise<void> {
    const sb = getServiceSupabaseClient();

    await sb.from('apma_social_groups').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      platform: groupTask.platform,
      name: groupTask.name,
      status: 'active',
    });

    await sb.from('apma_actions').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      strategy_id: strategyId,
      action_type: 'group_create',
      platform: groupTask.platform,
      content_summary: `Group "${groupTask.name}" created on ${groupTask.platform}`,
      success: true,
    });
  }

  private async _updateStrategyProgress(strategyId: string, actionsDone: number): Promise<void> {
    const sb = getServiceSupabaseClient();
    const { data } = await sb.from('political_strategies').select('actions_total, actions_done').eq('id', strategyId).single();
    if (!data) return;
    const newDone = (data.actions_done ?? 0) + actionsDone;
    const isDone = newDone >= (data.actions_total ?? 0);
    await sb.from('political_strategies').update({
      actions_done: newDone,
      status: isDone ? 'completed' : 'executing',
      executed_at: isDone ? new Date().toISOString() : undefined,
    }).eq('id', strategyId);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, Math.min(ms, 5000)));
  }
}

export const apmaActionService = new APMAActionService();
