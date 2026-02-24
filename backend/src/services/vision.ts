import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export const VisionService = {
  /**
   * Analyzes an image using Gemini 1.5 Pro/Flash
   */
  async analyzeImage(imageUri: string, prompt: string) {
    if (!GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY missing, skipping vision analysis');
      return null;
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: imageUri.split(',')[1] || imageUri } }
            ]
          }]
        })
      });

      const data: any = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
      return null;
    } catch (error) {
      console.error('Vision Analysis Error:', error);
      return null;
    }
  }
};
