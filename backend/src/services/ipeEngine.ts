
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { CommunicationService } from './communicationService';

export class PlatformIntelligenceEngine {
  private ai: AIEngine;
  private supabase;
  private communicationService: CommunicationService;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
    this.communicationService = new CommunicationService();
  }

  /**
   * Main cycle for the IPE (Runs every 15-60 mins)
   */
  async runCycle() {
    console.log('Starting IPE Cycle...');
    
    // 1. Platform Monitor
    const rawData = await this.monitorPlatforms();
    
    // 2. Algorithm Analyzer
    const shifts = await this.analyzeAlgorithms(rawData);
    
    // 3. Trend Predictor
    const trends = await this.analyzeTrends();

    // 4. Opportunity Detector
    const opportunities = await this.detectOpportunities(shifts, trends);

    // 5. Risk Assessor
    const risks = await this.assessRisks(shifts);
    
    // 6. Intelligence Dispatcher
    await this.dispatchIntelligence([...shifts, ...trends, ...opportunities, ...risks]);
    
    console.log('IPE Cycle Completed.');
    return { shifts, trends, opportunities, risks };
  }

  /**
   * Fetches data from official sources (RSS/APIs)
   */
  private async monitorPlatforms() {
    const sources = [
      { name: 'Meta Newsroom', url: 'https://about.fb.com/news/feed/' },
      { name: 'Instagram Blog', url: 'https://about.instagram.com/blog/feed' }, 
      { name: 'TikTok Newsroom', url: 'https://newsroom.tiktok.com/en-us/feed' } 
    ];

    const results = [];
    
    for (const source of sources) {
      try {
        console.log(`Fetching from ${source.name}...`);
        const response = await fetch(source.url);
        if (response.ok) {
          const text = await response.text();
          const contentSnippet = text.substring(0, 5000); 
          results.push({ source: source.name, content: contentSnippet });
        } else {
            console.warn(`Failed to fetch ${source.name}: ${response.status}`);
        }
      } catch (error) {
        console.error(`Error monitoring ${source.name}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Analyzes raw data for algorithm shifts using AI
   */
  private async analyzeAlgorithms(rawData: any[]) {
    if (rawData.length === 0) return [];

    const prompt = `
      Analyze the following text snippets from social media platform newsrooms.
      Detect any announcements or patterns indicating algorithm changes, new features, or policy updates.
      
      Focus on:
      - Algorithm ranking factors (e.g., "Video weight increased")
      - New features affecting reach (e.g., "Reels update")
      - Policy changes (e.g., "Ad transparency rules")
      
      DATA:
      ${JSON.stringify(rawData)}
      
      Return a JSON array of detected shifts:
      [
        {
          "platform": "facebook" | "instagram" | "tiktok",
          "type": "algorithm_shift" | "feature_update" | "policy_change",
          "summary": "Short description",
          "confidence": number (0-100),
          "impact_score": number (1-10),
          "recommended_action": "Actionable advice for advertisers"
        }
      ]
      
      If no significant shifts are found, return an empty array [].
    `;

    const response = await this.ai.generateStrategy({}, prompt);
    return response.parsedJson || [];
  }

  /**
   * Trend Predictor: Forecasts future trends based on global strategy data
   */
  private async analyzeTrends() {
      // Fetch aggregated global stats
      const { data: globalStats } = await this.supabase
          .from('global_strategy_memory')
          .select('*')
          .order('average_roas', { ascending: false })
          .limit(20);

      if (!globalStats || globalStats.length === 0) return [];

      const prompt = `
        Analyze the following global ad performance data.
        Identify emerging trends and forecast what will work in the next 30 days.
        
        DATA:
        ${JSON.stringify(globalStats)}
        
        Return a JSON array of predicted trends:
        [
            {
                "platform": "string",
                "type": "trend_forecast",
                "summary": "Short prediction (e.g. 'Short-form video dominant in Beauty')",
                "confidence": number (0-100),
                "impact_score": number (1-10),
                "recommended_action": "How to capitalize on this"
            }
        ]
      `;

      const response = await this.ai.generateStrategy({}, prompt);
      return response.parsedJson || [];
  }

  /**
   * Opportunity Detector: Finds gaps and high-potential areas
   */
  private async detectOpportunities(shifts: any[], trends: any[]) {
      // Combine shifts and trends to find "Arbitrage" opportunities
      // e.g. New Feature (Shift) + Rising Trend (Trend) = Opportunity
      
      if (shifts.length === 0 && trends.length === 0) return [];

      const prompt = `
        Based on the identified Algorithm Shifts and Market Trends, detect specific high-value opportunities for advertisers.
        Look for "first-mover advantage" gaps.
        
        SHIFTS: ${JSON.stringify(shifts)}
        TRENDS: ${JSON.stringify(trends)}
        
        Return a JSON array of opportunities:
        [
            {
                "platform": "string",
                "type": "opportunity_gap",
                "summary": "Description of the opportunity",
                "confidence": number,
                "impact_score": number,
                "recommended_action": "Specific tactic to execute"
            }
        ]
      `;

      const response = await this.ai.generateStrategy({}, prompt);
      return response.parsedJson || [];
  }

  /**
   * Risk Assessor: Evaluates compliance and platform stability risks
   */
  private async assessRisks(shifts: any[]) {
      // Filter for policy changes or negative shifts
      const policyShifts = shifts.filter(s => s.type === 'policy_change' || s.impact_score >= 7);
      
      if (policyShifts.length === 0) return [];

      const prompt = `
        Evaluate the following platform changes for Compliance Risks to advertisers.
        Flag any update that could lead to ad rejections, bans, or reduced reach if ignored.
        
        CHANGES: ${JSON.stringify(policyShifts)}
        
        Return a JSON array of risks:
        [
            {
                "platform": "string",
                "type": "compliance_risk",
                "summary": "Risk description",
                "confidence": number,
                "impact_score": number, // High score = High Danger
                "recommended_action": "What to avoid or change"
            }
        ]
      `;
      
      const response = await this.ai.generateStrategy({}, prompt);
      return response.parsedJson || [];
  }

  /**
   * Dispatches intelligence to the database and flags urgent items
   */
  private async dispatchIntelligence(items: any[]) {
    if (!items || items.length === 0) return;

    console.log(`Dispatching ${items.length} intelligence items...`);

    for (const item of items) {
      // 1. Log to Database
      const { data: inserted, error } = await this.supabase
        .from('ipe_intelligence_log')
        .insert({
          intelligence_type: item.type,
          platform: item.platform || 'General',
          summary: item.summary,
          details: item,
          priority: item.impact_score >= 8 ? 1 : item.impact_score >= 5 ? 2 : 3,
          recommended_actions: [item.recommended_action],
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Expires in 7 days
        })
        .select()
        .single();

      if (error) console.error('Error logging intelligence:', error);

      // 2. If Urgent (Priority 1), trigger notifications via Communication Service
      if (item.impact_score >= 8 && inserted) {
          console.log(`URGENT INTELLIGENCE DETECTED: ${item.summary}`);
          
          try {
             // Direct Call to Communication Service
             await this.communicationService.generateAlertMessage(inserted.id);
             // In a real system, we'd then push this to FCM/APNS or save to a 'notifications' table
          } catch (commError) {
             console.error("Failed to trigger communication service:", commError);
          }
      }
    }
  }
}
