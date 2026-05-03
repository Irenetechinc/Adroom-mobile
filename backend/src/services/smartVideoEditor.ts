import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';

const execAsync = promisify(exec);

export interface VideoEditRequest {
  videoUri: string;
  productName: string;
  goal: string;
  platform: string;
  instructions?: string;
  directionPrefix?: string;
  visualMood?: string;
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

    const directorNote = request.directionPrefix
      ? `\nDIRECTOR VISUAL DIRECTION: ${request.directionPrefix}\nVISUAL MOOD: ${request.visualMood || 'modern'}\nApply this direction to all text overlays, pacing, and caption style choices.`
      : '';

    const prompt = `
You are AdRoom AI's Smart Video Editor. Create a professional video editing plan.

PRODUCT: ${request.productName}
MARKETING GOAL: ${request.goal}
PLATFORM: ${request.platform}
ASPECT RATIO: ${spec.ratio}
MAX DURATION: ${spec.maxDuration}s
USER INSTRUCTIONS: ${request.instructions || 'Create the best ad possible'}
${directorNote}

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
      message: `Edit plan ready for ${request.platform}. AdRoom AI will apply this plan when executing the campaign.`,
    };
  }

  async saveEditPlan(userId: string, strategyId: string, videoUri: string, editResult: VideoEditResult, extras?: { platform?: string; productId?: string; directorProfileId?: string }): Promise<string> {
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
        execution_status: 'plan_ready',
        platform: extras?.platform,
        product_id: extras?.productId,
        director_profile_id: extras?.directorProfileId,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save edit job: ${error.message}`);
    return data.id;
  }

  /**
   * Execute a saved edit plan against the source video using ffmpeg.
   * Downloads the source video, applies aspect ratio, color filters, and duration trimming.
   * Uploads the result to Supabase Storage and returns the public URL.
   */
  async executeEditPlan(jobId: string): Promise<string | null> {
    const { data: job } = await this.supabase
      .from('video_edit_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) {
      console.warn(`[SmartVideoEditor] Job ${jobId} not found`);
      return null;
    }

    if (job.execution_status === 'completed' && job.executed_video_url) {
      console.log(`[SmartVideoEditor] Job ${jobId} already executed — returning cached URL`);
      return job.executed_video_url;
    }

    if (!job.source_video_uri) {
      console.warn(`[SmartVideoEditor] Job ${jobId} has no source video URI`);
      return null;
    }

    await this.supabase
      .from('video_edit_jobs')
      .update({ execution_status: 'executing' })
      .eq('id', jobId);

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'adroom-edit-'));

    try {
      const plan = job.edit_plan || {};
      const outputPath = path.join(tmpDir, 'edited_output.mp4');
      const sourceVideoPath = path.join(tmpDir, 'source_video.mp4');

      console.log(`[SmartVideoEditor] Downloading source video from ${job.source_video_uri}`);
      await this.downloadFile(job.source_video_uri, sourceVideoPath);

      const aspectRatioFilter = this.buildAspectRatioFilter(plan.aspectRatio || '9:16');
      const colorFilter = this.buildColorFilter(plan.filters || []);

      const allFilters = [aspectRatioFilter, colorFilter].filter(Boolean).join(',');
      const videoFilter = allFilters || 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1';

      const totalDuration = plan.scenes?.reduce((sum: number, s: any) => sum + (s.duration || 5), 0) || job.estimated_duration || 30;

      const ffmpegCmd =
        `ffmpeg -y -i "${sourceVideoPath}" ` +
        `-vf "${videoFilter}" ` +
        `-t ${totalDuration} ` +
        `-c:v libx264 -pix_fmt yuv420p -crf 23 -r 30 ` +
        `-c:a aac -b:a 128k ` +
        `"${outputPath}"`;

      console.log(`[SmartVideoEditor] Running ffmpeg for job ${jobId}...`);
      await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });

      const fileName = `edited_${jobId}_${Date.now()}.mp4`;
      const videoBuffer = await fs.promises.readFile(outputPath);

      const { error: uploadError } = await this.supabase.storage
        .from('creative-assets')
        .upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const { data: urlData } = this.supabase.storage
        .from('creative-assets')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      await this.supabase.from('video_edit_jobs').update({
        executed_video_url: publicUrl,
        execution_status: 'completed',
        executed_at: new Date().toISOString(),
      }).eq('id', jobId);

      console.log(`[SmartVideoEditor] Job ${jobId} complete — ${publicUrl}`);
      return publicUrl;

    } catch (e: any) {
      console.error(`[SmartVideoEditor] Job ${jobId} execution failed:`, e.message);
      await this.supabase.from('video_edit_jobs').update({
        execution_status: 'failed',
        execution_error: e.message,
      }).eq('id', jobId);
      throw e;
    } finally {
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  /**
   * Get the best available video for a strategy — executed edit, user original, or null.
   */
  async getBestVideoForStrategy(strategyId: string, userVideoUrl?: string): Promise<string | null> {
    const { data: jobs } = await this.supabase
      .from('video_edit_jobs')
      .select('id, execution_status, executed_video_url, source_video_uri')
      .eq('strategy_id', strategyId)
      .order('created_at', { ascending: false })
      .limit(1);

    const job = jobs?.[0];

    if (job?.execution_status === 'completed' && job.executed_video_url) {
      return job.executed_video_url;
    }

    if (job?.execution_status === 'plan_ready' && job.id) {
      try {
        const url = await this.executeEditPlan(job.id);
        if (url) return url;
      } catch (e: any) {
        console.error(`[SmartVideoEditor] Auto-execute of pending job ${job.id} failed:`, e.message);
      }
    }

    return userVideoUrl || job?.source_video_uri || null;
  }

  private buildAspectRatioFilter(aspectRatio: string): string {
    const ratioMap: Record<string, string> = {
      '9:16': 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '1:1': 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '16:9': 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '4:5': 'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
    };
    return ratioMap[aspectRatio] || ratioMap['9:16'];
  }

  private buildColorFilter(filters: string[]): string {
    const filterMap: Record<string, string> = {
      vibrant: 'eq=contrast=1.3:saturation=1.4:brightness=0.02',
      sharp: 'unsharp=5:5:1.5:5:5:0.0',
      warm_tone: 'colorbalance=rs=0.1:gs=0:bs=-0.1:rm=0.1:gm=0:bm=-0.1',
      contrast_boost: 'eq=contrast=1.4:saturation=1.1',
      natural: 'eq=contrast=1.05:saturation=1.05',
      clean: 'eq=contrast=1.1:brightness=0.01',
      cinematic: 'eq=contrast=1.2:saturation=0.9,colorbalance=rs=-0.05:gs=0:bs=0.05',
      corporate: 'eq=contrast=1.1:saturation=0.95:brightness=0.02',
    };

    const applied = filters.map(f => filterMap[f]).filter(Boolean);
    return applied.join(',');
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol: typeof https | typeof http = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      protocol.get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
}
