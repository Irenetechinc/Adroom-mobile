import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

export interface CountryContext {
  country: string;
  countryName: string;
  language: string;
  majorPlatforms: string[];
  culturalTone: string;
  politicalSystem: string;
  majorTopics: string[];
  informalSpeechMarkers: string[];
  formalSpeechMarkers: string[];
  demographicGroups: DemographicGroup[];
  newsKeywords: string[];
  contentGuidelines: string;
}

export interface DemographicGroup {
  occupation: string;
  location: string;
  ageRange: [number, number];
  gender: 'male' | 'female' | 'any';
  writingStyle: 'formal' | 'casual' | 'slang' | 'academic';
  emojiUsage: 'none' | 'low' | 'medium' | 'high';
  politicalLean: 'left' | 'centre' | 'right';
}

const CONTEXT_CACHE = new Map<string, { ctx: CountryContext; expires: number }>();

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', ZA: 'South Africa', EG: 'Egypt',
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  IN: 'India', PK: 'Pakistan', BD: 'Bangladesh',
  BR: 'Brazil', MX: 'Mexico', CO: 'Colombia', AR: 'Argentina',
  DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', PL: 'Poland',
  ID: 'Indonesia', PH: 'Philippines', TH: 'Thailand', VN: 'Vietnam', MY: 'Malaysia',
  TR: 'Turkey', IR: 'Iran', SA: 'Saudi Arabia', AE: 'United Arab Emirates', IL: 'Israel',
  RU: 'Russia', UA: 'Ukraine', SN: 'Senegal', CI: 'Ivory Coast', TZ: 'Tanzania',
  ET: 'Ethiopia', UG: 'Uganda', ZW: 'Zimbabwe', CM: 'Cameroon', ML: 'Mali',
};

export class APMAGeoService {
  private ai = AIEngine.getInstance();

