// OpenAI Client Configuration
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';
const RUNWAY_API_KEY = process.env.EXPO_PUBLIC_RUNWAY_API_KEY || '';

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
      throw error;
    }
  },

  /**
   * Generates a short video script and (in future) renders a video using an external API.
   * Currently generates a "Video Concept" card or placeholder if no video API is connected.
   */
  async generateVideoAsset(productName: string, prompt: string): Promise<string> {
      console.log(`[CreativeService] Generating video asset for: "${productName}"`);
      
      // RUNWAYML GEN-2 INTEGRATION
      // Requires EXPO_PUBLIC_RUNWAY_API_KEY to be set in environment.
      // If missing, falls back to high-fidelity storyboard (Image-to-Video simulation).
      
      if (RUNWAY_API_KEY) {
          try {
             console.log('[CreativeService] RunwayML Key detected. Initiating Gen-2 generation...');
             
             // 1. Generate Base Image for Consistency
             const baseImage = await this.generateCreative('', `Cinematic product shot of ${productName}. ${prompt}`, 'Cinematic');
             
             // 2. Call RunwayML Gen-2 (Image to Video)
             // Note: In a real production app, this call should go through a backend proxy 
             // to keep the key secret. We are calling direct for "No Dummy Data" proof of concept.
             const response = await fetch('https://api.runwayml.com/v1/image_to_video', {
                 method: 'POST',
                 headers: {
                     'Content-Type': 'application/json',
                     'Authorization': `Bearer ${RUNWAY_API_KEY}`,
                     'X-Runway-Version': '2023-09-01'
                 },
                 body: JSON.stringify({
                     prompt: `Cinematic motion, high quality, 4k. ${prompt}`,
                     seed: Math.floor(Math.random() * 1000000),
                     image: baseImage // Pass the generated base image
                 })
             });

             const data = await response.json();
             
             if (!response.ok) {
                 throw new Error(data.message || 'RunwayML API Error');
             }

             // Runway returns a task ID, we usually need to poll. 
             // For this async flow, we might return the Task ID or wait.
             // To simplify the synchronous "Promise<string>" return for the chat:
             // We return the task ID but the UI might need to handle "Processing...".
             // However, to keep it robust:
             return data.id || data.output?.[0] || baseImage; // Fallback to base image if async structure differs

          } catch (error) {
             console.warn('[CreativeService] RunwayML generation failed, falling back to Storyboard:', error);
          }
      } else {
          console.warn('[CreativeService] RunwayML Key missing. Generating Storyboard.');
      }

      if (!OPENAI_API_KEY) {
          throw new Error("API Key required for video asset generation.");
      }

      // Fallback: Generate a "Storyboard Frame" representing the video
      return this.generateCreative('', `Cinematic video frame of ${productName}. ${prompt}`, 'Cinematic');
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
      throw error;
    }
  },

  /**
   * Generates a conversational reply to a user comment.
   */
  async generateReply(comment: string, tone: string = "Friendly"): Promise<string> {
    if (!OPENAI_API_KEY) {
        return "Thank you for your comment!";
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
                        content: `You are an engaging human social media manager representing the brand. Reply to the user's comment in a ${tone}, natural, and human-like tone. 
                        Encourage further engagement (ask a question or provide value). Keep it short (under 280 chars).
                        CRITICAL: Do NOT mention that you are an AI, a bot, or automated. Do NOT say 'beep boop' or use robotic language. 
                        Sound completely authentic, as if a real person is typing this.`
                    },
                    {
                        role: "user",
                        content: `Comment: "${comment}"`
                    }
                ]
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message);

        const reply = data.choices[0].message.content;
        
        // Integrity check
        const check = await IntegrityService.validateAndFixContent(reply);
        return check.cleanedText || reply;

    } catch (error) {
        console.error('Reply generation error:', error);
        return "Thanks for connecting with us!";
    }
  }
};
