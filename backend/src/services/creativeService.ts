import fetch from 'node-fetch';
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
     * Generates a professional, marketable version of an uploaded product image.
     */
    async generateProfessionalImage(baseImageUri: string, productDetails: any): Promise<string> {
        console.log(`[Creative] Generating professional image for: ${productDetails.name}`);
        
        try {
            // 1. Use AI to describe the "Perfect Marketing Image" for this product
            const prompt = `
                Describe the most professional, marketable, and algorithm-friendly image for this product.
                PRODUCT: ${productDetails.name}
                DESCRIPTION: ${productDetails.description}
                CATEGORY: ${productDetails.category}
                
                The description should be a prompt for an image generation model (like DALL-E).
                Include lighting, background (e.g., luxury studio, lifestyle setting), and composition.
            `;
            const aiResult = await this.ai.generateStrategy({}, prompt);
            const imagePrompt = aiResult.parsedJson?.description || aiResult.text;

            // 2. Call DALL-E API (OpenAI)
            const response = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: `A professional, high-end commercial photography of ${imagePrompt}. Highly detailed, 8k, studio lighting.`,
                    n: 1,
                    size: "1024x1024"
                })
            });

            const data: any = await response.json();
            return data.data[0].url;
        } catch (e) {
            console.error('[Creative] Image generation failed:', e);
            return baseImageUri; // Fallback to original
        }
    }

    /**
     * Generates a video asset (storyboard with AI images) for algorithmic performance.
     */
    async generateVideoAsset(productDetails: any, platform: string): Promise<any> {
        console.log(`[Creative] Generating video asset for: ${platform}`);
        
        try {
            const prompt = `
                Create a high-performing video ad script for ${platform}.
                PRODUCT: ${productDetails.name}
                DESCRIPTION: ${productDetails.description}
                GOAL: Capture attention in first 3 seconds, explain value, and call to action.
                
                OUTPUT JSON:
                {
                    "hook": "string",
                    "scenes": [
                        {"visual_description": "string", "text_overlay": "string", "duration": number}
                    ],
                    "music_vibe": "string",
                    "cta": "string"
                }
            `;
            const aiResult = await this.ai.generateStrategy({}, prompt);
            const script = aiResult.parsedJson;

            if (!script || !script.scenes) throw new Error("Failed to generate video script.");

            // Generate images for each scene (Production implementation)
            const sceneAssets = await Promise.all(script.scenes.map(async (scene: any) => {
                const imgResponse = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "dall-e-3",
                        prompt: `High-end commercial video frame: ${scene.visual_description}. Cinematic lighting, 4k, ${platform} style.`,
                        n: 1,
                        size: "1024x1024"
                    })
                });
                const imgData: any = await imgResponse.json();
                return {
                    ...scene,
                    image_url: imgData.data?.[0]?.url || null
                };
            }));

            return {
                platform,
                hook: script.hook,
                music_vibe: script.music_vibe,
                cta: script.cta,
                scenes: sceneAssets,
                generated_at: new Date().toISOString()
            };
        } catch (e) {
            console.error('[Creative] Video asset generation failed:', e);
            return null;
        }
    }
}
