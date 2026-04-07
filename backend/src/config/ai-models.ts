import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const GEMINI_FLASH_MODEL = 'gemini-2.0-flash';
const GEMINI_VISION_MODEL = 'gemini-2.0-flash';
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

  async analyzeImage(imageBase64: string, prompt: string): Promise<AIResponse> {
    aiLog('GEMINI-VISION', `analyzeImage START — model: ${GEMINI_VISION_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_VISION_MODEL });
      
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg' as const,
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      let parsedJson;
      try {
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch && jsonMatch[1]) {
          parsedJson = JSON.parse(jsonMatch[1]);
        } else {
          const cleaned = text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '');
          parsedJson = JSON.parse(cleaned);
        }
      } catch (_e) {
        console.warn('[AI:GEMINI-VISION] Could not parse JSON, returning raw text');
      }

      aiLog('GEMINI-VISION', 'analyzeImage SUCCESS', { textLength: text.length, hasParsedJson: !!parsedJson });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GEMINI-VISION', 'analyzeImage ERROR', error.message);
      throw new Error(`Gemini Vision Analysis Failed: ${error.message}`);
    }
  }

  async generateStrategy(context: any, prompt: string): Promise<AIResponse> {
    aiLog('GPT-4o', `generateStrategy START — model: ${OPENAI_STRATEGY_MODEL}`);
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are AdRoom AI Core Brain — a world-class marketing strategist. Always respond with valid JSON only, no markdown, no code blocks.',
          },
          {
            role: 'user',
            content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}`,
          },
        ],
        model: OPENAI_STRATEGY_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const text = completion.choices[0].message.content || '';
      let parsedJson;
      try {
        parsedJson = JSON.parse(text);
      } catch (_e) {
        console.warn('[AI:GPT-4o] Could not parse JSON from response');
      }

      aiLog('GPT-4o', 'generateStrategy SUCCESS', { textLength: text.length });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GPT-4o', 'generateStrategy ERROR', error.message);
      throw new Error(`OpenAI Strategy Generation Failed: ${error.message}`);
    }
  }

  /**
   * Economy strategy generation using Gemini Flash.
   * Used by the Credit Management Agent for non-Pro users.
   * Produces the same JSON structure as generateStrategy.
   */
  async generateStrategyEconomy(context: any, prompt: string): Promise<AIResponse> {
    aiLog('GEMINI-FLASH', `generateStrategyEconomy START (economy routing)`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const fullPrompt = [
        'You are AdRoom AI Core Brain — a world-class marketing strategist.',
        'Return ONLY valid JSON, no markdown, no code blocks.',
        `Context: ${JSON.stringify(context)}`,
        `Task: ${prompt}`,
      ].join('\n\n');
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const raw = response.text().trim();
      const jsonMatch = raw.match(/```json?\s*([\s\S]*?)\s*```/);
      const text = jsonMatch ? jsonMatch[1] : raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '');
      let parsedJson;
      try { parsedJson = JSON.parse(text); } catch (_e) {}
      aiLog('GEMINI-FLASH', 'generateStrategyEconomy SUCCESS', { textLength: text.length });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateStrategyEconomy ERROR', error.message);
      throw new Error(`Gemini Economy Strategy Failed: ${error.message}`);
    }
  }

  async generateJson(prompt: string): Promise<any> {
    aiLog('GEMINI-FLASH', `generateJson START — model: ${GEMINI_FLASH_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(
        `Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}`
      );
      const response = await result.response;
      const text = response.text().trim();
      aiLog('GEMINI-FLASH', 'generateJson SUCCESS', { textLength: text.length });
      const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/);
      const cleaned = jsonMatch ? jsonMatch[1] : text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '');
      return JSON.parse(cleaned);
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateJson ERROR', error.message);
      return null;
    }
  }

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
