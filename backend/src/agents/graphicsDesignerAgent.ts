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
 * - Per-post creative concept selection from current platform and audience intelligence
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
  imageUrl?: string;
  designStyle?: string;
  fingerprint?: string;
  generating?: boolean;
  error?: string;
}

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
        .select('platform, algorithm_priorities, trending_formats, predictions, captured_at')
        .eq('platform', platform)
        .order('captured_at', { ascending: false })
        .limit(2),
      this.supabase
        .from('social_conversations')
        .select('topics, sentiment, reaction, intent, collected_at')
        .eq('category', productCategory || '')
        .order('collected_at', { ascending: false })
        .limit(15),
      this.supabase
        .from('emotional_ownership')
        .select('emotion, ownership_percentage, owner_brand, captured_at')
        .eq('category', productCategory || '')
        .order('ownership_percentage', { ascending: false })
        .limit(10),
      this.supabase
        .from('narrative_snapshots')
        .select('region, dominant_narrative, emerging_topics, captured_at')
        .order('captured_at', { ascending: false })
        .limit(5),
    ]);

    const latestTimestamp = [ipe.data?.[0]?.captured_at, social.data?.[0]?.collected_at, emotional.data?.[0]?.captured_at, geo.data?.[0]?.captured_at]
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    const hasFreshIntelligence = Boolean(latestTimestamp && Date.now() - latestTimestamp <= 24 * 60 * 60 * 1000);
    const freshness = {
      sourceTimestamp: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
      isFresh: hasFreshIntelligence,
      fallback: hasFreshIntelligence ? null : 'current intelligence is missing or older than 24 hours',
    };
    return {
      ipe: ipe.data || [],
      social: social.data || [],
      emotional: emotional.data || [],
      geo: geo.data || [],
      freshness,
    };
  }

  /**
   * Select an original creative concept for this specific post context.
   * The model must derive the concept from live platform, audience, product, and goal data.
   */
  private async selectCreativeConcept(brief: DesignBrief, intel: any): Promise<string> {
    const platformSignals = (intel.ipe || []).filter((entry: any) =>
      String(entry.platform || '').toLowerCase() === brief.platform.toLowerCase(),
    );
    const freshness = intel.freshness || { isFresh: false, fallback: 'intelligence metadata unavailable' };
    const prompt = `Choose one original visual concept for this specific post. Do not use a named template, fixed catalog, or reusable layout.
Platform: ${brief.platform}; platform intelligence: ${JSON.stringify(platformSignals[0] || {})}
Intelligence freshness: ${JSON.stringify(freshness)}. If stale or missing, explicitly choose a conservative platform-native fallback based on the supplied content and audience instead of pretending trends are current.
Goal: ${brief.goal}; task: ${brief.postContent.taskType || 'post'}
Headline: ${brief.postContent.headline}; body: ${brief.postContent.body.slice(0, 500)}
Current algorithm signals: ${JSON.stringify(intel.ipe.slice(0, 2))}
Current audience signals: ${JSON.stringify(intel.social.slice(0, 8))}
Return one concise concept describing subject, composition, motion/energy, typography treatment, and why it is native to this platform.`;
    const result = await this.ai.generateStrategy({}, prompt);
    const concept = result.text?.trim().replace(/^"|"$/g, '').slice(0, 800);
    if (!concept) throw new Error(`The creative director returned no concept for ${brief.platform}.`);
    return concept;
  }

  /**
   * Build the world-class Imagen 3 prompt for this specific graphic.
   * Every prompt is data-driven from intelligence engines + unique fingerprint.
   */
  private async buildImagePrompt(brief: DesignBrief, creativeConcept: string, fingerprint: string, intel: any): Promise<string> {
    const platformSignals = (intel.ipe || []).filter((entry: any) =>
      String(entry.platform || '').toLowerCase() === brief.platform.toLowerCase(),
    );
    const freshness = intel.freshness || { isFresh: false, fallback: 'intelligence metadata unavailable' };
    const platformIntelligence = platformSignals[0];
    const productName = brief.product?.product_name || brief.product?.name || 'product';
    const productCategory = brief.product?.category || 'consumer product';

    // Extract emotional gap from intelligence — design into the emotion NOT owned by competitors
    const ownedEmotions = intel.emotional.map((e: any) => e.emotion).join(', ');
    const trendingTopics = intel.social.slice(0, 3).map((s: any) => s.topics?.[0] || '').filter(Boolean).join(', ');

    const designDirective = `
You are the world's greatest AI art director for social media advertising.
Create a precise, production-ready Imagen 3 image generation prompt for this post.

UNIQUE POST FINGERPRINT: ${fingerprint}
AI-SELECTED CREATIVE CONCEPT: ${creativeConcept}
PLATFORM: ${brief.platform.toUpperCase()}
CURRENT PLATFORM REQUIREMENTS: ${JSON.stringify(platformIntelligence || {})}
INTELLIGENCE FRESHNESS: ${JSON.stringify(freshness)}
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

CREATIVE DECISION DIRECTIVE:
${this.getCreativeConceptDirective(creativeConcept, brief.goal, brief.platform)}

ABSOLUTE REQUIREMENTS:
- This fingerprint (${fingerprint}) must be expressed in color tones, composition angle, or lighting signature
- ZERO generic stock photo energy — must feel custom-crafted for this exact product and moment
- Platform-native: feels like it belongs on ${brief.platform}, not copied from another platform
- Follow the current platform requirements above; do not import assumptions from another platform
- Photorealistic commercial photography or bold graphic art — never clip-art or generic illustration
- 8K ultra-sharp resolution, professional color grading

Generate a Imagen 3 prompt (max 280 characters) that produces the current platform-native composition described by the intelligence above.
The image must DEMAND attention and drive toward: ${this.getGoalVisualCTA(brief.goal)}

Return ONLY the image prompt text, nothing else.
`;

    const result = await this.ai.generateStrategy({}, designDirective);
    const rawPrompt = result.text?.trim().replace(/^"|"$/g, '').replace(/```.*?```/gs, '').trim() || '';

    if (rawPrompt.length > 30) {
      return rawPrompt.substring(0, 280);
    }
    throw new Error(`The image prompt generator returned no usable prompt for ${brief.platform}.`);
  }

  private getCreativeConceptDirective(concept: string, _goal: string, platform: string): string {
    return `Use this AI-selected original concept, not a reusable layout: ${concept}. Preserve platform-native safe zones, readable hierarchy, and a clear product/brand focal point for ${platform}.`;
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

      // 2. Select an original concept from current intelligence or an explicit fallback
       const creativeConcept = await this.selectCreativeConcept(brief, intel);
       this.log(`Creative concept selected (fresh=${intel.freshness?.isFresh === true}, fingerprint: ${fingerprint})`);

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
         creativeConcept,
        fingerprint,
        intel
      );

      this.log(`Generating image with Imagen 3: ${imagePrompt.substring(0, 80)}…`);

      // 5. Generate image with Imagen 3
      const imageResult = await this.ai.generateImage(
        `${imagePrompt}, ultra-high-quality, photorealistic, 8K, professional commercial photography, sharp focus`,
        brief.userId,
      );

      if (!imageResult?.base64) {
        this.log(`Imagen 3 returned no image for fingerprint ${fingerprint}`);
        throw new Error('Image generation returned no image data.');
      }

      // 6. Upload to Supabase storage
      const publicUrl = await this.uploadToStorage(imageResult.base64, imageResult.mimeType, fingerprint);

      if (!publicUrl) {
        throw new Error('Generated image could not be uploaded to public storage.');
      }

      this.log(`Graphic generated ✓ — ${publicUrl.split('/').pop()}`);

      // 7. Log to design history (non-blocking)
      this.supabase.from('gda_design_history').insert({
        user_id: brief.userId,
        strategy_id: brief.strategyId,
        platform: brief.platform,
        goal: brief.goal,
         creative_concept: creativeConcept,
        fingerprint,
        image_url: publicUrl,
        prompt: imagePrompt,
        day_number: brief.dayNumber ?? 0,
        intelligence_freshness: intel.freshness,
        decision_metadata: {
          platform: brief.platform,
          category: productCategory,
          goal: brief.goal,
          mediaFormat: 'image',
        },
        created_at: new Date().toISOString(),
      }); // fire-and-forget design history log

      return {
        url: publicUrl,
        platform: brief.platform,
         contentType: 'image',
        headline: brief.postContent.headline,
         designStyle: creativeConcept,
        fingerprint,
        generatedAt: new Date().toISOString(),
        prompt: imagePrompt,
      };
    } catch (e: any) {
      this.log(`Graphic generation failed: ${e.message}`);
      throw new Error(`Creative asset generation failed: ${e.message}`);
    }
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
      throw new Error(`Creative asset generation failed: ${e.message}`);
    }
  }
}

export const graphicsDesignerAgent = new GraphicsDesignerAgent();
