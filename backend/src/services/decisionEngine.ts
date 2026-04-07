
import { AIEngine } from '../config/ai-models';
import { MemoryContext } from './memoryRetriever';
import { getServiceSupabaseClient } from '../config/supabase';

export interface AIStrategy {
  title: string;
  rationale: string;
  platforms: string[];
  content_pillars: any[];
  schedule: any[];
  estimated_outcomes: any;
  risk_assessment?: any;
}

export class DecisionEngine {
  private ai: AIEngine;
  private supabase;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async generateStrategy(memory: MemoryContext, goal: string, duration: number, economyMode = false): Promise<AIStrategy> {
    console.log('AI Brain: Generating Dynamic Strategy with Intelligent Weighting...');

    // 1. GATHER all relevant intelligence sources
    const intelligence = {
        platform: memory.platformIntelligence || [],
        social: memory.socialListening || [],
        emotional: memory.emotionalIntelligence || [],
        geo: memory.geoNarrative || [],
        history: memory.history || [],
        user: memory.user
    };

    // 2. WEIGHT each source dynamically
    const weights = this.calculateDynamicWeights(intelligence);

    const prompt = `
      You are the AdRoom AI Core Brain. Generate the OPTIMAL organic strategy that outperforms paid ads.
      NO hard-coded rules. Use weighted intelligence to identify high-reach organic arbitrage.

      INTELLIGENCE: ${JSON.stringify(intelligence)}
      DYNAMIC WEIGHTS: ${JSON.stringify(weights)}
      GOAL: ${goal}
      DURATION: ${duration} days

      STRATEGIC FOCUS:
      - AdRoom's USP is achieving paid-ad results through organic automation.
      - Use Platform Intelligence to find current "Organic Boost" hacks (e.g., TikTok SEO, LinkedIn Video priority).
      - Use Emotional Intelligence to "own" the category conversation.
      - Use Social Listening to "hijack" trending topics with high-relevance replies.

      OUTPUT JSON (Selected Strategy):
      {
        "title": "string",
        "rationale": "detailed reason why this organic strategy will beat a paid campaign",
        "platforms": ["..."],
        "organic_leverage_points": ["Specific algo hacks used"],
        "content_pillars": [
           { 
             "title": "...", 
             "purpose": "Solve/Answer/Emotional/GEO/Trend",
             "source_data": "...",
             "formats": ["..."],
             "virality_hooks": ["Specific hooks for organic reach"]
           }
        ],
        "schedule": [
           { "day": 1, "platform": "...", "content_type": "...", "topic": "...", "time": "HH:MM", "reason": "why this time/format is best for organic reach" }
        ],
        "estimated_outcomes": { "reach": number, "engagement": number, "paid_equivalent_value_usd": number },
        "weights_applied": ${JSON.stringify(weights)}
      }
    `;

    const response = economyMode
      ? await this.ai.generateStrategyEconomy({}, prompt)
      : await this.ai.generateStrategy({}, prompt);
    const strategy: AIStrategy = response.parsedJson;

    if (!strategy) throw new Error('AI Brain failed to generate strategy.');

    await this.storeDecision(memory, strategy, goal, weights);

    return strategy;
  }

  private calculateDynamicWeights(intelligence: any) {
      // Logic to calculate weights based on recency and confidence
      // For example, if a platform shift was detected in the last 15 mins, weight it 2x
      const weights = {
          platform: 1.0,
          social: 1.0,
          emotional: 1.0,
          geo: 1.0,
          history: 1.0
      };

      // Check for recent critical platform shifts
      const recentShifts = intelligence.platform.filter((p: any) => 
          new Date().getTime() - new Date(p.captured_at).getTime() < 15 * 60 * 1000
      );
      if (recentShifts.length > 0) weights.platform = 2.0;

      // Check for high confidence social listening
      const highConfSocial = intelligence.social.filter((s: any) => s.sentiment !== 0);
      if (highConfSocial.length > 5) weights.social = 1.5;

      return weights;
  }

