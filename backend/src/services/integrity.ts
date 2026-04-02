import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || '';

export interface IntegrityCheckResult {
  isValid: boolean;
  cleanedText?: string;
  issues: string[];
}

export const IntegrityService = {
  hasPlaceholders(text: string): boolean {
    const placeholderPatterns = [
      /lorem ipsum/i,
      /placehold\.co/i,
      /example\.com/i,
      /\[.*?\]/,
      /undefined/i,
      /null/i,
      /todo/i,
      /insert .* here/i
    ];
    return placeholderPatterns.some(pattern => pattern.test(text));
  },

  async validateAndFixContent(text: string): Promise<IntegrityCheckResult> {
    if (this.hasPlaceholders(text)) {
      return { isValid: false, issues: ['Disallowed patterns detected'], cleanedText: undefined };
    }

    if (!OPENAI_API_KEY || !OPENAI_TEXT_MODEL) {
      throw new Error('IntegrityService requires OPENAI_API_KEY and OPENAI_TEXT_MODEL.');
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_TEXT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are AdRoom's Intelligent Spell Correction & Context Engine. Correct spelling/grammar errors but preserve brand context. Output JSON { "isValid": boolean, "cleanedText": "...", "issues": [] }.`
            },
            { role: "user", content: text }
          ],
          response_format: { type: "json_object" }
        })
      });

      const data: any = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

      return {
        isValid: result.isValid,
        cleanedText: result.cleanedText || text,
        issues: result.issues || []
      };
    } catch (error) {
      console.error('Integrity Service Error:', error);
      throw error;
    }
  }
};
