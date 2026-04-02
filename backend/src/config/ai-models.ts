
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const GEMINI_FLASH_MODEL = 'gemini-1.5-flash';
const GEMINI_PRO_VISION_MODEL = 'gemini-1.5-pro';
const OPENAI_STRATEGY_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o';

function aiLog(engine: string, action: string, detail?: any) {
  const ts = new Date().toISOString();
  const base = `[AI:${engine}] [${ts}] ${action}`;
  if (detail) {
    console.log(base, typeof detail === 'object' ? JSON.stringify(detail).substring(0, 300) : detail);
  } else {
    console.log(base);
  }
}

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
   * Gemini 1.5 Pro Vision (Nano Banana) — Image Analysis
   */
  async analyzeImage(imageBase64: string, prompt: string): Promise<AIResponse> {
    aiLog('GEMINI-VISION', `analyzeImage START — model: ${GEMINI_PRO_VISION_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_PRO_VISION_MODEL });
      
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg',
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      let parsedJson;
      try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          parsedJson = JSON.parse(jsonMatch[1]);
        } else {
          parsedJson = JSON.parse(text);
        }
      } catch (_e) {
        console.warn('[AI:GEMINI-VISION] Could not parse JSON from response, returning raw text');
      }

      aiLog('GEMINI-VISION', 'analyzeImage SUCCESS', { textLength: text.length, hasParsedJson: !!parsedJson });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GEMINI-VISION', 'analyzeImage ERROR', error.message);
      throw new Error(`Gemini Vision Analysis Failed: ${error.message}`);
    }
  }

  /**
   * GPT-4o — Complex reasoning and strategy generation (JSON mode)
   */
  async generateStrategy(context: any, prompt: string): Promise<AIResponse> {
    aiLog('GPT-4o', `generateStrategy START — model: ${OPENAI_STRATEGY_MODEL}`);
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are the AdRoom AI Core Brain. You are an expert marketing strategist capable of generating comprehensive, data-driven marketing strategies. Always return valid JSON.',
          },
          {
            role: 'user',
            content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}`,
          },
        ],
        model: OPENAI_STRATEGY_MODEL,
        response_format: { type: 'json_object' },
      });

      const text = completion.choices[0].message.content || '';
      let parsedJson;
      try {
        parsedJson = JSON.parse(text);
      } catch (_e) {
        console.warn('[AI:GPT-4o] Could not parse JSON from OpenAI response');
      }

      aiLog('GPT-4o', 'generateStrategy SUCCESS', {
        model: OPENAI_STRATEGY_MODEL,
        tokens: completion.usage?.total_tokens,
        hasParsedJson: !!parsedJson,
      });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GPT-4o', 'generateStrategy ERROR', error.message);
      throw new Error(`OpenAI Strategy Generation Failed: ${error.message}`);
    }
  }

  /**
   * Gemini 1.5 Flash — Fast text generation for reports/alerts
   */
  async generateText(prompt: string): Promise<string> {
    aiLog('GEMINI-FLASH', `generateText START — model: ${GEMINI_FLASH_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      aiLog('GEMINI-FLASH', 'generateText SUCCESS', { textLength: text.length });
      return text;
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateText ERROR', error.message);
      throw new Error(`Gemini Text Generation Failed: ${error.message}`);
    }
  }

  /**
   * Generate image using Google Imagen 3 (Nano Banana) via Gemini API
   */
  async generateImage(imagePrompt: string): Promise<{ base64: string; mimeType: string } | null> {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    aiLog('GEMINI-IMAGEN', `generateImage START — prompt: ${imagePrompt.substring(0, 80)}...`);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: imagePrompt }],
            parameters: { sampleCount: 1, aspectRatio: '1:1' },
          }),
        }
      );

      if (!response.ok) {
        const errData: any = await response.json();
        throw new Error(errData?.error?.message || `Imagen API Error: ${response.status}`);
      }

      const data: any = await response.json();
      const base64 = data?.predictions?.[0]?.bytesBase64Encoded;
      const mimeType = data?.predictions?.[0]?.mimeType || 'image/png';

      if (!base64) throw new Error('No image data in Imagen response');

      aiLog('GEMINI-IMAGEN', 'generateImage SUCCESS');
      return { base64, mimeType };
    } catch (error: any) {
      aiLog('GEMINI-IMAGEN', 'generateImage ERROR', error.message);
      return null;
    }
  }
}
