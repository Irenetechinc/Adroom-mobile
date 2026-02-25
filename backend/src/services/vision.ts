import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export const VisionService = {
  /**
   * Analyzes an image using Gemini 1.5 Pro/Flash
   */
  async analyzeProductImage(imageUri: string) {
    if (!GEMINI_API_KEY) throw new Error("Vision Service requires GEMINI_API_KEY");

    console.log(`[Vision] Analyzing image: ${imageUri.substring(0, 50)}...`);

    try {
      // 1. Prepare Base64 Data
      let base64Data = imageUri;
      if (imageUri.includes(',')) {
          base64Data = imageUri.split(',')[1];
      }

      const prompt = `
        You are AdRoom's Intelligent Vision Scanner. Analyze this product image and extract attributes.
        Return ONLY a JSON object with these fields:
        {
          "name": "Professional Product Name",
          "category": "Main Category",
          "description": "Engaging marketing description (2 sentences)",
          "estimatedPrice": "Suggested price in USD (numeric string)",
          "suggested_target_audience": "Target demographic details",
          "color_palette": ["hex codes"],
          "confidence_score": 0-100
        }
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }]
        })
      });

      if (!response.ok) {
          const err = await response.json();
          throw new Error(`Gemini Vision API Error: ${JSON.stringify(err)}`);
      }

      const data: any = await response.json();
      const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!textResult) throw new Error("No analysis returned from Gemini");

      // Clean markdown if present
      const jsonStr = textResult.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonStr);

    } catch (error: any) {
      console.error('[Vision] Analysis Error:', error);
      throw error;
    }
  }
};
