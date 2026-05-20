/**
 * APMA Humanizer Layer
 * - Maintains 100+ persona profiles in DB
 * - Rewrites AI-generated content to be indistinguishable from human
 * - Adds intentional typos, local Nigerian slang, variable timing
 * - Generates unique images/videos via existing CreativeService
 * - Rotates personas per action to avoid pattern detection
 */

import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaCycleLog } from './apmaCycleLogger';

const supabase = () => getServiceSupabaseClient();

const NIGERIAN_SLANG = [
  'Omo', 'Sha', 'Abeg', 'Wahala', 'Sabi', 'Ginger', 'Chop', 'E don happen',
  'Na so', 'How far', 'Guy', 'Bros', 'Jollof', 'Carry go', 'E be like',
  'Na lie', 'Sharp sharp', 'Dem say', 'No vex', 'E don red', 'Abi',
  'Nawa o', 'Ehen', 'Ehn', 'Chai', 'Haba', 'You dey joke', 'E go better',
];

const WRITING_STYLES = {
  formal: 'Write in formal, educated Nigerian English. Use complete sentences. No slang.',
  casual: 'Write in casual Nigerian English. Mix standard English with light Nigerian expressions.',
  pidgin: 'Write in Nigerian Pidgin English (Naija). Use slang like "omo", "sha", "abeg", etc.',
  academic: 'Write in academic, policy-focused language. Reference statistics and governance.',
};

export class ApmaHumanizerService {
  private ai = AIEngine.getInstance();

  // ── Select a persona for a given action ───────────────────────────────────
  async selectPersona(clientId: string, platform: string, style?: string): Promise<any> {
    const { data: personas } = await supabase()
      .from('apma_personas')
      .select('*')
      .eq('client_id', clientId)
      .eq('active', true)
      .contains('platform_affinities', [platform])
      .order('last_used_at', { ascending: true })
      .limit(20);

    if (!personas || personas.length === 0) {
      return await this.generatePersona(clientId, platform, style);
    }

    // Pick least-recently-used that matches style
    const styleFiltered = style
      ? personas.filter(p => p.writing_style === style)
      : personas;
    const pool = styleFiltered.length > 0 ? styleFiltered : personas;

    // Random from top-5 least-recently-used to add unpredictability
    const persona = pool[Math.floor(Math.random() * Math.min(5, pool.length))];

    // Update last_used_at
    await supabase()
      .from('apma_personas')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', persona.id);

    return persona;
  }

  // ── Generate a new AI persona ─────────────────────────────────────────────
  async generatePersona(clientId: string, platform: string, style?: string): Promise<any> {
    const prompt = `Generate a realistic Nigerian social media persona for political engagement on ${platform}.
Return a JSON object with:
{
  "name": "Full Nigerian name",
  "age": <25-55>,
  "gender": "male|female",
  "location": "Nigerian city",
  "occupation": "realistic Nigerian job",
  "writing_style": "${style ?? this.randomStyle()}",
  "emoji_usage": "heavy|moderate|none",
  "local_slang": ["up to 5 Nigerian slang words this person uses"],
  "typo_rate": <0.02-0.08>,
  "bio_headline": "Short Twitter/social bio for this person"
}
Make it very realistic and demographically diverse. Return ONLY JSON.`;

    let personaData: any = {
      name: 'Chukwuemeka Obi',
      age: 32,
      gender: 'male',
      location: 'Abuja',
      occupation: 'Civil servant',
      writing_style: style ?? 'casual',
      emoji_usage: 'moderate',
      local_slang: ['Omo', 'Sha'],
      typo_rate: 0.04,
    };

    try {
      const res = await this.ai.generateText(prompt, 'gemini-flash');
      personaData = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    } catch {}

    const { data: saved } = await supabase()
      .from('apma_personas')
      .insert({
        client_id: clientId,
        ...personaData,
        platform_affinities: [platform],
        active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    return saved ?? personaData;
  }

  // ── Ensure 100+ personas exist for a client ───────────────────────────────
  async ensurePersonaPool(clientId: string): Promise<void> {
    const { count } = await supabase()
      .from('apma_personas')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('active', true);

    const needed = 100 - (count ?? 0);
    if (needed <= 0) return;

    const platforms = ['twitter', 'facebook', 'reddit', 'nairaland', 'telegram', 'instagram'];
    const styles = ['formal', 'casual', 'pidgin', 'academic'];

    const promises = [];
    for (let i = 0; i < needed; i++) {
      const platform = platforms[i % platforms.length];
      const style = styles[i % styles.length];
      promises.push(this.generatePersona(clientId, platform, style));
      if (promises.length >= 10) {
        await Promise.allSettled(promises.splice(0, 10));
      }
    }
    if (promises.length > 0) await Promise.allSettled(promises);
  }

  // ── Humanize text content ─────────────────────────────────────────────────
  async humanizeText(
    rawText: string,
    persona: any,
    platform: string,
    clientId: string,
    userId: string,
  ): Promise<string> {
    const start = Date.now();
    await apmaCycleLog(clientId, userId, 'humanizer', 'humanize_text', 'running', { platform });

    const styleGuide = WRITING_STYLES[persona.writing_style as keyof typeof WRITING_STYLES]
      ?? WRITING_STYLES.casual;

    const slang = (persona.local_slang ?? []).concat(NIGERIAN_SLANG.slice(0, 3)).join(', ');

    const prompt = `You are rewriting political content to sound like it was written by a real Nigerian person on social media.

PERSONA:
- Name: ${persona.name}, Age: ${persona.age}, Location: ${persona.location}
- Occupation: ${persona.occupation}
- Style: ${styleGuide}
- Preferred slang: ${slang}
- Emoji usage: ${persona.emoji_usage}
- Platform: ${platform}

ORIGINAL CONTENT:
${rawText}

RULES:
1. Maintain the core message and political intent
2. Sound 100% human — no AI patterns, no perfect grammar
3. Vary sentence length naturally (some short, some long)
4. Add 1-2 local expressions naturally where they fit
5. For ${platform}: adapt length and tone for that platform
6. Add ${persona.typo_rate > 0.05 ? 'a few intentional typos (but keep readable)' : 'minimal intentional imperfections'}
7. NEVER mention AI, marketing, or campaigns explicitly
8. Do NOT use hashtags unless it's Twitter/Instagram

Return ONLY the humanized text. No explanation.`;

    try {
      const res = await this.ai.generateText(prompt, 'gemini-flash');
      const humanized = res.text.trim();
      await apmaCycleLog(clientId, userId, 'humanizer', 'humanize_text', 'success', {}, Date.now() - start);
      return humanized;
    } catch {
      await apmaCycleLog(clientId, userId, 'humanizer', 'humanize_text', 'error', {}, Date.now() - start);
      return rawText;
    }
  }

  // ── Compute randomized posting delay ─────────────────────────────────────
  getRandomDelay(baseMinutes: number): number {
    // Add random jitter: ±30% of base, minimum 2 minutes
    const jitter = (Math.random() - 0.5) * 0.6 * baseMinutes;
    return Math.max(2, Math.round(baseMinutes + jitter)) * 60 * 1000; // ms
  }

  // ── Random response time (2-45 minutes for replies) ──────────────────────
  getReplyDelay(): number {
    const minutes = 2 + Math.random() * 43;
    return Math.round(minutes) * 60 * 1000;
  }

  private randomStyle(): string {
    const styles = ['formal', 'casual', 'pidgin', 'academic'];
    return styles[Math.floor(Math.random() * styles.length)];
  }
}

export const apmaHumanizer = new ApmaHumanizerService();
