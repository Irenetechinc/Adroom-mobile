import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { PsychologistEngine } from '../services/psychologistEngine';
import crypto from 'crypto';

export interface VisualDirection {
  color_palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: {
    style: string;
    weight: string;
    size_scale: string;
  };
  visual_mood: string;
  composition_style: string;
  motion_style: string;
  lighting: string;
  texture: string;
  unique_fingerprint: string;
  image_generation_prefix: string;
  video_style_guide: string;
  platform_adaptations: Record<string, string>;
  emotional_tone: string;
  trust_elements: string[];
  avoid_elements: string[];
  should_use_user_video: boolean;
  user_video_rationale?: string;
  reasoning: string;
  _profileId?: string;
}

/**
 * DIRECTOR AGENT
 * The world's best virtual creative director for marketing.
 *
 * Responsibilities:
 * - Define how EVERY visual asset (image, video, graphic) should look, feel, and move
 * - Guarantee every user gets a UNIQUE visual identity — no two users ever share the same design language
 * - Make all decisions from real-time data: Psychologist Engine, Social Listening, IPE, GEO, Emotional Intelligence
 * - Decide whether to use the user's uploaded video or generate a new one based on strategy needs
 * - Adapt dynamically to any product, brand, or service category
 */
export class DirectorAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;
  private psychologist: PsychologistEngine;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
    this.psychologist = new PsychologistEngine();
  }

  /**
   * Generate or retrieve the full visual direction for a campaign.
   * This is the primary method called by CreativeService and Agents.
   */
  async getDirection(params: {
    userId: string;
    productId?: string;
    strategyId?: string;
    product: any;
    platform?: string;
    goal?: string;
    hasUserVideo?: boolean;
    strategyGoalData?: any;
  }): Promise<VisualDirection> {
    console.log(`[Director] Generating visual direction for user ${params.userId} — product: ${params.product?.name || 'unknown'}`);

    const [psychProfile, platformIntel, emotionalOwnership, socialTrends, existingProfile] = await Promise.all([
      this.psychologist.getProfileForProduct(params.productId || '', params.product?.category),
      this.supabase
        .from('platform_intelligence')
        .select('platform, algorithm_priorities, trending_formats, optimal_times, predictions')
        .order('captured_at', { ascending: false })
        .limit(5),
      this.supabase
        .from('emotional_ownership')
        .select('emotion, ownership_percentage, owner_brand')
        .eq('category', params.product?.category || '')
        .limit(15),
      this.supabase
        .from('social_conversations')
        .select('topics, sentiment, reaction, intent')
        .eq('category', params.product?.category || '')
        .order('collected_at', { ascending: false })
        .limit(25),
      this.supabase
        .from('director_profiles')
        .select('visual_identity, unique_fingerprint')
        .eq('user_id', params.userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const userSeed = crypto
      .createHash('sha256')
      .update(`${params.userId}-${params.product?.name || ''}-${params.product?.category || ''}-${Date.now()}`)
      .digest('hex')
      .slice(0, 14);

    const prompt = `
You are the DIRECTOR — the world's greatest virtual creative director for marketing.

Your mandate: Define EXACTLY how every visual asset should look, feel, and move for this specific product and user.
This direction will be used to generate ALL images and videos for this campaign.

ABSOLUTE RULES:
- Every user gets a COMPLETELY UNIQUE visual identity — no two users share the same design language
- ALL decisions must derive from the real-time intelligence data below — zero generic defaults
- Be specific enough that any AI image/video generator produces consistent, unique, on-brand results
- The visual direction must directly exploit psychological insights to achieve the user's goal
- The unique_fingerprint (${userSeed}) MUST be reflected in the visual choices

PRODUCT / BRAND:
${JSON.stringify(params.product)}

CAMPAIGN GOAL: ${params.goal || 'brand awareness and engagement'}
TARGET PLATFORM: ${params.platform || 'multi-platform'}
USER HAS UPLOADED THEIR OWN VIDEO: ${params.hasUserVideo ? 'YES' : 'NO'}

REAL-TIME PSYCHOLOGICAL PROFILE (Psychologist Engine):
${JSON.stringify(psychProfile)}

PLATFORM ALGORITHM INTELLIGENCE (what's working right now):
${JSON.stringify(platformIntel.data?.slice(0, 3))}

EMOTIONAL OWNERSHIP MAP (what emotions competitors own — find the gap):
${JSON.stringify(emotionalOwnership.data?.slice(0, 8))}

LIVE SOCIAL SIGNALS (what this audience is engaging with right now):
${JSON.stringify(socialTrends.data?.slice(0, 12))}

${existingProfile.data
    ? `EXISTING USER VISUAL IDENTITY (evolve from this, do NOT copy it exactly):
${JSON.stringify(existingProfile.data.visual_identity)}`
    : 'NEW USER — Create a completely original visual identity from scratch'}

UNIQUE SEED FOR THIS USER: ${userSeed}

DIRECT THIS CAMPAIGN — answer each question with precision:

1. What EXACT color palette will emotionally resonate with this audience AND create gap vs competitors?
2. What visual mood exploits the primary psychological trigger detected by the Psychologist?
3. What composition style matches how this audience actually consumes content on ${params.platform || 'social media'}?
4. What motion style matches their decision velocity (${psychProfile?.timing_patterns?.decision_velocity || 'unknown'})?
5. What specific image prefix makes EVERY asset visually unique to this user (not generic)?
6. What specific video direction will exploit trust signals and avoid rejection signals?
7. How does this adapt per platform based on algorithm intelligence?
8. Should the campaign use the USER's uploaded video or GENERATE a new one? (Base this on strategy goal, product type, platform requirements, and what the Psychologist says will convert this audience)

OUTPUT JSON:
{
  "color_palette": {
    "primary": "#HEX",
    "secondary": "#HEX",
    "accent": "#HEX",
    "background": "#HEX",
    "text": "#HEX"
  },
  "typography": {
    "style": "e.g. bold-impact / elegant-serif / tech-sans / handwritten-casual",
    "weight": "heavy|bold|medium|light",
    "size_scale": "large-dominant|balanced|subtle"
  },
  "visual_mood": "e.g. urgent-scarcity / warm-community / raw-authentic / premium-aspirational",
  "composition_style": "e.g. product-hero-centered / lifestyle-in-context / human-face-dominant / flat-lay",
  "motion_style": "e.g. fast-cut-kinetic / slow-dramatic-reveal / text-cascade / zoom-punch",
  "lighting": "e.g. high-key studio clean / golden-hour cinematic / neon-night urban / natural-window",
  "texture": "e.g. clean-minimal-white / gritty-real-life / premium-metallic / warm-organic",
  "unique_fingerprint": "${userSeed}",
  "image_generation_prefix": "EXACT style prefix string to prepend to ALL image generation prompts for this user (make it specific and unique)",
  "video_style_guide": "EXACT directorial instructions for all video content (specific shots, pacing, text style, energy)",
  "platform_adaptations": {
    "tiktok": "specific TikTok direction based on current algorithm intelligence",
    "instagram": "specific Instagram direction",
    "facebook": "specific Facebook direction",
    "linkedin": "specific LinkedIn direction",
    "twitter": "specific Twitter/X direction"
  },
  "emotional_tone": "The single dominant emotional note that ALL content must evoke",
  "trust_elements": ["specific visual trust signal 1 based on audience psychology", "signal 2"],
  "avoid_elements": ["specific visual element to avoid based on rejection signals", "element 2"],
  "should_use_user_video": true,
  "user_video_rationale": "Explanation of why to use user video OR generate new — based on strategy goal and psychology",
  "reasoning": "Brief but specific explanation of why this direction will work for THIS audience based on the data"
}
`;

    const response = await this.ai.generateStrategy({}, prompt);
    const direction: VisualDirection = response.parsedJson || this.getDefaultDirection(params.userId, params.product);

    direction.unique_fingerprint = userSeed;

    if (typeof direction.should_use_user_video !== 'boolean') {
      direction.should_use_user_video = params.hasUserVideo === true;
    }

    const { data: savedProfile } = await this.supabase
      .from('director_profiles')
      .insert({
        user_id: params.userId,
        product_id: params.productId,
        strategy_id: params.strategyId,
        visual_identity: direction,
        creative_direction: {
          image_prefix: direction.image_generation_prefix,
          video_guide: direction.video_style_guide,
          platform_adaptations: direction.platform_adaptations,
          emotional_tone: direction.emotional_tone,
        },
        unique_fingerprint: userSeed,
        emotional_tone: { primary: direction.emotional_tone },
        platform_adaptations: direction.platform_adaptations,
        generated_from: {
          psychologist_used: !!psychProfile,
          platform_signals: (platformIntel.data || []).length,
          social_signals: (socialTrends.data || []).length,
          emotional_signals: (emotionalOwnership.data || []).length,
          has_user_video: params.hasUserVideo,
        },
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (savedProfile) {
      direction._profileId = savedProfile.id;
    }

    console.log(
      `[Director] Direction ready for user ${params.userId}: mood="${direction.visual_mood}" | tone="${direction.emotional_tone}" | use_user_video=${direction.should_use_user_video}`
    );

    return direction;
  }

  /**
   * Retrieve the latest stored direction for a user (used when re-using an existing profile).
   */
  async getLatestDirectionForUser(userId: string): Promise<VisualDirection | null> {
    const { data } = await this.supabase
      .from('director_profiles')
      .select('visual_identity')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return (data?.visual_identity as VisualDirection) || null;
  }

  private getDefaultDirection(userId: string, product: any): VisualDirection {
    const seed = crypto.createHash('sha256').update(`${userId}-default-${Date.now()}`).digest('hex').slice(0, 14);
    return {
      color_palette: { primary: '#00F0FF', secondary: '#1E293B', accent: '#F59E0B', background: '#0B0F19', text: '#F1F5F9' },
      typography: { style: 'bold-impact', weight: 'heavy', size_scale: 'large-dominant' },
      visual_mood: 'confident-modern',
      composition_style: 'product-hero-centered',
      motion_style: 'fast-cut-kinetic',
      lighting: 'high-key studio clean',
      texture: 'clean-minimal-white',
      unique_fingerprint: seed,
      image_generation_prefix: `Commercial product photography, ${product?.name || 'product'}, clean studio, high contrast, cinematic quality`,
      video_style_guide: 'Fast cuts every 2-3 seconds, bold text overlays, product hero shots, high energy',
      platform_adaptations: {
        tiktok: 'Vertical 9:16, hook in first 2s, trending-style text overlays',
        instagram: 'Square or vertical, lifestyle aesthetic, save-worthy composition',
        facebook: 'Horizontal 16:9, story-driven, captions visible',
        linkedin: 'Professional tone, clean corporate aesthetic',
        twitter: 'Bold headline image, text-readable at small size',
      },
      emotional_tone: 'confident',
      trust_elements: ['Clear product visibility', 'Clean professional presentation'],
      avoid_elements: ['Cluttered backgrounds', 'Low-quality textures'],
      should_use_user_video: false,
      user_video_rationale: 'Default: generating optimized video from product details',
      reasoning: 'Default direction — will be refined as real-time intelligence data is collected',
    };
  }
}
