import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import type { VisualDirection } from '../agents/directorAgent';

const execAsync = promisify(exec);

export class CreativeService {
    private ai: AIEngine;
    private supabase;

    constructor() {
        this.ai = AIEngine.getInstance();
        this.supabase = getServiceSupabaseClient();
    }

    /**
     * Generates a professional product image using Google Imagen 3.
     * Director's visual direction shapes the image generation prompt.
     */
    async generateProfessionalImage(baseImageUri: string, productDetails: any, direction?: VisualDirection): Promise<string> {
        console.log(`[Creative:Imagen] Generating professional image for: ${productDetails.name}`);

        try {
            const directorPrefix = direction?.image_generation_prefix
                ? `${direction.image_generation_prefix}, `
                : '';
            const moodHint = direction?.visual_mood ? `, ${direction.visual_mood} aesthetic` : '';
            const colorHint = direction?.color_palette
                ? `, color palette: ${direction.color_palette.primary} and ${direction.color_palette.secondary}`
                : '';

            const promptResult = await this.ai.generateStrategy({}, `
                Create a short, vivid image generation prompt (max 220 characters) for Google Imagen.
                The image must follow this DIRECTOR's visual direction: ${directorPrefix}
                Product: ${productDetails.name}
                Description: ${productDetails.description || ''}
                Category: ${productDetails.category || ''}
                Visual mood: ${direction?.visual_mood || 'professional commercial'}
                Lighting: ${direction?.lighting || 'studio'}
                Composition: ${direction?.composition_style || 'product-hero'}
                Trust elements to include: ${JSON.stringify(direction?.trust_elements || [])}
                Elements to AVOID: ${JSON.stringify(direction?.avoid_elements || [])}
                
                Output JSON: { "prompt": "..." }
            `);
            const imagePrompt = promptResult.parsedJson?.prompt ||
                `${directorPrefix}Professional studio photography of ${productDetails.name}, clean background, commercial lighting${moodHint}${colorHint}`;

            const imageResult = await this.ai.generateImage(
                `Professional commercial advertisement: ${imagePrompt}. Photorealistic, high-fidelity, 8K.`
            );

            if (!imageResult) {
                console.warn('[Creative:Imagen] Image generation returned null, using original');
                return baseImageUri;
            }

            const fileName = `creative_${Date.now()}.${imageResult.mimeType.split('/')[1] || 'png'}`;
            const buffer = Buffer.from(imageResult.base64, 'base64');
            const { error: uploadError } = await this.supabase.storage
                .from('creative-assets')
                .upload(fileName, buffer, { contentType: imageResult.mimeType, upsert: true });

            if (uploadError) {
                console.error('[Creative:Imagen] Storage upload failed:', uploadError.message);
                return `data:${imageResult.mimeType};base64,${imageResult.base64}`;
            }

            const { data: publicUrlData } = this.supabase.storage
                .from('creative-assets')
                .getPublicUrl(fileName);

            console.log(`[Creative:Imagen] Image generated and stored: ${publicUrlData.publicUrl}`);
            return publicUrlData.publicUrl;
        } catch (e: any) {
            console.error('[Creative:Imagen] Image generation failed:', e.message);
            return baseImageUri;
        }
    }

