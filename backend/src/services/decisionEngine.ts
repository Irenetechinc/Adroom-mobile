
import { AIEngine } from '../config/ai-models';
import { MemoryContext } from './memoryRetriever';

export interface StrategyDecision {
  strategy_type: 'free' | 'paid';
  platforms: string[];
  content_plan: any;
  budget_recommendation?: number;
  reasoning: string;
}

export class DecisionEngine {
  private ai: AIEngine;

  constructor() {
    this.ai = AIEngine.getInstance();
  }

  /**
   * Generates a complete strategy based on comprehensive memory context
   */
  async generateStrategy(memory: MemoryContext, goal: string, duration: number): Promise<StrategyDecision> {
    console.log('Generating strategy with goal:', goal);

    // Construct the prompt for the AI Brain
    const prompt = `
      You are the AdRoom AI Core Brain. Your task is to generate a comprehensive marketing strategy based on the following context.
      
      USER CONTEXT:
      - Profile: ${JSON.stringify(memory.user)}
      - History: ${JSON.stringify(memory.history)}
      
      PRODUCT/SERVICE CONTEXT:
      - Details: ${JSON.stringify(memory.product || memory.service)}
      
      GLOBAL INTELLIGENCE:
      - Platform Status: ${JSON.stringify(memory.platformStatus)}
      - Global Trends: ${JSON.stringify(memory.globalTrends)}
      
      CAMPAIGN GOAL: ${goal}
      DURATION: ${duration} days
      
      TASK:
      Generate TWO detailed strategies:
      1. A FREE (Organic) Strategy: Focus on content, community, and viral growth. No ad spend.
      2. A PAID (Ads) Strategy: Focus on ROAS, targeting, and scaling. Include budget recommendations.
      
      For each strategy, provide:
      - Platform selection (Why these platforms?)
      - Content pillars and schedule
      - Engagement tactics
      - Expected outcomes (Reach, Engagement, Conversions)
      - Key risks and mitigation
      
      Output ONLY valid JSON in the following format:
      {
        "free_strategy": {
          "platforms": ["..."],
          "content_plan": { ... },
          "engagement_plan": { ... },
          "expected_outcomes": { ... }
        },
        "paid_strategy": {
          "platforms": ["..."],
          "budget_recommendation": number,
          "campaign_structure": { ... },
          "expected_outcomes": { ... }
        },
        "comparison": {
           "summary": "...",
           "recommendation": "..."
        }
      }
    `;

    // Call GPT-4/5
    const response = await this.ai.generateStrategy(memory, prompt);
    
    if (!response.parsedJson) {
      throw new Error('Failed to generate valid JSON strategy');
    }

    return response.parsedJson;
  }

  /**
   * Evaluates a user's request against platform policies and best practices
   */
  async evaluateRisk(content: string, platform: string): Promise<any> {
    const prompt = `
      Evaluate the following content for compliance with ${platform} advertising policies.
      Content: "${content}"
      
      Return JSON: { "compliant": boolean, "risk_level": "low"|"medium"|"high", "issues": [] }
    `;
    
    return (await this.ai.generateStrategy({}, prompt)).parsedJson;
  }
}
