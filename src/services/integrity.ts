const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

export interface IntegrityCheckResult {
  isValid: boolean;
  cleanedText?: string;
  issues: string[];
}

function parseJsonObject(content: unknown): Record<string, any> | null {
  if (!content || typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const extracted = fenced ? fenced[1] : trimmed;

  try {
    const parsed = JSON.parse(extracted);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    try {
      const jsonStart = extracted.indexOf('{');
      const jsonEnd = extracted.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const inner = extracted.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(inner);
        return parsed && typeof parsed === 'object' ? parsed : null;
      }
    } catch {
      return null;
    }
    return null;
  }
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
    const normalizedText = typeof text === 'string' ? text : String(text ?? '');

    // 1. Basic Placeholder Check (Fast Fail)
    if (this.hasPlaceholders(normalizedText)) {
      return {
        isValid: false,
        issues: ['Contains placeholder patterns'],
        cleanedText: undefined,
      };
    }

    if (!normalizedText.trim()) {
      return {
        isValid: false,
        issues: ['Input is empty'],
        cleanedText: undefined,
      };
    }

    // Keep the feature safe in test environments and when no API key is configured.
    if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
      return { isValid: true, issues: [], cleanedText: normalizedText };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      // 2. Deep Integrity Check & Proofreading via LLM
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are AdRoom's Intelligent Spell Correction & Context Engine.
              Your job is to strictly analyze the user's input for spelling and grammar errors.

              Rules:
              1. Correct ALL spelling and typo errors automatically.
              2. Fix grammar issues.
              3. Check for placeholders (e.g., "Insert name") - these are invalid.
              4. PRESERVE brand names, product terms, and stylized text (e.g. "iPhone", "WhatsApp", "AdRoom").
              5. Maintain context awareness. Do not change the meaning.

              If VALID (after auto-correction): Return JSON { "isValid": true, "cleanedText": "..." }
              If INVALID/IRREPARABLE (e.g. placeholders): Return JSON { "isValid": false, "issues": ["..."] }`
            },
            {
              role: 'user',
              content: normalizedText,
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI integrity check failed with status ${response.status}`);
      }

      const data = await response.json();
      const payload = parseJsonObject(data?.choices?.[0]?.message?.content);

      if (!payload) {
        return { isValid: true, issues: [], cleanedText: normalizedText };
      }

      return {
        isValid: payload.isValid === undefined ? true : Boolean(payload.isValid),
        cleanedText: typeof payload.cleanedText === 'string' ? payload.cleanedText : normalizedText,
        issues: Array.isArray(payload.issues) ? payload.issues.map(String) : [],
      };
    } catch (error) {
      console.warn('[IntegrityService] Validation failed; falling back to safe pass-through.', error);
      // Fail open for temporary AI/service issues so the app keeps working and does not block legitimate flows.
      return { isValid: true, issues: [], cleanedText: normalizedText };
    } finally {
      clearTimeout(timeout);
    }
  },
};
