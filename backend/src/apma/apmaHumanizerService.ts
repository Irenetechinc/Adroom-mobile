import { getServiceSupabaseClient } from '../config/supabase';
import type { APMAPersona, HumanizedContent } from './apmaTypes';

const NIGERIAN_SLANG = [
  'abeg', 'oga', 'wahala', 'e go be', 'na so', 'sabi', 'waka',
  'ginger', 'shele', 'yawa', 'oya', 'comot', 'joor', 'bros',
  'nah', 'dem', 'dis', 'dat', 'e dey', 'no be', 'na im',
];

const FILLER_PHRASES = [
  'honestly speaking', 'to be fair', 'let me be real',
  'if we are being honest', 'as someone who follows politics',
  'from what i have seen', 'no one is talking about this',
  'people need to understand', 'the truth of the matter is',
];

const CASUAL_OPENERS = [
  'Lol', 'Wait', 'Hmm', 'Honestly', 'Ok so', 'Ngl',
  'Tbh', 'Not gonna lie', 'Real talk', 'Actually',
];

const BASE_PERSONAS: Omit<APMAPersona, 'id' | 'client_id' | 'created_at' | 'platform_handles' | 'active' | 'last_used_at' | 'usage_count'>[] = [
  { name: 'Chukwuemeka Obi', age: 34, gender: 'male', occupation: 'Civil Engineer', location: 'Lagos', country: 'NG', writing_style: 'casual', emoji_usage: 'medium', political_lean: 'centre', bio: 'Building bridges, literally and figuratively.', platforms: ['twitter', 'facebook'] },
  { name: 'Ngozi Adeyemi', age: 28, gender: 'female', occupation: 'Teacher', location: 'Abuja', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'left', bio: 'Education is the foundation.', platforms: ['twitter', 'facebook', 'reddit'] },
  { name: 'Babatunde Fashola-Nwachukwu', age: 45, gender: 'male', occupation: 'Business Owner', location: 'Kano', country: 'NG', writing_style: 'casual', emoji_usage: 'none', political_lean: 'right', bio: 'Entrepreneur. Nigeria first.', platforms: ['facebook', 'twitter'] },
  { name: 'Amaka Eze', age: 31, gender: 'female', occupation: 'Journalist', location: 'Port Harcourt', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'left', bio: 'Holding power accountable.', platforms: ['twitter', 'reddit'] },
  { name: 'Yusuf Musa', age: 38, gender: 'male', occupation: 'Farmer', location: 'Katsina', country: 'NG', writing_style: 'slang', emoji_usage: 'none', political_lean: 'right', bio: 'Northerner, proud Nigerian.', platforms: ['facebook'] },
  { name: 'Chidinma Okafor', age: 26, gender: 'female', occupation: 'Social Media Manager', location: 'Lagos', country: 'NG', writing_style: 'slang', emoji_usage: 'high', political_lean: 'centre', bio: 'Digital native. Love Jollof & politics 🔥', platforms: ['twitter', 'facebook'] },
  { name: 'Emeka Obiora', age: 52, gender: 'male', occupation: 'Retired Military Officer', location: 'Enugu', country: 'NG', writing_style: 'formal', emoji_usage: 'none', political_lean: 'right', bio: 'Service. Honour. Country.', platforms: ['facebook', 'twitter'] },
  { name: 'Funke Afolabi', age: 41, gender: 'female', occupation: 'Nurse', location: 'Ibadan', country: 'NG', writing_style: 'casual', emoji_usage: 'medium', political_lean: 'left', bio: 'Healthcare worker. Passionate about change.', platforms: ['facebook', 'twitter'] },
  { name: 'Tunde Bakare-Smith', age: 29, gender: 'male', occupation: 'Startup Founder', location: 'Lagos', country: 'NG', writing_style: 'casual', emoji_usage: 'medium', political_lean: 'centre', bio: 'Tech bro who cares about governance.', platforms: ['twitter', 'reddit'] },
  { name: 'Hauwa Bello', age: 33, gender: 'female', occupation: 'Lawyer', location: 'Abuja', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'left', bio: 'Rule of law. Always.', platforms: ['twitter', 'facebook'] },
  { name: 'Segun Adebayo', age: 47, gender: 'male', occupation: 'Local Government Councillor', location: 'Osun', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'right', bio: 'Serving my community.', platforms: ['facebook'] },
  { name: 'Blessing Nwosu', age: 24, gender: 'female', occupation: 'Student', location: 'Nsukka', country: 'NG', writing_style: 'slang', emoji_usage: 'high', political_lean: 'left', bio: 'UNN student. GenZ voice 🗣️', platforms: ['twitter'] },
  { name: 'Alhaji Garba Usman', age: 58, gender: 'male', occupation: 'Cattle Trader', location: 'Maiduguri', country: 'NG', writing_style: 'formal', emoji_usage: 'none', political_lean: 'right', bio: 'Faith, family, and fatherland.', platforms: ['facebook'] },
  { name: 'Ifeoma Chukwu', age: 36, gender: 'female', occupation: 'Accountant', location: 'Onitsha', country: 'NG', writing_style: 'casual', emoji_usage: 'low', political_lean: 'centre', bio: 'Numbers don\'t lie. Politics sometimes does.', platforms: ['twitter', 'facebook'] },
  { name: 'Damilola Ogundimu', age: 22, gender: 'male', occupation: 'Freelance Developer', location: 'Lagos', country: 'NG', writing_style: 'slang', emoji_usage: 'high', political_lean: 'left', bio: 'Code. Music. Revolution 🔥', platforms: ['twitter', 'reddit'] },
  { name: 'Fatima Aliyu', age: 30, gender: 'female', occupation: 'Pharmacist', location: 'Kaduna', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'centre', bio: 'Health for all Nigerians.', platforms: ['facebook', 'twitter'] },
  { name: 'Kelechi Onyekachi', age: 43, gender: 'male', occupation: 'Journalist', location: 'Owerri', country: 'NG', writing_style: 'formal', emoji_usage: 'low', political_lean: 'left', bio: 'Pen mightier than the sword.', platforms: ['twitter'] },
  { name: 'Adaeze Nnamdi', age: 27, gender: 'female', occupation: 'HR Manager', location: 'Abuja', country: 'NG', writing_style: 'casual', emoji_usage: 'medium', political_lean: 'centre', bio: 'People matter. Policy matters.', platforms: ['twitter', 'facebook'] },
  { name: 'Musa Ibrahim', age: 40, gender: 'male', occupation: 'Security Guard', location: 'Jos', country: 'NG', writing_style: 'slang', emoji_usage: 'none', political_lean: 'right', bio: 'Protecting lives every day.', platforms: ['facebook'] },
  { name: 'Chinwe Obi', age: 35, gender: 'female', occupation: 'Fashion Designer', location: 'Lagos', country: 'NG', writing_style: 'casual', emoji_usage: 'high', political_lean: 'centre', bio: 'Fashion. Business. Nigeria 💅', platforms: ['facebook', 'twitter'] },
];

