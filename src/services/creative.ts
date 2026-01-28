// OpenAI Client Configuration
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

import { IntegrityService } from './integrity';

export const CreativeService = {
  /**
   * Generates a graphic design or reimagined product image using DALL-E 3 (OpenAI).
   * Replaces the mock placeholder service with real AI generation.
   */
  async generateCreative(baseImageUri: string, prompt: string, style: string): Promise<string> {
    console.log(`[CreativeService] Generating image with prompt: "${prompt}" in style: "${style}"`);
    
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API Key missing. Falling back to placeholder.');
      // Fallback only if key is missing (dev mode safety)
      const uniqueId = Math.random().toString(36).substring(7);
      return `https://placehold.co/1080x1080/1e40af/ffffff.png?text=${encodeURIComponent(style + ' Creative')}&id=${uniqueId}`;
    }

    try {
      // 1. Construct the prompt
      const fullPrompt = `Professional advertisement image for a product. Style: ${style}. Context: ${prompt}. High quality, photorealistic, commercial photography.`;

      // 2. Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: fullPrompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          response_format: "url"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate image');
      }

      return data.data[0].url;

    } catch (error) {
      console.error('Creative generation error:', error);
      // Fallback on error to ensure app continuity
      const uniqueId = Math.random().toString(36).substring(7);
      return `https://placehold.co/1080x1080/b91c1c/ffffff.png?text=Generation+Failed&id=${uniqueId}`;
    }
  },

  /**
   * Generates catchy, human-like copy using GPT-4o (OpenAI).
   * NOW INTEGRATED WITH INTEGRITY CHECKS.
   */
  async generateCopy(productName: string, tone: string, purpose: string): Promise<{ headline: string, body: string }> {
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API Key missing. Falling back to template.');
      return {
         headline: `Experience ${productName}`,
         body: `The best choice for your needs. Try ${productName} today.`
      };
    }

    try {
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
              content: `You are a world-class copywriter. Write a catchy Facebook Ad headline (max 40 chars) and primary text (max 125 chars). Tone: ${tone}. Purpose: ${purpose}. Return JSON: { "headline": "...", "body": "..." }`
            },
            {
              role: "user",
              content: `Product: ${productName}`
            }
          ],
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate copy');
      }

      const result = JSON.parse(data.choices[0].message.content);

      // INTEGRITY CHECK: Validate generated text before returning
      const headlineCheck = await IntegrityService.validateAndFixContent(result.headline);
      const bodyCheck = await IntegrityService.validateAndFixContent(result.body);

      // Use cleaned text if valid, otherwise fallback or keep original if issues weren't critical
      // (validateAndFixContent returns original if it can't fix, so this is safe)
      return {
        headline: headlineCheck.cleanedText || result.headline,
        body: bodyCheck.cleanedText || result.body
      };

    } catch (error) {
      console.error('Copy generation error:', error);
      return {
        headline: `${productName} - Check it out`,
        body: `Discover the features of ${productName} now. Available for a limited time.`
      };
    }
  }
};
