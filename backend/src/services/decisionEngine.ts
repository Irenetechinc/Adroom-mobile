
import { AIEngine } from '../config/ai-models';
import { MemoryContext } from './memoryRetriever';

export interface StrategyDecision {
  strategy_type: 'free' | 'paid';
  platforms: string[];
  content_plan: any;
  budget_recommendation?: number;
  reasoning: string;
}

export interface GeneratedStrategies {
  free_strategy: any;
  paid_strategy: any;
  comparison: any;
}

export class DecisionEngine {
  private ai: AIEngine;

  constructor() {
    this.ai = AIEngine.getInstance();
  }

  async generateStrategy(memory: MemoryContext, goal: string, duration: number): Promise<GeneratedStrategies> {
    console.log('Generating strategy with goal:', goal);

    // AI Brain Step-by-Step Thinking Process (PDF Section 3)
    const thinkingProcess = `
      Step 1: GATHER CONTEXT
      "What am I being asked right now?
      Who is this user? (pull full user memory)
      What have they done before?
      What's currently active?
      What's the platform landscape right now?
      What global patterns apply?"

      Step 2: RETRIEVE RELEVANT MEMORY
      "Has this user done something similar before?
      What were the results?
      What does global data say about this product type?
      What platforms are favoring what right now?"

      Step 3: GENERATE POSSIBILITIES
      "Based on all this, what are 3-5 possible approaches?"

      Step 4: EVALUATE AND SELECT
      "Select the optimal approach for this user and product."

      Step 5: CREATE DETAILED PLAN
      "Generate complete execution plan: Content, Timing, Budget, Targeting."
    `;

    // Construct the prompt for the AI Brain
    const prompt = `
      You are the AdRoom AI Core Brain. Follow this thinking process:
      ${thinkingProcess}
      
      USER CONTEXT:
      - Profile: ${JSON.stringify(memory.user)}
      - History: ${JSON.stringify(memory.history)}
      
      PRODUCT/SERVICE CONTEXT:
      - Details: ${JSON.stringify(memory.product || memory.service)}
      
      GLOBAL INTELLIGENCE:
      - Platform Status: ${JSON.stringify(memory.platformStatus)}
      - Global Trends: ${JSON.stringify(memory.globalTrends)}
      - IPE ALGORITHM SHIFTS (CRITICAL): ${JSON.stringify(memory.ipeIntelligence)}
      
      CAMPAIGN GOAL: ${goal}
      DURATION: ${duration} days
      
      TASK:
      Generate TWO detailed strategies (FREE and PAID).
      
      FREE Strategy Requirements:
      - Focus on 3 Content Pillars: 
        1. Educational/Problem-Solving
        2. Entertainment/Engagement
        3. Social Proof/Trust Building
      - Exact posting schedule (date/time per platform)
      - Community building tactics
      
      PAID Strategy Requirements:
      - ROAS focus, specific targeting parameters
      - Budget allocation recommendations
      - A/B test configurations
      
      Output ONLY valid JSON in the following format:
      {
        "free_strategy": {
          "platforms": ["..."],
          "content_plan": { 
             "pillars": [{"title": "...", "description": "...", "examples": []}],
             "schedule": [{"day": number, "platform": "...", "time": "...", "content_type": "...", "topic": "..."}]
          },
          "engagement_plan": { "tactics": [] },
          "expected_outcomes": { "reach": "...", "engagement": "...", "conversions": "..." }
        },
        "paid_strategy": {
          "platforms": ["..."],
          "budget_recommendation": number,
          "targeting": { "audience": "...", "interests": [], "demographics": {} },
          "campaign_structure": { "ad_sets": [], "creatives": [] },
          "expected_outcomes": { "roas": "...", "conversions": "...", "cpa": "..." }
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
