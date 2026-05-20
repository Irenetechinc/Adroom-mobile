import { getServiceSupabaseClient } from '../config/supabase';
import { apmaGeoService } from './apmaGeoService';
import type { APMAPersona, HumanizedContent } from './apmaTypes';

const DELAY_PROFILES = {
  quick:  { min: 2 * 60_000,   max: 15 * 60_000  },
  normal: { min: 20 * 60_000,  max: 90 * 60_000  },
  slow:   { min: 90 * 60_000,  max: 180 * 60_000 },
};

const TYPO_MAP: Record<string, string> = {
  the: 'teh', and: 'adn', have: 'hve', that: 'taht',
  with: 'wiht', this: 'tihs', very: 'vrey', really: 'realy',
  government: 'governement', election: 'elction', policy: 'polciy',
  democracy: 'democarcy', president: 'presiednt', parliament: 'parlimant',
};

export class APMAHumanizerService {
  private personas: APMAPersona[] = [];
  private personasLoaded = false;

  async loadPersonas(clientId?: string, country?: string): Promise<void> {
    const sb = getServiceSupabaseClient();
    let q = sb.from('apma_personas').select('*').eq('active', true);
    if (clientId) q = q.or(`client_id.eq.${clientId},client_id.is.null`);
    if (country)  q = q.eq('country', country);
    const { data } = await q
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(200);
    this.personas = (data as APMAPersona[]) || [];
    this.personasLoaded = true;
  }

  async pickPersona(platform: string, clientId?: string, country?: string): Promise<APMAPersona | null> {
    if (!this.personasLoaded) await this.loadPersonas(clientId, country);

    let eligible = this.personas.filter(
      (p) => p.platforms.includes(platform) && p.active,
    );

    // If country filtering yields nothing, fall back to any active persona
    if (!eligible.length && country) {
      eligible = this.personas.filter((p) => p.platforms.includes(platform) && p.active);
    }

    if (!eligible.length) return null;

    // Weighted random: less-used personas get higher probability
    const sorted = eligible.sort((a, b) => (a.usage_count ?? 0) - (b.usage_count ?? 0));
    const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)));
    const picked = pool[Math.floor(Math.random() * pool.length)];

    const sb = getServiceSupabaseClient();
    await sb.from('apma_personas').update({
      last_used_at: new Date().toISOString(),
      usage_count: (picked.usage_count ?? 0) + 1,
    }).eq('id', picked.id);

    return picked;
  }

  async humanizeText(rawText: string, persona: APMAPersona): Promise<string> {
    let text = rawText.trim();

    // Get country context for culturally authentic rewriting
    const ctx = await apmaGeoService.getCountryContext(persona.country || 'US');

    // Use AI to culturally localize the text
    text = await apmaGeoService.humanizeForCountry(text, ctx, persona.writing_style);

    // Apply structural humanization (universal)
    text = this._injectTypos(text, 0.2);
    text = this._varyEndings(text);
    text = this._addEmojis(text, persona.emoji_usage);

    // Platform length limits
    if (text.length > 280 && persona.platforms.includes('twitter')) {
      const sentences = text.split(/[.!?]+/).filter(Boolean);
      text = sentences.slice(0, Math.ceil(sentences.length / 2)).join('. ').trim();
      if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) text += '.';
    }

    return text.trim();
  }

  generateDelay(profile: 'quick' | 'normal' | 'slow' = 'normal'): number {
    const { min, max } = DELAY_PROFILES[profile];
    return Math.floor(Math.random() * (max - min) + min);
  }

  async humanizeContent(
    rawText: string,
    platform: string,
    clientId?: string,
    delayProfile: 'quick' | 'normal' | 'slow' = 'normal',
    country?: string,
  ): Promise<HumanizedContent | null> {
    const persona = await this.pickPersona(platform, clientId, country);
    if (!persona) return null;
    return {
      text: await this.humanizeText(rawText, persona),
      persona,
      delay_ms: this.generateDelay(delayProfile),
      platform,
    };
  }

  async seedPersonas(clientId: string, countryCode: string): Promise<number> {
    const sb = getServiceSupabaseClient();

    // Check if personas already exist for this client
    const { count } = await sb
      .from('apma_personas')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId);
    if ((count ?? 0) >= 10) return count ?? 0;

    // Generate country-appropriate personas via AI
    const generated = await apmaGeoService.generatePersonasForCountry(countryCode, 25);
    const toInsert = generated.map((p: any) => ({
      ...p,
      client_id: clientId,
      active: true,
      usage_count: 0,
    }));

    const { data, error } = await sb.from('apma_personas').insert(toInsert).select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  private _injectTypos(text: string, rate: number): string {
    return text.split(' ').map((word) => {
      const lower = word.toLowerCase().replace(/[^a-z]/g, '');
      if (TYPO_MAP[lower] && Math.random() < rate) {
        return word.replace(new RegExp(lower, 'i'), TYPO_MAP[lower]);
      }
      return word;
    }).join(' ');
  }

  private _varyEndings(text: string): string {
    const endings = ['.', '!', '...', '.', '.', ''];
    if (text.endsWith('.') && Math.random() > 0.6) {
      const e = endings[Math.floor(Math.random() * endings.length)];
      return text.slice(0, -1) + e;
    }
    return text;
  }

  private _addEmojis(text: string, level: 'none' | 'low' | 'medium' | 'high'): string {
    const POLITICAL = ['💪', '🔥', '👆', '✊', '🎯', '📣', '🤝', '🌟', '💡', '📢', '⚖️', '🗳️'];
    if (level === 'none') return text;
    const count = level === 'low' ? 1 : level === 'medium' ? 2 : 3;
    const chosen = POLITICAL.sort(() => Math.random() - 0.5).slice(0, count).join(' ');
    return `${text} ${chosen}`;
  }
}

export const apmaHumanizerService = new APMAHumanizerService();
