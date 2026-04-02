import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

export class EmotionalIntelligenceEngine {
  private ai: AIEngine;
  private supabase;
  private stateKey = 'emotional_last_processed_at';

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async analyzeText(text: string): Promise<any> {
    const prompt = `
      Analyze the emotional content of the following text based on the NADE 8-emotion framework.
      Emotions: joy, sadness, anger, fear, trust, surprise, anticipation, disgust.
      Return a JSON object with scores from 0 to 1 for each emotion.

      TEXT: "${text}"

      OUTPUT JSON:
      {
        "joy": number,
        "sadness": number,
        "anger": number,
        "fear": number,
        "trust": number,
        "surprise": number,
        "anticipation": number,
        "disgust": number
      }
    `;

    try {
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson;
    } catch (e) {
        console.error('Emotional analysis failed:', e);
        return { joy: 0, sadness: 0, anger: 0, fear: 0, trust: 0, surprise: 0, anticipation: 0, disgust: 0 };
    }
  }

  async runCycle() {
    console.log('[Emotional Intelligence] Starting ownership update cycle...');
    
    // 1. Fetch recent social conversations
    const { data: conversations } = await this.supabase
        .from('social_conversations')
        .select('content, category, author')
        .order('collected_at', { ascending: false })
        .limit(100);

    if (!conversations || conversations.length === 0) return { alerts: [] };

    const alerts: any[] = [];

    // 2. Aggregate by category
    const categories = [...new Set(conversations.map(c => c.category))];
    
    for (const cat of categories) {
        const catConvos = conversations.filter(c => c.category === cat);
        const textBlob = catConvos.map(c => c.content).join('\n\n');
        
        // 3. Analyze emotional landscape for category
        const scores = await this.analyzeText(textBlob);
        
        // 4. Identify emotional gaps and ownership
        const ownershipPrompt = `
          Based on these emotional scores for the category "${cat}":
          ${JSON.stringify(scores)}
          
          And these recent conversations:
          ${JSON.stringify(catConvos.slice(0, 10))}

          Identify:
          1. Which brands "own" which emotions (e.g., "Brand X" owns "Trust" at 70%).
          2. Which emotions are "unowned" (Emotional Gaps).
          3. Opportunity size for each gap (0-100).

          OUTPUT JSON:
          {
            "ownership": [
               { "emotion": "...", "brand": "...", "percentage": number, "confidence": number }
            ],
            "gaps": [
               { "emotion": "...", "opportunity_size": number, "reason": "..." }
            ]
          }
        `;

        const ownershipResponse = await this.ai.generateStrategy({}, ownershipPrompt);
        const analysis = ownershipResponse.parsedJson;

        // 5. Store in database
        if (analysis && analysis.ownership) {
            for (const own of analysis.ownership) {
                await this.supabase.from('emotional_ownership').upsert({
                    category: cat,
                    emotion: own.emotion,
                    owner_brand: own.brand,
                    ownership_percentage: own.percentage,
                    confidence: own.confidence,
                    detected_at: new Date().toISOString()
                }, { onConflict: 'category, emotion' });

                await this.supabase.from('emotional_ownership_history').insert({
                    category: cat,
                    emotion: own.emotion,
                    owner_brand: own.brand,
                    ownership_percentage: own.percentage,
                    confidence: own.confidence
                });
            }
        }
        
        // Check for alerts (e.g., new emotional gaps identified)
        if (analysis && analysis.gaps && analysis.gaps.length > 0) {
            alerts.push({ type: 'EMOTIONAL_GAPS_IDENTIFIED', category: cat, gaps: analysis.gaps });
        }
    }

    return { alerts };
  }
}
