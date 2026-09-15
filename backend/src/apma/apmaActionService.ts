import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaHumanizerService } from './apmaHumanizerService';
import { apmaGeoService } from './apmaGeoService';
import type { APMACampaign, APMAClient, DailyPlan, PlanAction, APMAPersona } from './apmaTypes';

const VIDEO_PLATFORMS = new Set(['twitter', 'telegram']);

const TWITTER_API_V2 = 'https://api.twitter.com/2';

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
      failed   += results.fail;
      // Brief pause between action batches
      await this._sleep(Math.floor(Math.random() * 8000 + 2000));
    }

    for (const blogTask of plan.blog_tasks ?? []) {
      const ok = await this._runBlogTask(client, campaign, blogTask, strategyId).catch((e) => {
        console.error('[APMA][Blog]', e?.message);
        return false;
      });
      if (ok) executed++; else failed++;
    }

    for (const groupTask of plan.group_tasks ?? []) {
      const ok = await this._runGroupTask(client, campaign, groupTask, strategyId).catch((e) => {
        console.error('[APMA][Group]', e?.message);
        return false;
      });
      if (ok) executed++; else failed++;
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
    let fail    = 0;

    // Generate a campaign graphic for every 5th post on visual platforms
    const VISUAL_PLATFORMS = new Set(['twitter', 'facebook', 'telegram']);
    const withGraphic = action.type === 'post' && VISUAL_PLATFORMS.has(action.platform);
    const withVideo   = action.type === 'post' && action.priority === 'high' && VIDEO_PLATFORMS.has(action.platform) && !!process.env.RUNWAY_API_KEY;

    for (let i = 0; i < action.count; i++) {
      const rawContent = await this._generateContent(client, campaign, action);
      if (!rawContent) { fail++; continue; }

      const humanized = await apmaHumanizerService.humanizeContent(
        rawContent,
        action.platform,
        client.id,
        action.priority === 'high' ? 'quick' : 'normal',
        client.country,
      );
      if (!humanized) { fail++; continue; }

      // Generate a graphic for every 5th visual post (rate-limited to avoid burning quotas)
      let imageBase64: string | null = null;
      let imageMime = 'image/png';
      if (withGraphic && i % 5 === 0) {
        const imgResult = await this._generatePostGraphic(client, campaign, action, rawContent);
        if (imgResult) { imageBase64 = imgResult.base64; imageMime = imgResult.mimeType; }
      }

      // Generate a video for the FIRST high-priority post per batch (Runway quota guard)
      if (withVideo && i === 0) {
        const vidResult = await this._generatePostVideo(client, campaign, action, rawContent, imageBase64, imageMime);
        if (vidResult?.url) {
          const vRes = action.platform === 'twitter'
            ? await this._twitterVideoPost(humanized.text, vidResult.url)
            : await this._telegramVideoPost(humanized.text, campaign, vidResult.url);
          const sb = getServiceSupabaseClient();
          await sb.from('apma_actions').insert({
            campaign_id: campaign.id,
            client_id: client.id,
            strategy_id: strategyId,
            persona_id: humanized.persona.id,
            action_type: 'video_post',
            platform: action.platform,
            content_summary: humanized.text.slice(0, 300),
            external_id: vRes.id ?? null,
            url: vRes.url ?? null,
            metadata: { narrative_angle: action.narrative_angle, runway_task: vidResult.url },
            success: vRes.success,
            error: vRes.error ?? null,
          });
          if (vRes.success) success++; else fail++;
          await this._sleep(Math.floor(Math.random() * 3000 + 1000));
          continue; // skip standard text/image post for this iteration
        }
      }

      const result = await this._publishContent(client, campaign, action, humanized, strategyId, imageBase64, imageMime);
      if (result.success) success++; else fail++;

      // Critic: fire-and-forget quality evaluation on published APMA content
      import('../services/criticAgentService').then(({ criticAgentService }) => {
        criticAgentService.analyze({
          output: humanized.text,
          agentType: 'APMA_POLITICAL',
          taskType: action.type || 'social_post',
          platform: action.platform,
          operation: 'apma_content_publish',
        });
      }).catch(() => {});

      // Realistic inter-post delay (reduced in execution to max 5s so cycles don't time out)
      if (i < action.count - 1) await this._sleep(Math.floor(Math.random() * 5000 + 1000));
    }

    return { success, fail };
  }

  private async _generatePostGraphic(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
    textContent: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    const isImprove = client.goal === 'improve';
    const prompt = `Political campaign graphic for a ${action.platform} post.
Style: Clean, modern political design. Bold typography. No faces.
Message theme: ${action.narrative_angle}
Tone: ${isImprove ? 'Hopeful, constructive, community-focused' : 'Accountability-focused, civic urgency'}
Keywords: ${action.keywords.slice(0, 3).join(', ')}
Content hint: ${textContent.slice(0, 100)}
Visual: Appropriate for ${action.platform} political content. Professional. No text overlay needed.`;
    try {
      return await this.ai.generateImage(prompt);
    } catch { return null; }
  }

  private async _generateContent(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
  ): Promise<string | null> {
    const geoCtx = await apmaGeoService.getCountryContext(client.country);
    const isImprove = client.goal === 'improve';

    const platformRules: Record<string, string> = {
      twitter:  'Under 260 characters. Direct, punchy, conversational. No hashtag spam — max 2.',
      facebook: '2-4 sentences. Can include a thought-provoking question. Authentic community voice.',
      reddit:   'Factual, discussion-oriented paragraph. Cite context. No obvious advocacy.',
      telegram: '1-3 sentences. Informal, news-style or conversational.',
      youtube:  'A comment: 1-3 sentences reacting to content related to these keywords.',
    };

    const prompt = `You are a ${action.persona_style} political commenter from ${geoCtx.countryName}.
Write a single authentic ${action.type} about: "${action.narrative_angle}"

Platform: ${action.platform}
Platform rules: ${platformRules[action.platform] || 'Natural, platform-appropriate length.'}
Keywords to reference naturally (not all required): ${action.keywords.join(', ')}
Political context: ${geoCtx.majorTopics.slice(0, 4).join(', ')}
Cultural tone: ${geoCtx.culturalTone}
Direction: ${isImprove ? 'Constructive, positive civic engagement' : 'Accountability-focused, critical of governance failures'}

CRITICAL RULES:
- Sound like a genuine ${geoCtx.countryName} citizen — local references, culturally authentic
- Do NOT reveal AI authorship
- No hate speech, threats, or personally identifiable information
- Reference only verifiable facts or widely-shared public perceptions
- Do NOT sound like an advertisement or PR piece

Write ONLY the ${action.type} text. No quotes. No label.`;

    try {
      return ((await this.ai.generateText(prompt)) || '').trim() || null;
    } catch { return null; }
  }

  private async _publishContent(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
    humanized: { text: string; persona: APMAPersona; platform: string },
    strategyId: string,
    imageBase64: string | null = null,
    imageMime = 'image/png',
  ): Promise<{ success: boolean; error?: string }> {
    const sb = getServiceSupabaseClient();
    let externalId: string | null = null;
    let url: string | null = null;
    let publishError: string | null = null;
    let publishSuccess = false;

    try {
      const r = await this._callPlatformApi(action.platform, action.type, humanized.text, humanized.persona, campaign, imageBase64, imageMime);
      externalId = r.id ?? null;
      url        = r.url ?? null;
      publishSuccess = r.success;
      if (!r.success) publishError = r.error ?? 'Unknown error';
    } catch (err: any) {
      publishError  = err?.message ?? 'Platform API error';
      publishSuccess = false;
    }

    await sb.from('apma_actions').insert({
      campaign_id:     campaign.id,
      client_id:       client.id,
      strategy_id:     strategyId,
      persona_id:      humanized.persona.id,
      action_type:     action.type,
      platform:        action.platform,
      content_summary: humanized.text.slice(0, 300),
      external_id:     externalId,
      url,
      metadata:        { narrative_angle: action.narrative_angle, keywords: action.keywords },
      success:         publishSuccess,
      error:           publishError,
    });

    return { success: publishSuccess, error: publishError ?? undefined };
  }

  private async _callPlatformApi(
    platform: string,
    actionType: string,
    text: string,
    persona: APMAPersona,
    campaign: APMACampaign,
    imageBase64: string | null = null,
    imageMime = 'image/png',
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    switch (platform) {
      case 'twitter': return this._twitterPost(text, imageBase64, imageMime);
      case 'facebook': return this._facebookPost(text, campaign, imageBase64, imageMime);
      case 'reddit': return this._redditPost(text, actionType, campaign);
      case 'telegram': return this._telegramPost(text, campaign, imageBase64);
      default:
        return { success: false, error: `Platform "${platform}" requires additional credentials. Add them to campaign config.` };
    }
  }

  // ─── TWITTER v2 — OAuth2 User Access Token ─────────────────────────────────
  private async _twitterPost(
    text: string,
    imageBase64: string | null = null,
    imageMime = 'image/png',
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const userToken = process.env.TWITTER_APMA_OAUTH_TOKEN || '';
    if (!userToken) return { success: false, error: 'TWITTER_APMA_OAUTH_TOKEN not configured. Set an OAuth2 user access token for the APMA Twitter account.' };
    try {
      let mediaId: string | null = null;

      // Upload image via Twitter v1.1 media/upload if we have one
      if (imageBase64) {
        try {
          const uploadRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Bearer ${userToken}`,
            },
            body: new URLSearchParams({
              media_data: imageBase64,
              media_type: imageMime,
            }).toString(),
          });
          const uploadData = await uploadRes.json();
          if (uploadData.media_id_string) mediaId = uploadData.media_id_string;
        } catch { /* image upload failed — post text-only */ }
      }

      const body: Record<string, any> = { text: text.slice(0, 280) };
      if (mediaId) body.media = { media_ids: [mediaId] };

      const res = await fetch(`${TWITTER_API_V2}/tweets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.detail ?? data.title ?? JSON.stringify(data.errors?.[0] ?? 'Twitter API error') };
      return {
        success: true,
        id: data.data?.id,
        url: data.data?.id ? `https://twitter.com/i/web/status/${data.data.id}` : undefined,
      };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── FACEBOOK — Graph API v19 ───────────────────────────────────────────────
  private async _facebookPost(
    text: string,
    campaign: APMACampaign,
    imageBase64: string | null = null,
    imageMime = 'image/png',
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const pageToken = process.env.FB_APMA_PAGE_TOKEN || (campaign.config as any)?.fb_page_token || '';
    const pageId    = process.env.FB_APMA_PAGE_ID    || (campaign.config as any)?.fb_page_id    || '';
    if (!pageToken || !pageId) return { success: false, error: 'FB_APMA_PAGE_TOKEN and FB_APMA_PAGE_ID not configured.' };
    try {
      // If we have an image, post to /{pageId}/photos for a photo post (includes caption)
      if (imageBase64) {
        try {
          const ext = imageMime.split('/')[1] || 'png';
          const imgBuf = Buffer.from(imageBase64, 'base64');
          const formData = new FormData();
          formData.append('source', new Blob([imgBuf], { type: imageMime }), `graphic.${ext}`);
          formData.append('caption', text);
          formData.append('access_token', pageToken);

          const photoRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/photos`, {
            method: 'POST',
            body: formData,
          });
          const photoData = await photoRes.json();
          if (photoRes.ok && photoData.id) {
            return { success: true, id: photoData.id, url: `https://www.facebook.com/${photoData.id}` };
          }
          // Fall through to text-only post if photo upload fails
        } catch { /* fall through */ }
      }

      // Text-only fallback
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: pageToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) return { success: false, error: data.error?.message ?? 'Facebook API error' };
      return { success: true, id: data.id, url: `https://www.facebook.com/${data.id}` };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── REDDIT — OAuth2 ────────────────────────────────────────────────────────
  private async _redditPost(text: string, actionType: string, campaign: APMACampaign): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const accessToken = process.env.REDDIT_APMA_ACCESS_TOKEN || '';
    const subreddit   = process.env.REDDIT_APMA_SUBREDDIT    || (campaign.config as any)?.reddit_subreddit || '';
    if (!accessToken) return { success: false, error: 'REDDIT_APMA_ACCESS_TOKEN not configured.' };
    if (!subreddit)   return { success: false, error: 'REDDIT_APMA_SUBREDDIT not configured for this campaign.' };
    try {
      const isLink = actionType === 'post' && text.length > 100;
      const res = await fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'APMA/2.0',
        },
        body: new URLSearchParams({
          api_type: 'json',
          kind: 'self',
          sr: subreddit.replace(/^r\//, ''),
          title: text.slice(0, 300).split('\n')[0] || text.slice(0, 100),
          text: text,
        }).toString(),
      });
      const data = await res.json();
      const errors = data?.json?.errors;
      if (errors?.length) return { success: false, error: errors[0][1] ?? 'Reddit API error' };
      const postId = data?.json?.data?.id;
      if (!postId) return { success: false, error: 'Reddit did not return a post ID' };
      return { success: true, id: postId, url: `https://reddit.com/r/${subreddit}/${postId}` };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── TELEGRAM — Bot API ─────────────────────────────────────────────────────
  private async _telegramPost(
    text: string,
    campaign: APMACampaign,
    imageBase64: string | null = null,
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const botToken  = process.env.TELEGRAM_APMA_BOT_TOKEN  || (campaign.config as any)?.telegram_bot_token || '';
    const channelId = process.env.TELEGRAM_APMA_CHANNEL_ID || (campaign.config as any)?.telegram_channel_id || '';
    if (!botToken || !channelId) return { success: false, error: 'TELEGRAM_APMA_BOT_TOKEN and TELEGRAM_APMA_CHANNEL_ID not configured.' };
    try {
      // If we have an image, use sendPhoto with caption
      if (imageBase64) {
        try {
          const imgBuf = Buffer.from(imageBase64, 'base64');
          const formData = new FormData();
          formData.append('chat_id', channelId);
          formData.append('caption', text.slice(0, 1024));
          formData.append('parse_mode', 'HTML');
          formData.append('photo', new Blob([imgBuf], { type: 'image/png' }), 'graphic.png');

          const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
          const photoData = await photoRes.json();
          if (photoData.ok) {
            const msgId = photoData.result?.message_id?.toString();
            return { success: true, id: msgId };
          }
          // Fall through to text-only
        } catch { /* fall through */ }
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, text, parse_mode: 'HTML' }),
      });
      const data = await res.json();
      if (!data.ok) return { success: false, error: data.description ?? 'Telegram API error' };
      const msgId = data.result?.message_id?.toString();
      const chatUsername = typeof channelId === 'string' && channelId.startsWith('@') ? channelId.slice(1) : null;
      return {
        success: true,
        id: msgId,
        url: chatUsername && msgId ? `https://t.me/${chatUsername}/${msgId}` : undefined,
      };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── BLOG TASK — WordPress.com REST API ────────────────────────────────────
  private async _runBlogTask(
    client: APMAClient,
    campaign: APMACampaign,
    blogTask: any,
    strategyId: string,
  ): Promise<boolean> {
    const sb = getServiceSupabaseClient();
    const wpToken  = process.env.WORDPRESS_COM_TOKEN || (campaign.config as any)?.wordpress_token || '';
    const wpSiteId = process.env.WORDPRESS_APMA_SITE_ID || (campaign.config as any)?.wordpress_site_id || '';

    // Create blog record in DB
    const { data: blog } = await sb.from('apma_blog_sites').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      domain: wpSiteId ? `${wpSiteId}.wordpress.com` : blogTask.site_name?.toLowerCase().replace(/\s+/g, '-') + '.wordpress.com',
      name: blogTask.site_name || 'Political Observer',
      tagline: `Independent political commentary`,
      status: wpToken && wpSiteId ? 'live' : 'creating',
      config: { wordpress_site_id: wpSiteId, seo_keywords: blogTask.seo_keywords, topics: blogTask.topics },
    }).select('id').single();

    if (!blog?.id) return false;

    let publishedCount = 0;
    for (const topic of (blogTask.topics ?? []).slice(0, blogTask.article_count ?? 5)) {
      const article = await this._generateBlogArticle(client, campaign, topic, blogTask.seo_keywords ?? []);
      if (!article) continue;

      // Store in DB regardless of WordPress availability
      await sb.from('apma_blog_articles').insert({
        blog_id: blog.id,
        campaign_id: campaign.id,
        title: article.title,
        slug: article.slug,
        content: article.content,
        excerpt: article.excerpt,
        keywords: blogTask.seo_keywords ?? [],
        seo_title: article.seo_title,
        seo_description: article.seo_description,
        status: 'draft',
        word_count: article.content.split(' ').length,
      });

      // Publish to WordPress.com if credentials are available
      if (wpToken && wpSiteId) {
        const published = await this._publishToWordPress(wpToken, wpSiteId, article);
        if (published) {
          const publishedUrl = `https://${wpSiteId}.wordpress.com/${article.slug}/`;
          await sb.from('apma_blog_articles')
            .update({ status: 'published', published_at: new Date().toISOString() })
            .eq('blog_id', blog.id)
            .eq('slug', article.slug);
          publishedCount++;
          // Share blog URL back to active social platforms
          await this._shareBlogUrl(client, campaign, article.title, publishedUrl, strategyId).catch((e) =>
            console.error('[APMA][BlogShare]', e?.message),
          );
        }
      }
      await this._sleep(2000);
    }

    await sb.from('apma_blog_sites').update({
      article_count: blogTask.topics?.length ?? 0,
      status: wpToken && wpSiteId ? 'live' : 'creating',
      updated_at: new Date().toISOString(),
    }).eq('id', blog.id);

    await sb.from('apma_actions').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      strategy_id: strategyId,
      action_type: 'blog_create',
      platform: 'web',
      content_summary: `Blog articles created for "${blogTask.site_name}" — ${publishedCount} published to WordPress`,
      success: true,
      metadata: { wp_published: publishedCount, total_articles: blogTask.topics?.length ?? 0 },
    });

    return true;
  }

  private async _generateBlogArticle(
    client: APMAClient,
    campaign: APMACampaign,
    topic: string,
    seoKeywords: string[],
  ): Promise<{ title: string; slug: string; content: string; excerpt: string; seo_title: string; seo_description: string } | null> {
    const geoCtx = await apmaGeoService.getCountryContext(client.country);
    const isImprove = client.goal === 'improve';

    const prompt = `Write a 700-900 word political blog article for a ${geoCtx.countryName} political news blog.

Topic: ${topic}
Keywords to weave in naturally: ${seoKeywords.slice(0, 5).join(', ')}
Political system: ${geoCtx.politicalSystem}
Editorial angle: ${isImprove ? 'Constructive political analysis — spotlight progress and governance achievements' : 'Accountability journalism — spotlight governance failures and public interest concerns'}
Tone: Professional journalism. Factual, well-structured.
Country context: ${geoCtx.culturalTone}

Do NOT reveal this was AI-generated. Do NOT mention political marketing.

Return ONLY this JSON:
{
  "title": "<compelling SEO title>",
  "slug": "<url-slug-with-hyphens>",
  "content": "<full article as HTML paragraphs using <p> tags>",
  "excerpt": "<2-sentence compelling summary>",
  "seo_title": "<title under 60 chars>",
  "seo_description": "<meta description 120-160 chars>"
}
Only valid JSON.`;

    try {
      const resp = await this.ai.generateText(prompt);
      return JSON.parse((resp || '').replace(/```json|```/g, '').trim());
    } catch { return null; }
  }

  private async _publishToWordPress(
    token: string,
    siteId: string,
    article: { title: string; content: string; excerpt: string; seo_description: string },
  ): Promise<boolean> {
    try {
      const res = await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${siteId}/posts/new`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: article.title,
          content: article.content,
          excerpt: article.excerpt,
          status: 'publish',
          format: 'standard',
        }),
      });
      const data = await res.json();
      return res.ok && !!data.ID;
    } catch { return false; }
  }

  // ─── GROUP TASK — Telegram channel post or Facebook group post ────────────
  private async _runGroupTask(
    client: APMAClient,
    campaign: APMACampaign,
    groupTask: any,
    strategyId: string,
  ): Promise<boolean> {
    const sb = getServiceSupabaseClient();

    // Record the group intent
    const { data: group } = await sb.from('apma_social_groups').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      platform: groupTask.platform,
      name: groupTask.name,
      status: 'active',
    }).select('id').single();

    // Publish initial posts to the group channel if credentials exist
    let posted = 0;
    const platform = groupTask.platform;
    const count = Math.min(groupTask.initial_posts ?? 5, 5); // cap at 5 to keep cycle fast

    for (let i = 0; i < count; i++) {
      const raw = await this._generateContent(client, campaign, {
        type: 'post',
        platform,
        count: 1,
        narrative_angle: groupTask.description || groupTask.name,
        keywords: campaign.keywords.slice(0, 3),
        persona_style: 'casual',
        priority: 'medium',
      });
      if (!raw) continue;

      const humanized = await apmaHumanizerService.humanizeContent(raw, platform, client.id, 'quick', client.country);
      if (!humanized) continue;

      let result;
      if (platform === 'telegram') {
        result = await this._telegramPost(humanized.text, campaign);
      } else if (platform === 'facebook') {
        result = await this._facebookPost(humanized.text, campaign);
      } else if (platform === 'reddit') {
        result = await this._redditPost(humanized.text, 'post', campaign);
      } else {
        result = { success: false, error: `Group posting on ${platform} requires manual setup` };
      }

      if (result.success) {
        posted++;
        await sb.from('apma_actions').insert({
          campaign_id: campaign.id,
          client_id: client.id,
          strategy_id: strategyId,
          action_type: 'group_post',
          platform,
          content_summary: humanized.text.slice(0, 300),
          external_id: result.id ?? null,
          url: result.url ?? null,
          success: true,
        });
      }
      await this._sleep(2000);
    }

    await sb.from('apma_actions').insert({
      campaign_id: campaign.id,
      client_id: client.id,
      strategy_id: strategyId,
      action_type: 'group_create',
      platform,
      content_summary: `Group "${groupTask.name}" on ${platform} — ${posted}/${count} posts published`,
      success: true,
      metadata: { group_name: groupTask.name, posts_published: posted },
    });

    return true;
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
      ...(isDone ? { executed_at: new Date().toISOString() } : {}),
    }).eq('id', strategyId);
  }

  // ─── VIDEO GENERATION — Runway Gen-3 Alpha Turbo ──────────────────────────
  private async _generatePostVideo(
    client: APMAClient,
    campaign: APMACampaign,
    action: PlanAction,
    textContent: string,
    imageBase64: string | null,
    imageMime: string,
  ): Promise<{ url: string } | null> {
    const isImprove = client.goal === 'improve';
    const prompt = `5-second political ${action.platform} video for ${client.country} campaign.
${isImprove ? 'Hopeful, inspiring civic energy' : 'Accountability-focused, civic urgency'}.
Theme: ${action.narrative_angle}. Keywords: ${action.keywords.slice(0, 3).join(', ')}.
Style: Clean political motion graphics, bold colours, professional broadcast quality.`;
    try {
      return await this.ai.generateVideo(prompt, imageBase64, imageMime);
    } catch { return null; }
  }

  // ─── TWITTER VIDEO — chunked media upload + tweet ─────────────────────────
  private async _twitterVideoPost(
    text: string,
    videoUrl: string,
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const userToken = process.env.TWITTER_APMA_OAUTH_TOKEN || '';
    if (!userToken) return { success: false, error: 'TWITTER_APMA_OAUTH_TOKEN not configured' };
    try {
      const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
      if (!videoRes.ok) throw new Error('Failed to fetch Runway video');
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      const totalBytes = videoBuffer.length;

      // INIT
      const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${userToken}` },
        body: new URLSearchParams({ command: 'INIT', media_type: 'video/mp4', media_category: 'tweet_video', total_bytes: String(totalBytes) }).toString(),
      });
      const initData = await initRes.json();
      const mediaId = initData.media_id_string;
      if (!mediaId) throw new Error('Twitter media INIT failed');

      // APPEND (5 MB chunks)
      const CHUNK = 5 * 1024 * 1024;
      let seg = 0;
      for (let offset = 0; offset < totalBytes; offset += CHUNK) {
        const chunk = videoBuffer.slice(offset, offset + CHUNK);
        const form = new FormData();
        form.append('command', 'APPEND');
        form.append('media_id', mediaId);
        form.append('segment_index', String(seg++));
        form.append('media', new Blob([chunk], { type: 'video/mp4' }), 'video.mp4');
        await fetch('https://upload.twitter.com/1.1/media/upload.json', {
          method: 'POST',
          headers: { Authorization: `Bearer ${userToken}` },
          body: form,
        });
      }

      // FINALIZE
      const finalRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${userToken}` },
        body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }).toString(),
      });
      const finalData = await finalRes.json();

      // STATUS polling if needed
      if (finalData.processing_info?.state === 'pending' || finalData.processing_info?.state === 'in_progress') {
        for (let attempt = 0; attempt < 15; attempt++) {
          await this._sleep((finalData.processing_info?.check_after_secs ?? 5) * 1000);
          const statusRes = await fetch(
            `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`,
            { headers: { Authorization: `Bearer ${userToken}` } },
          );
          const s = await statusRes.json();
          const state = s.processing_info?.state;
          if (state === 'succeeded') break;
          if (state === 'failed') throw new Error('Twitter video processing failed');
        }
      }

      // Tweet with video
      const tweetRes = await fetch(`${TWITTER_API_V2}/tweets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ text: text.slice(0, 280), media: { media_ids: [mediaId] } }),
      });
      const tweetData = await tweetRes.json();
      if (!tweetRes.ok) return { success: false, error: tweetData.detail ?? 'Twitter video tweet failed' };
      return {
        success: true,
        id: tweetData.data?.id,
        url: tweetData.data?.id ? `https://twitter.com/i/web/status/${tweetData.data.id}` : undefined,
      };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── TELEGRAM VIDEO — sendVideo via URL ────────────────────────────────────
  private async _telegramVideoPost(
    text: string,
    campaign: APMACampaign,
    videoUrl: string,
  ): Promise<{ success: boolean; id?: string; url?: string; error?: string }> {
    const botToken  = process.env.TELEGRAM_APMA_BOT_TOKEN  || (campaign.config as any)?.telegram_bot_token  || '';
    const channelId = process.env.TELEGRAM_APMA_CHANNEL_ID || (campaign.config as any)?.telegram_channel_id || '';
    if (!botToken || !channelId) return { success: false, error: 'Telegram not configured' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, video: videoUrl, caption: text.slice(0, 1024), parse_mode: 'HTML', supports_streaming: true }),
      });
      const data = await res.json();
      if (!data.ok) return { success: false, error: data.description ?? 'Telegram sendVideo failed' };
      return { success: true, id: data.result?.message_id?.toString() };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  // ─── BLOG URL SHARING — post published article links to social platforms ──
  private async _shareBlogUrl(
    client: APMAClient,
    campaign: APMACampaign,
    title: string,
    url: string,
    strategyId: string,
  ): Promise<void> {
    const sb = getServiceSupabaseClient();
    const shareText = `${title} — ${url}`;

    const promises: Array<Promise<any>> = [];

    if (campaign.platforms.includes('twitter')) {
      promises.push(
        this._twitterPost(shareText.slice(0, 280)).then((r) =>
          sb.from('apma_actions').insert({
            campaign_id: campaign.id, client_id: client.id, strategy_id: strategyId,
            action_type: 'blog_share', platform: 'twitter',
            content_summary: shareText.slice(0, 300), external_id: r.id ?? null, url: r.url ?? null,
            success: r.success, error: r.error ?? null,
          }),
        ).catch(() => null),
      );
    }
    if (campaign.platforms.includes('telegram')) {
      promises.push(
        this._telegramPost(shareText, campaign).then((r) =>
          sb.from('apma_actions').insert({
            campaign_id: campaign.id, client_id: client.id, strategy_id: strategyId,
            action_type: 'blog_share', platform: 'telegram',
            content_summary: shareText.slice(0, 300), external_id: r.id ?? null,
            success: r.success, error: r.error ?? null,
          }),
        ).catch(() => null),
      );
    }
    if (campaign.platforms.includes('facebook')) {
      promises.push(
        this._facebookPost(shareText, campaign).then((r) =>
          sb.from('apma_actions').insert({
            campaign_id: campaign.id, client_id: client.id, strategy_id: strategyId,
            action_type: 'blog_share', platform: 'facebook',
            content_summary: shareText.slice(0, 300), external_id: r.id ?? null, url: r.url ?? null,
            success: r.success, error: r.error ?? null,
          }),
        ).catch(() => null),
      );
    }

    await Promise.allSettled(promises);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, Math.min(ms, 8000)));
  }
}

export const apmaActionService = new APMAActionService();