  async getCountryContext(countryCode: string): Promise<CountryContext> {
    const cached = CONTEXT_CACHE.get(countryCode);
    if (cached && cached.expires > Date.now()) return cached.ctx;

    const countryName = COUNTRY_CODE_TO_NAME[countryCode] ?? countryCode;
    const prompt = `You are a geopolitical and socio-cultural expert. Generate a comprehensive context profile for political marketing campaigns in ${countryName} (${countryCode}).

Return ONLY a JSON object with this exact structure:
{
  "country": "${countryCode}",
  "countryName": "${countryName}",
  "language": "<primary language code, e.g. en, fr, ar, pt>",
  "majorPlatforms": ["<top 4 social platforms actually used in this country>"],
  "culturalTone": "<describe the dominant cultural communication tone in 1 sentence>",
  "politicalSystem": "<brief description: presidential democracy, parliamentary, monarchy, etc.>",
  "majorTopics": ["<8-10 most politically salient current topics in this country>"],
  "informalSpeechMarkers": ["<6-8 informal slang phrases, filler words, or speech patterns authentic to this country's internet culture>"],
  "formalSpeechMarkers": ["<4-6 formal political speech phrases used in this country>"],
  "demographicGroups": [
    {
      "occupation": "<realistic job title>",
      "location": "<real city in country>",
      "ageRange": [min, max],
      "gender": "male|female|any",
      "writingStyle": "formal|casual|slang|academic",
      "emojiUsage": "none|low|medium|high",
      "politicalLean": "left|centre|right"
    }
  ],
  "newsKeywords": ["<8-10 search terms that surface political news in this country on NewsAPI/Google>"],
  "contentGuidelines": "<1-2 sentences on cultural sensitivities to avoid in political content for this country>"
}

Include 12-15 diverse demographic groups covering different ages, genders, regions, and occupations typical of ${countryName}.
Only valid JSON. No explanation.`;

    let ctx: CountryContext;
    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 2500, temperature: 0.3 });
      ctx = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
    } catch {
      ctx = this._fallbackContext(countryCode, countryName);
    }

    CONTEXT_CACHE.set(countryCode, { ctx, expires: Date.now() + 6 * 3_600_000 });
    return ctx;
  }

  async generatePersonasForCountry(countryCode: string, count = 20): Promise<any[]> {
    const ctx = await this.getCountryContext(countryCode);

    const prompt = `Generate ${count} unique, realistic social media personas for ${ctx.countryName} (${countryCode}) to be used in political commentary.

Cultural context:
- Language: ${ctx.language}
- Cultural tone: ${ctx.culturalTone}
- Political system: ${ctx.politicalSystem}
- Demographic groups available: ${ctx.demographicGroups.map((g) => g.occupation + ' (' + g.location + ')').join(', ')}

Generate ${count} distinct personas. Each persona must feel like a real person from ${ctx.countryName}.

Return ONLY a JSON array of objects with:
{
  "name": "<realistic full name for this country>",
  "age": <integer 22-65>,
  "gender": "male|female",
  "occupation": "<realistic occupation>",
  "location": "<real city in ${ctx.countryName}>",
  "country": "${countryCode}",
  "writing_style": "formal|casual|slang|academic",
  "emoji_usage": "none|low|medium|high",
  "political_lean": "left|centre|right",
  "bio": "<1-sentence authentic bio>",
  "platforms": ["<2-3 platforms from ${JSON.stringify(ctx.majorPlatforms)}>"],
  "platform_handles": {}
}

Ensure variety in age, gender, location, occupation, and political lean. Only valid JSON array.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 3000, temperature: 0.8 });
      return JSON.parse((resp || '').replace(/```json|```/g, '').trim());
    } catch {
      return ctx.demographicGroups.map((g, i) => ({
        name: `Persona ${i + 1}`,
        age: Math.floor((g.ageRange[0] + g.ageRange[1]) / 2),
        gender: g.gender === 'any' ? (i % 2 === 0 ? 'male' : 'female') : g.gender,
        occupation: g.occupation,
        location: g.location,
        country: countryCode,
        writing_style: g.writingStyle,
        emoji_usage: g.emojiUsage,
        political_lean: g.politicalLean,
        bio: `${g.occupation} from ${g.location}`,
        platforms: ctx.majorPlatforms.slice(0, 2),
        platform_handles: {},
      }));
    }
  }

  async humanizeForCountry(text: string, ctx: CountryContext, style: string): Promise<string> {
    const markers = style === 'slang'
      ? ctx.informalSpeechMarkers
      : ctx.formalSpeechMarkers;

    if (!markers.length) return text;

    const prompt = `Rewrite this political commentary for social media in ${ctx.countryName}. 

Original text: "${text}"

Requirements:
- Writing style: ${style}
- Cultural tone: ${ctx.culturalTone}
- Language: ${ctx.language} (use ${ctx.language === 'en' ? 'English' : 'the local language mixed with English if code-switching is natural'})
- Optionally incorporate one of these authentic speech patterns: ${markers.slice(0, 4).join(', ')}
- Sound like a genuine ${ctx.countryName} citizen, NOT a foreign observer
- Keep the core political message intact
- Platform-appropriate length

Return ONLY the rewritten text. No quotes, no explanation.`;

    try {
      const rewritten = await this.ai.generateWithGemini(prompt, { maxTokens: 400, temperature: 0.9 });
      return (rewritten || text).trim();
    } catch {
      return text;
    }
  }

  private _fallbackContext(code: string, name: string): CountryContext {
    return {
      country: code,
      countryName: name,
      language: 'en',
      majorPlatforms: ['twitter', 'facebook', 'reddit', 'youtube'],
      culturalTone: 'Direct and opinionated, with strong community values',
      politicalSystem: 'Democratic system',
      majorTopics: ['economy', 'governance', 'security', 'education', 'healthcare', 'corruption', 'elections', 'infrastructure'],
      informalSpeechMarkers: ['honestly', 'tbh', 'ngl', 'real talk', 'low key', 'no cap'],
      formalSpeechMarkers: ['citizens deserve', 'accountability is key', 'sustainable development', 'democratic values'],
      demographicGroups: [
        { occupation: 'Teacher', location: `${name} Capital`, ageRange: [28, 45], gender: 'female', writingStyle: 'formal', emojiUsage: 'low', politicalLean: 'left' },
        { occupation: 'Business Owner', location: `${name} City`, ageRange: [35, 55], gender: 'male', writingStyle: 'casual', emojiUsage: 'none', politicalLean: 'right' },
        { occupation: 'Student', location: `University District`, ageRange: [19, 28], gender: 'any', writingStyle: 'slang', emojiUsage: 'high', politicalLean: 'left' },
        { occupation: 'Civil Servant', location: `${name} Capital`, ageRange: [30, 50], gender: 'male', writingStyle: 'formal', emojiUsage: 'none', politicalLean: 'centre' },
        { occupation: 'Journalist', location: `Media Hub`, ageRange: [25, 45], gender: 'female', writingStyle: 'formal', emojiUsage: 'low', politicalLean: 'centre' },
      ],
      newsKeywords: [name, 'government', 'election', 'president', 'parliament', 'economy', 'corruption', 'policy'],
      contentGuidelines: `Avoid ethnic, religious, or regional stereotypes. Focus on policy issues, governance, and civic accountability.`,
    };
  }
}

export const apmaGeoService = new APMAGeoService();