const DELAY_PROFILES = {
  quick:   { min: 2 * 60_000,  max: 15 * 60_000  },
  normal:  { min: 20 * 60_000, max: 90 * 60_000  },
  slow:    { min: 90 * 60_000, max: 180 * 60_000 },
};

export class APMAHumanizerService {
  private personas: APMAPersona[] = [];
  private personasLoaded = false;

  async loadPersonas(clientId?: string): Promise<void> {
    const sb = getServiceSupabaseClient();
    let q = sb.from('apma_personas').select('*').eq('active', true);
    if (clientId) q = q.or(`client_id.eq.${clientId},client_id.is.null`);
    const { data } = await q.order('last_used_at', { ascending: true, nullsFirst: true }).limit(200);
    this.personas = (data as APMAPersona[]) || [];
    this.personasLoaded = true;
  }

  async pickPersona(platform: string, clientId?: string): Promise<APMAPersona | null> {
    if (!this.personasLoaded) await this.loadPersonas(clientId);
    const eligible = this.personas.filter(
      (p) => p.platforms.includes(platform) && p.active,
    );
    if (!eligible.length) return null;
    const picked = eligible[Math.floor(Math.random() * eligible.length)];
    const sb = getServiceSupabaseClient();
    await sb.from('apma_personas').update({
      last_used_at: new Date().toISOString(),
      usage_count: (picked.usage_count ?? 0) + 1,
    }).eq('id', picked.id);
    return picked;
  }

