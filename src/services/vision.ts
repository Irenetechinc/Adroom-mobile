
import { RemoteLogger } from './remoteLogger';
import { readAsStringAsync } from 'expo-file-system';
import { supabase } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

export interface VisualAttributes {
    name: string;
    description: string;
    dimensions: string; // e.g. "10x5x2 inches"
    colorPalette: string[];
    estimatedPrice: string;
    // Add other fields returned by Gemini
    brand?: string;
    category?: string;
    product_type?: string;
    material?: string;
    condition?: string;
    suggested_target_audience?: string;
    features?: string[];
}

export const VisionService = {
    /**
     * Analyzes an image using the AdRoom AI Brain (Gemini 2.5 Pro via Supabase Edge Function).
     */
    async analyzeProductImage(imageUri: string): Promise<VisualAttributes> {
        RemoteLogger.log('VISION', `Starting analysis for image: ${imageUri}`);
        
        try {
            // Convert image to base64 if needed
            let base64Image = imageUri;
            
            // Check if it's a local file URI
            if (imageUri.startsWith('file://') || imageUri.startsWith('/')) {
                 try {
                    base64Image = await readAsStringAsync(imageUri, {
                        encoding: 'base64',
                    });
                    // Format for the edge function (it expects raw base64 usually, but let's check our function)
                    // Our function: const imagePart = { inlineData: { data: imageBase64, mimeType: "image/jpeg" } };
                    // So we just send the base64 string.
                } catch (readError) {
                   console.error('Failed to read local image file:', readError);
                   throw new Error('Could not read local image file for analysis.');
                }
            } else if (imageUri.startsWith('data:image')) {
                // Strip the data:image/jpeg;base64, prefix if present
                base64Image = imageUri.split(',')[1];
            }

            if (!BACKEND_URL) {
                throw new Error('Backend URL is not configured');
            }

            const {
                data: { session },
            } = await supabase.auth.getSession();

            const accessToken = session?.access_token;
            if (!accessToken) {
                throw new Error('User not authenticated');
            }

            const response = await fetch(`${BACKEND_URL}/api/ai/scan-product`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    imageBase64: base64Image,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('AI Brain Error:', data);
                throw new Error(data.error || 'AI Brain Scan Failed');
            }
            
            RemoteLogger.log('VISION', 'Analysis complete', { attributes: data });
            
            // Map the AI response to our VisualAttributes interface
            // The AI returns snake_case mostly, we might need to map or just use it as is if we update the interface
            return {
                name: data.product_name || data.name || 'Unknown Product',
                description: data.description || '',
                dimensions: data.estimated_size || data.dimensions || '',
                colorPalette: data.color ? [data.color] : [], // AI returns string or array? Prompt says "color (primary and secondary)"
                estimatedPrice: data.suggested_price_range || data.estimatedPrice || '',
                brand: data.brand,
                category: data.category,
                product_type: data.product_type,
                material: data.material,
                condition: data.condition,
                suggested_target_audience: data.suggested_target_audience,
                features: data.visible_features
            };

        } catch (error: any) {
            RemoteLogger.error('VISION', 'Analysis Error', error);
            throw error;
        }
    }
};
