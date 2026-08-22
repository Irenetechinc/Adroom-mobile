/**
 * GRAPHICS DESIGNER AGENT
 *
 * The world's best AI graphics designer for social media marketing.
 * Every graphic is 100% unique — no two posts, no two users share the same design language.
 * All design decisions flow from real-time intelligence: IPE, Social Listening,
 * Emotional Intelligence, GEO, and the Psychologist Engine.
 *
 * Responsibilities:
 * - Design and generate ALL graphics required for every post across all agents
 * - Platform-optimized compositions (Instagram 4:5, TikTok 9:16, LinkedIn 1.91:1, etc.)
 * - Unique per-post fingerprint: no repetition ever
 * - Real-time attention-grabbing design driven by live data
 * - Intelligent template selection: hero, lifestyle, testimonial, countdown, story, carousel, quote-card
 * - Works with SALESMAN, AWARENESS, PROMOTION, LAUNCH agents on demand
 * - Generates preview batches for strategy approval screen (7-day asset preview)
 */

import crypto from 'crypto';
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import type { VisualDirection } from './directorAgent';

export interface DesignBrief {
  userId: string;
  productId?: string;
  strategyId?: string;
  platform: string;
  goal: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';
  agentType: string;
  postContent: {
    headline: string;
    body: string;
    hashtags?: string[];
    cta?: string;
    taskType?: string;
    salesTactic?: string;
    viralityHook?: string;
    promoPhase?: string;
    launchPhase?: string;
  };
  product: any;
  dayNumber?: number;
  totalDays?: number;
  direction?: VisualDirection;
}

export interface DesignAsset {
  url: string;
  platform: string;
  contentType: string;
  headline: string;
  designStyle: string;
  fingerprint: string;
  generatedAt: string;
  prompt?: string;
}

export interface PreviewAsset {
  day: number;
  platform: string;
  taskType: string;
  headline: string;
  body: string;
  hashtags: string[];
  hook?: string;
  tiktokScript?: any;
  imageUrl?: string;
  designStyle?: string;
  fingerprint?: string;
  generating?: boolean;
  error?: string;
}

// Platform-specific canvas specs
const PLATFORM_SPECS: Record<string, { aspectRatio: string; orientation: string; primaryZone: string; visualPriority: string }> = {
  instagram: { aspectRatio: '4:5', orientation: 'portrait', primaryZone: 'upper-third', visualPriority: 'aesthetic-first' },
  tiktok: { aspectRatio: '9:16', orientation: 'vertical-full', primaryZone: 'center-overlay', visualPriority: 'motion-energy' },
  facebook: { aspectRatio: '16:9', orientation: 'landscape', primaryZone: 'rule-of-thirds', visualPriority: 'scroll-stopping' },
  linkedin: { aspectRatio: '1.91:1', orientation: 'wide-landscape', primaryZone: 'centered', visualPriority: 'authority-credibility' },
  twitter: { aspectRatio: '16:9', orientation: 'landscape', primaryZone: 'centered-impact', visualPriority: 'immediate-clarity' },
  x: { aspectRatio: '16:9', orientation: 'landscape', primaryZone: 'centered-impact', visualPriority: 'immediate-clarity' },
};

// Design templates by goal and task type
const DESIGN_TEMPLATES: Record<string, string[]> = {
  SALESMAN: ['conversion-hero', 'social-proof-card', 'before-after-split', 'offer-reveal', 'testimonial-overlay', 'product-showcase-3d'],
  AWARENESS: ['viral-lifestyle', 'trend-hijack', 'bold-statement', 'community-moment', 'behind-the-scenes', 'movement-visual'],
  PROMOTION: ['countdown-urgency', 'deal-reveal-burst', 'scarcity-spotlight', 'limited-badge', 'fomo-collage', 'offer-card'],
  LAUNCH: ['teaser-mystery', 'launch-day-explosion', 'announcement-cinematic', 'product-reveal-dramatic', 'hype-build', 'narrative-arc'],
};

