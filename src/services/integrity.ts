const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

export interface IntegrityCheckResult {
  isValid: boolean;
  cleanedText?: string;
  issues: string[];
}

export const IntegrityService = {
  /**
   * Checks for placeholder text, generic fillers, and common "lorem ipsum" patterns.
   * Returns true if the text seems legitimate.
   */
  hasPlaceholders(text: string): boolean {
    const placeholderPatterns = [
      /lorem ipsum/i,
      /placehold\.co/i,
      /example\.com/i,
      /\[.*?\]/, // matches [insert name here]
      /undefined/i,
      /null/i,
      /todo/i,
      /insert .* here/i
    ];

    return placeholderPatterns.some(pattern => pattern.test(text));
  },

  /**
   * Uses AI to validate and fix spelling/grammar/placeholders.
   * This ensures "Realtime Content Integrity" before anything is shown or posted.
   * Now includes stronger Proofreading & Auto-correction capabilities.
   */
  async validateAndFixContent(text: string): Promise<IntegrityCheckResult> {
    // 1. Basic Placeholder Check (Fast Fail)
    if (this.hasPlaceholders(text)) {
      return {
        isValid: false,
        issues: ['Contains placeholder patterns'],
        cleanedText: undefined // Needs AI to regenerate or fix
      };
    }

    if (!OPENAI_API_KEY) {
      // Fallback if no AI available: return valid if no regex patterns found
      return { isValid: true, issues: [], cleanedText: text };
    }

    try {
      // 2. Deep Integrity Check & Proofreading via LLM
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
<<<<<<< HEAD
              content: `You are AdRoom's Content Integrity & Proofreading Engine. 
              Your job is to strictly analyze the user's input or generated content.
              
              Tasks:
              1. Correct ALL spelling and typo errors automatically.
              2. Fix grammar issues.
              3. Check for placeholders (e.g., "Insert name") - these are invalid.
              4. Ensure professional tone.
=======
              content: `You are AdRoom's Intelligent Spell Correction & Context Engine. 
              Your job is to strictly analyze the user's input for spelling and grammar errors.
              
              Rules:
              1. Correct ALL spelling and typo errors automatically.
              2. Fix grammar issues.
              3. Check for placeholders (e.g., "Insert name") - these are invalid.
              4. PRESERVE brand names, product terms, and stylized text (e.g. "iPhone", "WhatsApp", "AdRoom").
              5. Maintain context awareness. Do not change the meaning.
>>>>>>> adroom-mobile

              If VALID (after auto-correction): Return JSON { "isValid": true, "cleanedText": "..." (The corrected version) }
              If INVALID/IRREPARABLE (e.g. placeholders): Return JSON { "isValid": false, "issues": ["..."] }`
            },
            {
              role: "user",
              content: text
            }
          ],
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

      return {
        isValid: result.isValid,
        cleanedText: result.cleanedText || text,
        issues: result.issues || []
      };

    } catch (error) {
      console.error('[IntegrityService] Validation failed:', error);
      // Fail open (assume valid) or closed? 
      // For integrity, it's safer to return valid if regex passed, to avoid blocking on API errors
      return { isValid: true, issues: [], cleanedText: text };
    }
  }
};
