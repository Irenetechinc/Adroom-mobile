
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai';
import OpenAI from 'https://esm.sh/openai';

// Initialize clients
// Note: In production, ensure these ENV variables are set in Supabase dashboard
const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY') || '',
});

export interface AIResponse {
  text: string;
  parsedJson?: any;
}

export class AIEngine {
  private static instance: AIEngine;
  
  private constructor() {}
  
  public static getInstance(): AIEngine {
    if (!AIEngine.instance) {
      AIEngine.instance = new AIEngine();
    }
    return AIEngine.instance;
  }

  /**
   * Use Gemini 2.5 Pro (Nano Banana Vision) for Vision tasks (Image Analysis)
   */
  async analyzeImage(imageBase64: string, prompt: string): Promise<AIResponse> {
    try {
      // Use the latest vision-capable model available via the SDK
      // "gemini-1.5-pro-latest" is often the best current alias for advanced vision tasks including 2.5 features
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
      
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      let parsedJson;
      try {
        // Extract JSON from markdown code block if present
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            parsedJson = JSON.parse(jsonMatch[1]);
        } else {
            // Attempt to parse raw text if it's just JSON
            parsedJson = JSON.parse(text);
        }
      } catch (e) {
        console.warn("Could not parse JSON from Gemini response", e);
        // Do not throw, return raw text as fallback
      }

      return { text, parsedJson };
    } catch (error) {
      console.error("Gemini Vision Error:", error);
      throw new Error(`Gemini Vision Analysis Failed: ${error.message}`);
    }
  }

  /**
   * Use GPT-5 (or latest available) for complex reasoning and strategy generation
   */
  async generateStrategy(context: any, prompt: string): Promise<AIResponse> {
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: "You are the AdRoom AI Core Brain. You are an expert marketing strategist capable of generating comprehensive, data-driven marketing strategies." },
          { role: "user", content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` }
        ],
        model: "gpt-4o", // Use GPT-4o for best reasoning/speed balance
        response_format: { type: "json_object" },
      });

      const text = completion.choices[0].message.content || "";
      let parsedJson;
      try {
        parsedJson = JSON.parse(text);
      } catch (e) {
        console.warn("Could not parse JSON from OpenAI response", e);
      }

      return { text, parsedJson };
    } catch (error) {
      console.error("OpenAI Strategy Error:", error);
      throw new Error(`OpenAI Strategy Generation Failed: ${error.message}`);
    }
  }

  /**
   * Use Gemini Pro for general text tasks if GPT is unavailable or for cost efficiency
   */
  async generateText(prompt: string): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error("Gemini Text Error:", error);
      throw new Error(`Gemini Text Generation Failed: ${error.message}`);
    }
  }
}
