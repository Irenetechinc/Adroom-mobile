import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

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
}
