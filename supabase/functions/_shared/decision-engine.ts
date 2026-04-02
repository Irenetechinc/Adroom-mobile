// @ts-nocheck
import { AIEngine } from './ai-models.ts';
import { MemoryContext } from './memory-retriever.ts';

export interface StrategyDecision {
  platforms: string[];
  content_plan: any;
  engagement_plan?: any;
  expected_outcomes?: any;
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
      Generate ONE detailed ORGANIC strategy (no ads, no budgets):
      
      Provide:
      - Platform selection (Why these platforms?)
      - Content pillars and schedule
      - Engagement tactics
      - Expected outcomes (Reach, Engagement, Conversions) without referencing ad spend
      - Key risks and mitigation
      
      Output ONLY valid JSON in the following format:
      {
        "platforms": ["..."],
        "content_plan": { ... },
        "engagement_plan": { ... },
        "expected_outcomes": { ... },
        "reasoning": "..."
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
