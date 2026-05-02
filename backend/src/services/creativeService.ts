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

export class CreativeService {
    private ai: AIEngine;
    private supabase;

    constructor() {
        this.ai = AIEngine.getInstance();
        this.supabase = getServiceSupabaseClient();
    }

    /**
     * Generates a professional product image using Google Imagen 3 (Nano Banana).
     * Falls back to returning the original base image URI if generation fails.
     */
    async generateProfessionalImage(baseImageUri: string, productDetails: any): Promise<string> {
        console.log(`[Creative:Imagen] Generating professional image for: ${productDetails.name}`);

        try {
            // 1. Build an optimal image generation prompt via GPT-4o
            const promptResult = await this.ai.generateStrategy({}, `
                Create a short, vivid image generation prompt (max 200 characters) for Google Imagen.
                The image should be a professional commercial photograph for this product:
                NAME: ${productDetails.name}
                DESCRIPTION: ${productDetails.description || ''}
                CATEGORY: ${productDetails.category || ''}
                
                Include: lighting style, background, composition.
                Output JSON: { "prompt": "..." }
            `);
            const imagePrompt = promptResult.parsedJson?.prompt ||
                `Professional studio photography of ${productDetails.name}, clean background, commercial lighting, high resolution`;

            // 2. Generate image with Google Imagen 3 (Nano Banana)
            const imageResult = await this.ai.generateImage(
                `Professional commercial advertisement image: ${imagePrompt}. Photorealistic, high-fidelity, 8K.`
            );

            if (!imageResult) {
                console.warn('[Creative:Imagen] Image generation returned null, using original');
                return baseImageUri;
            }

            // 3. Upload to Supabase Storage and return public URL
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
     */
    async generateVideoAsset(productDetails: any, platform: string): Promise<any> {
        console.log(`[Creative:Video] Generating video asset for: ${platform}`);

        try {
            const scriptResult = await this.ai.generateStrategy({}, `
                Create a high-performing organic video ad script for ${platform}.
                PRODUCT: ${productDetails.name}
                DESCRIPTION: ${productDetails.description}
                GOAL: Hook in first 3 seconds, explain value, strong CTA.
                
                OUTPUT JSON:
                {
                    "hook": "string",
                    "scenes": [
                        { "visual_description": "string (≤100 chars for image gen)", "text_overlay": "string", "duration": number }
                    ],
                    "music_vibe": "string",
                    "cta": "string"
                }
            `);
            const script = scriptResult.parsedJson;
            if (!script || !script.scenes) throw new Error('Failed to generate video script.');

            // Generate images for each scene via Google Imagen 3
            const sceneAssets = await Promise.all(script.scenes.map(async (scene: any) => {
                const imgResult = await this.ai.generateImage(
                    `Commercial video frame for ${platform}: ${scene.visual_description}. Cinematic, 4K.`
                );
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
                return { ...scene, image_url: imageUrl };
            }));

            return {
                platform,
                hook: script.hook,
                music_vibe: script.music_vibe,
                cta: script.cta,
                scenes: sceneAssets,
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
     * Returns a public Supabase Storage URL for the composed video, or null on failure.
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

            // Build ffmpeg input flags: each image looped for its scene duration
            const inputArgs = scenes.map(s => `-loop 1 -t ${s.duration} -i "${s.file}"`).join(' ');

            // Scale each scene to 1080x1920 (vertical 9:16) with letterbox/pillarbox padding
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

            // Upload composed MP4 to Supabase Storage
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
     * Full pipeline: generate storyboard from product details → compose MP4 → return URL.
     * Used by agents when no user-supplied video is available for a TikTok task.
     */
    async generateTikTokVideo(productDetails: any): Promise<string | null> {
        try {
            console.log(`[Creative:TikTok] Starting full video generation for: ${productDetails.name}`);
            const storyboard = await this.generateVideoAsset(productDetails, 'tiktok');
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
