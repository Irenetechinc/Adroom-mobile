import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export interface IntegrityCheckResult {
  isValid: boolean;
  cleanedText?: string;
  issues: string[];
}

export const IntegrityService = {
  /**
   * Fast placeholder check
   */
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

  /**
   * Deep integrity check & proofreading via OpenAI
   */
  async validateAndFixContent(text: string): Promise<IntegrityCheckResult> {
    if (this.hasPlaceholders(text)) {
      return { isValid: false, issues: ['Contains placeholder patterns'], cleanedText: undefined };
    }

    if (!OPENAI_API_KEY) {
      return { isValid: true, issues: [], cleanedText: text };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5.2",
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
      return { isValid: true, issues: [], cleanedText: text };
    }
  }
};