export class GraphicsDesignerAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  private log(msg: string) {
    console.log(`[GraphicsDesigner] ${new Date().toISOString()} ${msg}`);
  }

  /**
   * Generate a unique cryptographic fingerprint for this specific post.
   * Combines: userId + platform + goal + day + content hash + timestamp entropy.
   * Guarantees no two posts ever produce the same graphic.
   */
  private generateFingerprint(brief: DesignBrief, seed: string): string {
    const contentHash = crypto
      .createHash('sha256')
      .update(`${brief.userId}|${brief.platform}|${brief.goal}|${brief.dayNumber ?? 0}|${brief.postContent.headline}|${seed}|${Date.now()}`)
      .digest('hex')
      .slice(0, 16);
    return contentHash;
  }

  /**
   * Pull real-time intelligence from all engines to inform design decisions.
   */
  private async fetchIntelligence(productCategory: string, platform: string) {
    const [ipe, social, emotional, geo] = await Promise.all([
      this.supabase
        .from('platform_intelligence')
        .select('platform, algorithm_priorities, trending_formats, predictions')
        .eq('platform', platform)
        .order('captured_at', { ascending: false })
        .limit(2),
      this.supabase
        .from('social_conversations')
        .select('topics, sentiment, reaction, intent')
        .eq('category', productCategory || '')
        .order('collected_at', { ascending: false })
        .limit(15),
      this.supabase
        .from('emotional_ownership')
        .select('emotion, ownership_percentage, owner_brand')
        .eq('category', productCategory || '')
        .order('ownership_percentage', { ascending: false })
        .limit(10),
      this.supabase
        .from('narrative_snapshots')
        .select('region, dominant_narrative, emerging_topics')
        .order('captured_at', { ascending: false })
        .limit(5),
    ]);

    return {
      ipe: ipe.data || [],
      social: social.data || [],
      emotional: emotional.data || [],
      geo: geo.data || [],
    };
  }

  /**
   * Select the optimal design template for this specific post context.
   * Uses intelligence + goal + task type to pick the highest-impact template.
   */
  private selectDesignTemplate(brief: DesignBrief, intel: any): string {
    const templates = DESIGN_TEMPLATES[brief.goal] || DESIGN_TEMPLATES.AWARENESS;
    const taskType = (brief.postContent.taskType || '').toLowerCase();

    // Smart template selection based on context
    if (taskType.includes('story')) return 'vertical-story-full';
    if (taskType.includes('reel') || taskType.includes('video')) return 'motion-thumbnail-dramatic';
    if (taskType.includes('carousel')) return 'multi-panel-carousel-hero';
    if (taskType.includes('testimonial')) return 'social-proof-card';
    if (taskType.includes('countdown')) return 'countdown-urgency';
    if (taskType.includes('thread')) return 'thread-visual-anchor';
    if (taskType.includes('poll')) return 'interactive-poll-card';

    // Sentiment-based selection — if social sentiment is positive, use lifestyle; if urgent, use burst
    const avgSentiment = intel.social.reduce((sum: number, s: any) => sum + (s.sentiment === 'positive' ? 1 : s.sentiment === 'negative' ? -1 : 0), 0);
    if (avgSentiment > 3 && brief.goal === 'AWARENESS') return 'viral-lifestyle';
    if (brief.goal === 'PROMOTION') return 'offer-reveal';
    if (brief.goal === 'LAUNCH' && brief.postContent.launchPhase === 'launch_blitz') return 'launch-day-explosion';

    // Rotate through templates based on day number to ensure variety
    const dayIndex = (brief.dayNumber ?? 0) % templates.length;
    return templates[dayIndex];
  }

  /**
   * Build the world-class Imagen 3 prompt for this specific graphic.
   * Every prompt is data-driven from intelligence engines + unique fingerprint.
   */
  private async buildImagePrompt(brief: DesignBrief, template: string, fingerprint: string, intel: any): Promise<string> {
    const spec = PLATFORM_SPECS[brief.platform.toLowerCase()] || PLATFORM_SPECS.instagram;
    const productName = brief.product?.product_name || brief.product?.name || 'product';
    const productCategory = brief.product?.category || 'consumer product';

    // Extract emotional gap from intelligence — design into the emotion NOT owned by competitors
    const ownedEmotions = intel.emotional.map((e: any) => e.emotion).join(', ');
    const trendingTopics = intel.social.slice(0, 3).map((s: any) => s.topics?.[0] || '').filter(Boolean).join(', ');

    const designDirective = `
You are the world's greatest AI art director for social media advertising.
Create a precise, production-ready Imagen 3 image generation prompt for this post.

UNIQUE POST FINGERPRINT: ${fingerprint}
TEMPLATE: ${template}
PLATFORM: ${brief.platform.toUpperCase()} (${spec.aspectRatio} aspect ratio, ${spec.orientation})
PRIMARY VISUAL ZONE: ${spec.primaryZone}
VISUAL PRIORITY: ${spec.visualPriority}
AGENT GOAL: ${brief.goal}
PRODUCT: ${productName} (${productCategory})

POST CONTENT:
Headline: ${brief.postContent.headline}
Body: ${brief.postContent.body.substring(0, 200)}
CTA: ${brief.postContent.cta || ''}
Day: ${brief.dayNumber ?? 1} of ${brief.totalDays ?? 30} (campaign arc position)

REAL-TIME INTELLIGENCE INPUTS:
- Platform algorithm trending: ${JSON.stringify(intel.ipe.slice(0, 1))}
- Live audience reactions: ${trendingTopics || 'general interest'}
- Emotional gap (what competitors DON'T own): opposite of [${ownedEmotions}]
- Regional narrative: ${intel.geo[0]?.dominant_narrative || 'global growth mindset'}

DIRECTOR'S VISUAL DIRECTION: ${brief.direction ? `
- Color palette: ${brief.direction.color_palette?.primary} primary, ${brief.direction.color_palette?.secondary} secondary, ${brief.direction.color_palette?.accent} accent
- Visual mood: ${brief.direction.visual_mood}
- Lighting: ${brief.direction.lighting}
- Composition: ${brief.direction.composition_style}
- Typography style: ${brief.direction.typography?.style} ${brief.direction.typography?.weight}
- Trust elements to include: ${brief.direction.trust_elements?.join(', ')}
- AVOID: ${brief.direction.avoid_elements?.join(', ')}` : 'apply best judgment based on intelligence data'}

DESIGN RULES FOR ${template.toUpperCase()}:
${this.getTemplateRules(template, brief.goal, brief.platform)}

ABSOLUTE REQUIREMENTS:
- This fingerprint (${fingerprint}) must be expressed in color tones, composition angle, or lighting signature
- ZERO generic stock photo energy — must feel custom-crafted for this exact product and moment
- Platform-native: feels like it belongs on ${brief.platform}, not copied from another platform
- ${spec.visualPriority.replace('-', ' ')} is the #1 visual priority
- Photorealistic commercial photography or bold graphic art — never clip-art or generic illustration
- 8K ultra-sharp resolution, professional color grading

Generate a Imagen 3 prompt (max 280 characters) that produces a ${spec.orientation} ${template} for ${brief.platform}.
The image must DEMAND attention and drive toward: ${this.getGoalVisualCTA(brief.goal)}

Return ONLY the image prompt text, nothing else.
`;

    const result = await this.ai.generateStrategy({}, designDirective);
    const rawPrompt = result.text?.trim().replace(/^"|"$/g, '').replace(/```.*?```/gs, '').trim() || '';

    // Ensure we have a substantive prompt
    if (rawPrompt.length > 30) {
      return rawPrompt.substring(0, 280);
    }

    // Fallback: build a strong default prompt
    return this.buildFallbackPrompt(brief, template, spec, fingerprint);
  }

  private getTemplateRules(template: string, goal: string, platform: string): string {
    const rules: Record<string, string> = {
      'conversion-hero': 'Product front-and-center with aspirational lifestyle background. Human subject shows transformation result. Bold typographic overlay at bottom with offer/CTA.',
      'social-proof-card': 'Clean card design with star rating, quote text, real-person thumbnail. Trust signals (checkmarks, logos) subtly visible. Clean white/cream background with brand accent stripe.',
      'before-after-split': 'Perfect 50/50 vertical split. Left=before (desaturated, moody). Right=after (vibrant, bright, product result). Brand watermark at intersection.',
      'offer-reveal': 'Bold price/offer as primary focal point. Radial gradient burst from center. Confetti-style energy particles. Hard deadline text overlay.',
      'viral-lifestyle': 'Real-looking UGC aesthetic. Human subject in authentic environment using product. Natural light, slight film grain. Candid energy, not posed.',
      'trend-hijack': 'Meme-aware composition. Bold white caption text over image (Instagram Reels / TikTok style). Subject is relatable, not aspirational.',
      'bold-statement': 'Typography-dominant. Oversized statement text with background image cropped as secondary element. High contrast color block.',
      'countdown-urgency': 'Clock or timer visual as hero. Urgent color palette (red/orange gradient). Bold numbers. Scarcity element ("Only X left") prominent.',
      'launch-day-explosion': 'Dark background, product reveal with dramatic lighting burst. Confetti, sparkle particles. "LIVE NOW" or "TODAY ONLY" badge. High-impact.',
      'announcement-cinematic': 'Wide cinematic frame. Product silhouette with dramatic backlight. Movie-poster composition. Coming-soon energy.',
      'testimonial-overlay': 'Real person portrait (authentic not stock). Quote overlaid directly on image. Star rating. Subtle product in corner.',
      'motion-thumbnail-dramatic': 'Single frame optimized for play button visibility. Face with exaggerated expression OR product with motion blur. Bold title text.',
      'story-vertical-full': 'Edge-to-edge vertical canvas. Top 30% — hook text. Middle 60% — main visual. Bottom 10% — CTA/swipe-up. No wasted space.',
      'multi-panel-carousel-hero': 'First panel: cover image, high-impact headline. Designed to pull the viewer to swipe. Teaser arrow or partial reveal on right edge.',
    };
    return rules[template] || `Bold, high-contrast ${goal.toLowerCase()} image optimized for ${platform}. Product is clearly visible. Brand colors dominant. Professional commercial quality.`;
  }

  private getGoalVisualCTA(goal: string): string {
    const ctas: Record<string, string> = {
      SALESMAN: 'immediate purchase desire — viewer must want to buy NOW',
      AWARENESS: 'maximum shareability and save — viewer must want to send this to someone',
      PROMOTION: 'FOMO and urgency — viewer must feel they will miss out if they wait',
      LAUNCH: 'excitement and anticipation — viewer must feel like they are witnessing something new',
    };
    return ctas[goal] || 'engagement and brand recognition';
  }

  private buildFallbackPrompt(brief: DesignBrief, template: string, spec: any, fingerprint: string): string {
    const product = brief.product?.product_name || brief.product?.name || 'product';
    const goalMood: Record<string, string> = {
      SALESMAN: 'high-conversion commercial photography, aspirational lifestyle, warm golden tones',
      AWARENESS: 'viral social media aesthetic, bold colors, authentic UGC energy, relatable moment',
      PROMOTION: 'urgent red-orange gradient, burst energy, bold typography, limited-time excitement',
      LAUNCH: 'dark dramatic cinematic, product reveal backlight, announcement energy, premium quality',
    };
    const mood = goalMood[brief.goal] || goalMood.AWARENESS;
    return `${mood}, ${template} layout, ${spec.orientation} format for ${brief.platform}, featuring ${product}, photorealistic 8K commercial quality, unique composition ${fingerprint}`;
  }

  /**
   * Upload generated image to Supabase storage and return public URL.
   */
  private async uploadToStorage(base64: string, mimeType: string, fingerprint: string): Promise<string | null> {
    try {
      const ext = mimeType.split('/')[1] || 'png';
      const fileName = `gda_${fingerprint}_${Date.now()}.${ext}`;
      const buffer = Buffer.from(base64, 'base64');
      const { error } = await this.supabase.storage
        .from('creative-assets')
        .upload(fileName, buffer, { contentType: mimeType, upsert: false });

      if (error) {
        this.log(`Storage upload failed: ${error.message}`);
        return null;
      }
      const { data: urlData } = this.supabase.storage
        .from('creative-assets')
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (e: any) {
      this.log(`Upload error: ${e.message}`);
      return null;
    }
  }

  /**
   * PRIMARY METHOD: Generate a single unique graphic for a post.
   * Called by all 4 agents whenever they need an image for a post.
   *
   * @returns DesignAsset with the public URL and metadata
   */
  async generatePostGraphic(brief: DesignBrief): Promise<DesignAsset> {
    this.log(`Designing graphic — ${brief.platform} | ${brief.goal} | Day ${brief.dayNumber ?? '?'} | ${brief.postContent.headline?.substring(0, 40)}`);

    const fingerprint = this.generateFingerprint(brief, brief.strategyId || 'solo');
    const productCategory = brief.product?.category || 'general';

    try {
      // 1. Pull live intelligence
      const intel = await this.fetchIntelligence(productCategory, brief.platform);

      // 2. Select optimal design template
      const template = this.selectDesignTemplate(brief, intel);
      this.log(`Template selected: ${template} (fingerprint: ${fingerprint})`);

      // 3. Get Director visual direction if not provided
      let direction = brief.direction;
      if (!direction && brief.userId) {
        try {
          const { DirectorAgent } = await import('./directorAgent');
          const director = new DirectorAgent();
          direction = await director.getDirection({
            userId: brief.userId,
            productId: brief.productId,
            strategyId: brief.strategyId,
            product: brief.product,
            platform: brief.platform,
            goal: brief.goal,
          });
        } catch (e: any) {
          this.log(`Director Agent unavailable, proceeding with intelligence-driven prompt: ${e.message}`);
        }
      }

      // 4. Build precision Imagen 3 prompt
      const imagePrompt = await this.buildImagePrompt(
        { ...brief, direction },
        template,
        fingerprint,
        intel
      );

      this.log(`Generating image with Imagen 3: ${imagePrompt.substring(0, 80)}…`);

      // 5. Generate image with Imagen 3
      const imageResult = await this.ai.generateImage(
        `${imagePrompt}, ultra-high-quality, photorealistic, 8K, professional commercial photography, sharp focus`
      );

      if (!imageResult?.base64) {
        this.log(`Imagen 3 returned no image for fingerprint ${fingerprint}`);
        return this.buildErrorAsset(brief, template, fingerprint);
      }

      // 6. Upload to Supabase storage
      const publicUrl = await this.uploadToStorage(imageResult.base64, imageResult.mimeType, fingerprint);

      if (!publicUrl) {
        // Return as data URI if storage fails
        const dataUri = `data:${imageResult.mimeType};base64,${imageResult.base64}`;
        return {
          url: dataUri,
          platform: brief.platform,
          contentType: template,
          headline: brief.postContent.headline,
          designStyle: template,
          fingerprint,
          generatedAt: new Date().toISOString(),
          prompt: imagePrompt,
        };
      }

      this.log(`Graphic generated ✓ — ${publicUrl.split('/').pop()}`);

      // 7. Log to design history (non-blocking)
      this.supabase.from('gda_design_history').insert({
        user_id: brief.userId,
        strategy_id: brief.strategyId,
        platform: brief.platform,
        goal: brief.goal,
        template,
        fingerprint,
        image_url: publicUrl,
        prompt: imagePrompt,
        day_number: brief.dayNumber ?? 0,
        created_at: new Date().toISOString(),
      }); // fire-and-forget design history log

      return {
        url: publicUrl,
        platform: brief.platform,
        contentType: template,
        headline: brief.postContent.headline,
        designStyle: template,
        fingerprint,
        generatedAt: new Date().toISOString(),
        prompt: imagePrompt,
      };
    } catch (e: any) {
      this.log(`Graphic generation failed: ${e.message}`);
      return this.buildErrorAsset(brief, 'fallback', fingerprint);
    }
  }

  private buildErrorAsset(brief: DesignBrief, template: string, fingerprint: string): DesignAsset {
    return {
      url: '',
      platform: brief.platform,
      contentType: template,
      headline: brief.postContent.headline,
      designStyle: template,
      fingerprint,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * BATCH PREVIEW: Generate actual visual assets for the first 7 days of a strategy.
   * Called by the strategy approval endpoint to show real assets before launch.
   * Processes days in parallel for speed.
   *
   * @param params - strategy data, product, userId, 7-day schedule
   * @returns Array of PreviewAsset with imageUrl populated
   */
  async generateStrategyPreviewAssets(params: {
    userId: string;
    strategyId: string;
    productId?: string;
    product: any;
    goal: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';
    weekPreview: Array<{
      day: number;
      platform: string;
      task_type: string;
      headline: string;
      body: string;
      hashtags?: string[];
      hook?: string;
      tiktok_script?: any;
    }>;
  }): Promise<PreviewAsset[]> {
    this.log(`Generating strategy preview assets — ${params.weekPreview.length} days for user ${params.userId}`);

    // Get Director direction once — shared across all 7 days for visual consistency
    let sharedDirection: VisualDirection | undefined;
    try {
      const { DirectorAgent } = await import('./directorAgent');
      const director = new DirectorAgent();
      sharedDirection = await director.getDirection({
        userId: params.userId,
        productId: params.productId,
        strategyId: params.strategyId,
        product: params.product,
        goal: params.goal,
      });
      this.log(`Director visual identity established for preview batch`);
    } catch (e: any) {
      this.log(`Director unavailable for preview batch: ${e.message}`);
    }

    // Generate all 7 days in parallel (with concurrency limit of 4 to avoid rate limits)
    const results: PreviewAsset[] = [];
    const batchSize = 4;

    for (let i = 0; i < params.weekPreview.length; i += batchSize) {
      const batch = params.weekPreview.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (day) => {
          try {
            const asset = await this.generatePostGraphic({
              userId: params.userId,
              productId: params.productId,
              strategyId: params.strategyId,
              platform: day.platform,
              goal: params.goal,
              agentType: params.goal,
              postContent: {
                headline: day.headline,
                body: day.body,
                hashtags: day.hashtags,
                taskType: day.task_type,
              },
              product: params.product,
              dayNumber: day.day,
              totalDays: 7,
              direction: sharedDirection,
            });

            return {
              day: day.day,
              platform: day.platform,
              taskType: day.task_type,
              headline: day.headline,
              body: day.body,
              hashtags: day.hashtags || [],
              hook: day.hook,
              tiktokScript: day.tiktok_script,
              imageUrl: asset.url || undefined,
              designStyle: asset.designStyle,
              fingerprint: asset.fingerprint,
            } as PreviewAsset;
          } catch (e: any) {
            this.log(`Day ${day.day} preview failed: ${e.message}`);
            return {
              day: day.day,
              platform: day.platform,
              taskType: day.task_type,
              headline: day.headline,
              body: day.body,
              hashtags: day.hashtags || [],
              hook: day.hook,
              tiktokScript: day.tiktok_script,
              error: e.message,
            } as PreviewAsset;
          }
        })
      );
      results.push(...batchResults);
    }

    this.log(`Preview batch complete — ${results.filter(r => r.imageUrl).length}/${results.length} assets generated`);
    return results.sort((a, b) => a.day - b.day);
  }

  /**
   * AGENT INTEGRATION: Generate and attach graphic to a post before publishing.
   * Used by all 4 agents in their executeTask methods to get platform-ready image URLs.
   *
   * @returns Public image URL or undefined if generation fails
   */
  async getImageForPost(params: {
    userId: string;
    productId?: string;
    strategyId?: string;
    platform: string;
    goal: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';
    agentType: string;
    headline: string;
    body: string;
    imagePromptHint?: string;
    hashtags?: string[];
    cta?: string;
    taskType?: string;
    dayNumber?: number;
    product: any;
    direction?: VisualDirection;
  }): Promise<string | undefined> {
    try {
      const asset = await this.generatePostGraphic({
        userId: params.userId,
        productId: params.productId,
        strategyId: params.strategyId,
        platform: params.platform,
        goal: params.goal,
        agentType: params.agentType,
        postContent: {
          headline: params.headline,
          body: params.body,
          hashtags: params.hashtags,
          cta: params.cta,
          taskType: params.taskType,
        },
        product: params.product,
        dayNumber: params.dayNumber,
        direction: params.direction,
      });

      return asset.url || undefined;
    } catch (e: any) {
      this.log(`getImageForPost failed: ${e.message}`);
      return undefined;
    }
  }
}

export const graphicsDesignerAgent = new GraphicsDesignerAgent();