    /**
     * Generates a video storyboard using AI-generated scene images (Google Imagen 3).
     * Director's visual direction shapes every scene image prompt.
     * Psychologist insights shape the script's emotional arc.
     */
    async generateVideoAsset(productDetails: any, platform: string, direction?: VisualDirection, psychProfile?: any): Promise<any> {
        console.log(`[Creative:Video] Generating video asset for: ${platform}`);

        try {
            const directorScriptNote = direction?.video_style_guide
                ? `\nDIRECTOR'S VIDEO STYLE: ${direction.video_style_guide}`
                : '';
            const psychNote = psychProfile?.emotional_triggers?.primary
                ? `\nPSYCHOLOGIST INSIGHT — Primary emotional driver for this audience: "${psychProfile.emotional_triggers.primary}". Emotional arc: ${psychProfile.emotional_triggers.emotional_arc || ''}. Trust signals to include: ${JSON.stringify(psychProfile.trust_signals || []).slice(0, 150)}. Rejection signals to avoid: ${JSON.stringify(psychProfile.rejection_signals || []).slice(0, 150)}.`
                : '';
            const platformAdaptation = direction?.platform_adaptations?.[platform.toLowerCase()]
                ? `\nPLATFORM-SPECIFIC DIRECTION for ${platform}: ${direction.platform_adaptations[platform.toLowerCase()]}`
                : '';

            const scriptResult = await this.ai.generateStrategy({}, `
                Create a high-performing organic video ad script for ${platform}.
                PRODUCT: ${productDetails.name}
                DESCRIPTION: ${productDetails.description}
                GOAL: Hook in first 3 seconds, build trust, strong CTA.
                EMOTIONAL TONE: ${direction?.emotional_tone || 'confident'}
                ${directorScriptNote}
                ${psychNote}
                ${platformAdaptation}
                
                OUTPUT JSON:
                {
                    "hook": "string (first 3 seconds — must exploit primary emotional trigger)",
                    "scenes": [
                        { "visual_description": "string (≤120 chars for image gen, use Director's style)", "text_overlay": "string", "duration": number }
                    ],
                    "music_vibe": "string",
                    "cta": "string"
                }
            `);
            const script = scriptResult.parsedJson;
            if (!script || !script.scenes) throw new Error('Failed to generate video script.');

            const directorPrefix = direction?.image_generation_prefix || '';
            const moodSuffix = direction?.visual_mood ? `, ${direction.visual_mood}` : '';
            const lightingSuffix = direction?.lighting ? `, ${direction.lighting}` : '';

            const sceneAssets = await Promise.all(script.scenes.map(async (scene: any, i: number) => {
                const scenePrompt = directorPrefix
                    ? `${directorPrefix}, ${scene.visual_description}${moodSuffix}${lightingSuffix}. Commercial quality, 4K.`
                    : `Commercial video frame for ${platform}: ${scene.visual_description}. Cinematic, 4K.`;

                const imgResult = await this.ai.generateImage(scenePrompt);
                let imageUrl: string | null = null;
                if (imgResult) {
                    const fileName = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${imgResult.mimeType.split('/')[1] || 'png'}`;
                    const buffer = Buffer.from(imgResult.base64, 'base64');
                    const { error } = await this.supabase.storage
                        .from('creative-assets')
                        .upload(fileName, buffer, { contentType: imgResult.mimeType, upsert: true });
                    if (!error) {
                        const { data } = this.supabase.storage.from('creative-assets').getPublicUrl(fileName);
                        imageUrl = data.publicUrl;
                    } else {
                        imageUrl = `data:${imgResult.mimeType};base64,${imgResult.base64}`;
                    }
                }
                return { ...scene, image_url: imageUrl, scene_index: i };
            }));

            return {
                platform,
                hook: script.hook,
                music_vibe: script.music_vibe,
                cta: script.cta,
                scenes: sceneAssets,
                direction_used: direction ? { mood: direction.visual_mood, tone: direction.emotional_tone, fingerprint: direction.unique_fingerprint } : null,
                generated_at: new Date().toISOString(),
            };
        } catch (e: any) {
            console.error('[Creative:Video] Video asset generation failed:', e.message);
            return null;
        }
    }

    /**
     * Composes an actual MP4 video file from a storyboard's scene images using ffmpeg.
     * Creates a vertical (9:16 / 1080x1920) slideshow — ideal for TikTok.
     */
    async composeVideoFromStoryboard(storyboard: any, platform: string): Promise<string | null> {
        console.log(`[Creative:Compose] Composing MP4 from storyboard for ${platform}`);
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'adroom-video-'));

        try {
            const scenes: Array<{ file: string; duration: number }> = [];

            for (let i = 0; i < (storyboard.scenes || []).length; i++) {
                const scene = storyboard.scenes[i];
                const imgPath = path.join(tmpDir, `scene_${i}.jpg`);

                if (scene.image_url?.startsWith('data:')) {
                    const base64Data = scene.image_url.split(',')[1];
                    await fs.promises.writeFile(imgPath, Buffer.from(base64Data, 'base64'));
                    scenes.push({ file: imgPath, duration: scene.duration || 3 });
                } else if (scene.image_url) {
                    try {
                        await this.downloadFile(scene.image_url, imgPath);
                        scenes.push({ file: imgPath, duration: scene.duration || 3 });
                    } catch (dlErr: any) {
                        console.warn(`[Creative:Compose] Scene ${i} download failed: ${dlErr.message}`);
                    }
                }
            }

            if (scenes.length === 0) {
                console.warn('[Creative:Compose] No scene images available for composition');
                return null;
            }

            const outputPath = path.join(tmpDir, 'output.mp4');

            const inputArgs = scenes.map(s => `-loop 1 -t ${s.duration} -i "${s.file}"`).join(' ');

            const scaleFilters = scenes
                .map((_, i) =>
                    `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
                    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`
                )
                .join(';');

            const concatFilter =
                scenes.map((_, i) => `[v${i}]`).join('') +
                `concat=n=${scenes.length}:v=1:a=0[outv]`;

            const filterComplex = `"${scaleFilters};${concatFilter}"`;

            const ffmpegCmd =
                `ffmpeg -y ${inputArgs} ` +
                `-filter_complex ${filterComplex} ` +
                `-map "[outv]" -c:v libx264 -pix_fmt yuv420p -r 30 -crf 23 "${outputPath}"`;

            console.log(`[Creative:Compose] Running ffmpeg for ${scenes.length} scenes...`);
            await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });

            const fileName = `tiktok_auto_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.mp4`;
            const videoBuffer = await fs.promises.readFile(outputPath);

            const { error: uploadError } = await this.supabase.storage
                .from('creative-assets')
                .upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

            if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

            const { data: urlData } = this.supabase.storage
                .from('creative-assets')
                .getPublicUrl(fileName);

            console.log(`[Creative:Compose] MP4 ready: ${urlData.publicUrl}`);
            return urlData.publicUrl;

        } catch (e: any) {
            console.error('[Creative:Compose] Composition failed:', e.message);
            return null;
        } finally {
            try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        }
    }

    /**
     * Full pipeline: generate Director+Psychologist-informed storyboard → compose MP4 → return URL.
     * Director's visual direction shapes EVERY image in the video for a unique per-user look.
     * Checks subscription tier before generation.
     */
    async generateTikTokVideo(
        productDetails: any,
        direction?: VisualDirection,
        psychProfile?: any
    ): Promise<string | null> {
        try {
            console.log(`[Creative:TikTok] Starting Director-informed video generation for: ${productDetails.name}`);
            if (direction) {
                console.log(`[Creative:TikTok] Director direction: mood="${direction.visual_mood}" | tone="${direction.emotional_tone}" | fingerprint=${direction.unique_fingerprint}`);
            }
            const storyboard = await this.generateVideoAsset(productDetails, 'tiktok', direction, psychProfile);
            if (!storyboard) {
                console.warn('[Creative:TikTok] Storyboard generation returned null');
                return null;
            }
            const videoUrl = await this.composeVideoFromStoryboard(storyboard, 'tiktok');
            console.log(`[Creative:TikTok] Video generation ${videoUrl ? 'succeeded' : 'failed'}`);
            return videoUrl;
        } catch (e: any) {
            console.error('[Creative:TikTok] Full video generation failed:', e.message);
            return null;
        }
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