  humanizeText(rawText: string, persona: APMAPersona): string {
    let text = rawText.trim();

    // Style-based transformations
    if (persona.writing_style === 'slang') {
      text = this._applyNigerianSlang(text);
    }

    if (persona.writing_style === 'casual') {
      text = this._addFillerPhrases(text);
    }

    // Inject occasional typos (1 in 4 chance per sentence)
    text = this._injectTypos(text, 0.25);

    // Variable sentence endings
    text = this._varyEndings(text);

    // Emoji injection based on persona preference
    text = this._addEmojis(text, persona.emoji_usage);

    // Never start with "I" - humanize opener
    text = this._humanizeOpener(text, persona.writing_style);

    // Trim to safe length
    if (text.length > 280 && persona.platforms.includes('twitter')) {
      const sentences = text.split('. ');
      text = sentences.slice(0, Math.ceil(sentences.length / 2)).join('. ');
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
  ): Promise<HumanizedContent | null> {
    const persona = await this.pickPersona(platform, clientId);
    if (!persona) return null;
    return {
      text: this.humanizeText(rawText, persona),
      persona,
      delay_ms: this.generateDelay(delayProfile),
      platform,
    };
  }

  async seedPersonas(clientId?: string): Promise<number> {
    const sb = getServiceSupabaseClient();
    const toInsert = BASE_PERSONAS.map((p) => ({
      ...p,
      client_id: clientId ?? null,
      platform_handles: {},
      active: true,
      usage_count: 0,
    }));
    const { data, error } = await sb.from('apma_personas').insert(toInsert).select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  private _applyNigerianSlang(text: string): string {
    const insertions = NIGERIAN_SLANG.slice(0, 3);
    const sentences = text.split('. ');
    return sentences.map((s, i) => {
      if (i % 3 === 0 && Math.random() > 0.5) {
        const slang = insertions[Math.floor(Math.random() * insertions.length)];
        return `${slang}, ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
      }
      return s;
    }).join('. ');
  }

  private _addFillerPhrases(text: string): string {
    if (Math.random() > 0.4) return text;
    const filler = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
    return `${filler}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }

  private _injectTypos(text: string, rate: number): string {
    const TYPOS: Record<string, string> = {
      'the': 'teh', 'and': 'adn', 'have': 'hve', 'that': 'taht',
      'with': 'wiht', 'this': 'tihs', 'very': 'vrey', 'really': 'realy',
      'government': 'governement', 'election': 'elction', 'Nigeria': 'Nigeeria',
    };
    return text.split(' ').map((word) => {
      const lower = word.toLowerCase();
      if (TYPOS[lower] && Math.random() < rate) return TYPOS[lower];
      return word;
    }).join(' ');
  }

  private _varyEndings(text: string): string {
    const endings = ['.', '!', '...', '.', ''];
    if (text.endsWith('.')) {
      const e = endings[Math.floor(Math.random() * endings.length)];
      return text.slice(0, -1) + e;
    }
    return text;
  }

  private _addEmojis(text: string, level: 'none' | 'low' | 'medium' | 'high'): string {
    const POLITICAL_EMOJIS = ['🇳🇬', '💪', '🔥', '👆', '✊', '🎯', '📣', '🤝', '🌟', '💡'];
    if (level === 'none') return text;
    const count = level === 'low' ? 1 : level === 'medium' ? 2 : 3;
    const chosen = POLITICAL_EMOJIS
      .sort(() => Math.random() - 0.5)
      .slice(0, count)
      .join(' ');
    return `${text} ${chosen}`;
  }

  private _humanizeOpener(text: string, style: string): string {
    if (style !== 'casual' && style !== 'slang') return text;
    if (text.startsWith('I ') && Math.random() > 0.5) {
      const opener = CASUAL_OPENERS[Math.floor(Math.random() * CASUAL_OPENERS.length)];
      return `${opener}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
    return text;
  }
}

export const apmaHumanizerService = new APMAHumanizerService();
