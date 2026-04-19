import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

export interface VideoEditRequest {
  videoUri: string;
  productName: string;
  goal: string;
  platform: string;
  instructions?: string;
}

export interface VideoEditResult {
  editPlan: {
    hook: string;
    scenes: { description: string; textOverlay: string; duration: number }[];
    music: string;
    cta: string;
    aspectRatio: string;
    filters: string[];
    captionStyle: string;
  };
  scriptText: string;
  estimatedDuration: number;
  platformOptimizations: string[];
  status: 'plan_ready';
  message: string;
}

export class SmartVideoEditor {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async generateEditPlan(request: VideoEditRequest): Promise<VideoEditResult> {
    console.log(`[SmartVideoEditor] Generating edit plan for ${request.productName} → ${request.platform}`);

    const platformSpecs: Record<string, any> = {
      instagram: { ratio: '9:16', maxDuration: 90, captionStyle: 'bold_center', filters: ['contrast_boost', 'warm_tone'] },
      tiktok: { ratio: '9:16', maxDuration: 60, captionStyle: 'dynamic_captions', filters: ['vibrant', 'sharp'] },
      facebook: { ratio: '16:9', maxDuration: 240, captionStyle: 'subtitle_bottom', filters: ['natural'] },
      twitter: { ratio: '16:9', maxDuration: 140, captionStyle: 'bold_top', filters: ['clean'] },
      youtube: { ratio: '16:9', maxDuration: 600, captionStyle: 'professional', filters: ['cinematic'] },
      linkedin: { ratio: '1:1', maxDuration: 180, captionStyle: 'professional', filters: ['corporate'] },
    };

    const spec = platformSpecs[request.platform.toLowerCase()] || platformSpecs.instagram;

    const prompt = `
You are AdRoom AI's Smart Video Editor. Create a professional video editing plan.

PRODUCT: ${request.productName}
MARKETING GOAL: ${request.goal}
PLATFORM: ${request.platform}
ASPECT RATIO: ${spec.ratio}
MAX DURATION: ${spec.maxDuration}s
USER INSTRUCTIONS: ${request.instructions || 'Create the best ad possible'}

Generate a professional video edit plan as JSON:
{
  "hook": "First 3 seconds hook line (must stop the scroll)",
  "scenes": [
    {
      "description": "What to show in this scene",
      "textOverlay": "Text to display on screen",
      "duration": seconds
    }
  ],
  "music": "Music vibe description (e.g. upbeat electronic, emotional acoustic)",
  "cta": "Call to action text and placement",
  "aspectRatio": "${spec.ratio}",
  "filters": ${JSON.stringify(spec.filters)},
  "captionStyle": "${spec.captionStyle}",
  "scriptText": "Full voiceover script",
  "estimatedDuration": total_seconds,
  "platformOptimizations": ["platform-specific optimization 1", "optimization 2", "optimization 3"]
}

Rules:
- Hook must grab attention in first 3 seconds
- Total duration must be under ${spec.maxDuration} seconds
- Make it feel native to ${request.platform}
- Optimize for ${request.goal} conversion
    `;

    const result = await this.ai.generateStrategy({}, prompt);
    const plan = result.parsedJson;

    if (!plan) throw new Error('AI failed to generate video edit plan.');

    return {
      editPlan: {
        hook: plan.hook,
        scenes: plan.scenes || [],
        music: plan.music,
        cta: plan.cta,
        aspectRatio: plan.aspectRatio || spec.ratio,
        filters: plan.filters || spec.filters,
        captionStyle: plan.captionStyle || spec.captionStyle,
      },
      scriptText: plan.scriptText || '',
      estimatedDuration: plan.estimatedDuration || 30,
      platformOptimizations: plan.platformOptimizations || [],
      status: 'plan_ready',
      message: `Edit plan ready for ${request.platform}. Your AI agent will apply this plan when executing the campaign.`,
    };
  }

  async saveEditPlan(userId: string, strategyId: string, videoUri: string, editResult: VideoEditResult): Promise<string> {
    const { data, error } = await this.supabase
      .from('video_edit_jobs')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        source_video_uri: videoUri,
        edit_plan: editResult.editPlan,
        script_text: editResult.scriptText,
        estimated_duration: editResult.estimatedDuration,
        platform_optimizations: editResult.platformOptimizations,
        status: 'plan_ready',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save edit job: ${error.message}`);
    return data.id;
  }
}
