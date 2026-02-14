import { RemoteLogger } from './remoteLogger';
import { readAsStringAsync } from 'expo-file-system';

// OpenAI Client Configuration
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

export interface VisualAttributes {
    name: string;
    description: string;
    dimensions: string; // e.g. "10x5x2 inches"
    colorPalette: string[];
    estimatedPrice: string;
}

export const VisionService = {
    /**
     * Analyzes an image using GPT-4o Vision to extract product attributes.
     */
    async analyzeProductImage(imageUri: string): Promise<VisualAttributes> {
        RemoteLogger.log('VISION', `Starting analysis for image: ${imageUri}`);
        
        if (!OPENAI_API_KEY) {
            RemoteLogger.warn('VISION', 'OpenAI API Key missing.');
            throw new Error('OpenAI API Key is required for vision analysis.');
        }

        try {
            // Convert image to base64 if needed
            let base64Image = imageUri;
            
            // Check if it's a local file URI
            if (imageUri.startsWith('file://') || imageUri.startsWith('/')) {
                 try {
                    base64Image = await readAsStringAsync(imageUri, {
                        encoding: 'base64',
                    });
                    // Prefix with data URI scheme if not present (OpenAI needs it or just base64 string depending on format)
                   // For "image_url" with base64, format is: "data:image/jpeg;base64,{base64_image}"
                   base64Image = `data:image/jpeg;base64,${base64Image}`;
                } catch (readError) {
                   console.error('Failed to read local image file:', readError);
                   throw new Error('Could not read local image file for analysis.');
                }
            }

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [
                        {
                            role: "system",
                            content: `You are AdRoom's Advanced Computer Vision Engine. 
                            Analyze the product image provided.
                            Extract the following details in strict JSON format:
                            1. name: Specific product name (e.g. "Nike Air Max 90").
                            2. description: Brief visual description.
                            3. dimensions: Estimated physical dimensions (Height x Width x Depth) if discernible.
                            4. colorPalette: Array of dominant hex codes or color names.
                            5. estimatedPrice: Estimated market price range in USD based on product identification.
                            
                            Return JSON: { "name": "...", "description": "...", "dimensions": "...", "colorPalette": ["..."], "estimatedPrice": "..." }`
                        },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "Analyze this product image." },
                                { type: "image_url", image_url: { url: base64Image } } 
                            ]
                        }
                    ],
                    max_tokens: 500
                })
            });

            const data = await response.json();
            
            if (!response.ok) {
                // If it fails (likely due to local file URI not being accessible by OpenAI),
                // we might need to handle it.
                // For this environment, we might fallback to a text-based analysis if image fails?
                // Or just throw.
                throw new Error(data.error?.message || 'Vision API Failed');
            }

            const content = data.choices[0].message.content;
            // Clean markdown code blocks if present
            const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const attributes = JSON.parse(cleanJson);
            
            RemoteLogger.log('VISION', 'Analysis complete', { attributes });
            return attributes;

        } catch (error: any) {
            RemoteLogger.error('VISION', 'Analysis Error', error);
            throw error;
        }
    }
};