  private async storeDecision(memory: MemoryContext, strategy: AIStrategy, goal: string, weights: any) {
    try {
        await this.supabase.from('ai_decisions').insert({
            decision_type: 'strategy_generation',
            context: { goal, user_id: memory.user.id },
            intelligence_used: {
                platform_count: memory.platformIntelligence?.length ?? 0,
                social_count: memory.socialListening?.length ?? 0,
                emotional_count: memory.emotionalIntelligence?.length ?? 0,
                geo_count: memory.geoNarrative?.length ?? 0
            },
            weights_applied: weights,
            selected_option: strategy,
            predicted_outcome: strategy.estimated_outcomes,
            decision_time: new Date().toISOString()
        });
    } catch (e) {
        console.error('Failed to store AI decision:', e);
    }
  }
  
  async learnFromOutcomes(decisionId: string, actualOutcome: any) {
    try {
        const { data: decision } = await this.supabase
            .from('ai_decisions')
            .select('*')
            .eq('id', decisionId)
            .single();

        if (!decision) return;

        const prompt = `
            Analyze the outcome of this AI decision.
            
            DECISION: ${JSON.stringify(decision.selected_option)}
            PREDICTED OUTCOME: ${JSON.stringify(decision.predicted_outcome)}
            ACTUAL OUTCOME: ${JSON.stringify(actualOutcome)}
            
            Identify:
            1. Accuracy of prediction
            2. What factors led to the variance?
            3. What should be adjusted for next time?
            
            Return JSON:
            {
                "accuracy_score": number (0-100),
                "variance_analysis": "string",
                "adjustment_recommendation": "string"
            }
        `;

        const response = await this.ai.generateStrategy({}, prompt);
        const analysis = response.parsedJson;

        await this.supabase
            .from('ai_decisions')
            .update({
                actual_outcome: actualOutcome,
                learning_analysis: analysis
            })
            .eq('id', decisionId);

        console.log('AI Learning: Updated decision with outcome analysis.');

    } catch (e) {
        console.error('Failed to process learning outcome:', e);
    }
  }

  async handleAlert(source: string, alerts: any[]) {
    if (!alerts || alerts.length === 0) return;

    const prompt = `
      You are the AdRoom AI Core Brain. You received alerts from ${source}.
      Decide what action to take next for active organic strategies and engagement workflows.

      ALERTS:
      ${JSON.stringify(alerts)}

      Return JSON:
      {
        "recommended_actions": [
          {
            "type": "strategy_adjustment" | "engagement_tuning" | "monitor_only" | "user_notification",
            "reason": "string",
            "urgency": "low" | "medium" | "high"
          }
        ]
      }
    `;

    const response = await this.ai.generateStrategy({}, prompt);
    const recommendation = response.parsedJson;

    try {
      await this.supabase.from('ai_decisions').insert({
        decision_type: 'alert_received',
        context: { source },
        intelligence_used: { alerts },
        selected_option: recommendation,
        decision_time: new Date().toISOString()
      });
    } catch (e) {
      console.error('Failed to store alert decision:', e);
    }
  }

  async generateEngagementReply(input: string, context: 'comment' | 'message', userHistory: any[]): Promise<string> {
    const prompt = `
      You are the AdRoom Engagement AI.
      Task: Generate a reply to this ${context}.
      
      INPUT: "${input}"
      USER HISTORY: ${JSON.stringify(userHistory)}
      
      Guidelines:
      1. Analyze Intent (Question, Praise, Complaint)
      2. Check Sentiment
      3. Be helpful, authentic, and concise.
      4. If complaint, be empathetic and offer solution.
      5. If question, answer directly.
      
      Return ONLY the reply text.
    `;
    
    return (await this.ai.generateStrategy({}, prompt)).text;
  }

  async evaluateRisk(content: string, platform: string): Promise<any> {
    const prompt = `
      Evaluate content for ${platform} policy compliance.
      Content: "${content}"
      Return JSON: { "compliant": boolean, "risk_level": "low"|"medium"|"high", "issues": [] }
    `;
    return (await this.ai.generateStrategy({}, prompt)).parsedJson;
  }
}
