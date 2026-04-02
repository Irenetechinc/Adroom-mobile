
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import fetch from 'node-fetch';

type PlatformSource = { name: string; url: string; platform: string };

export class PlatformIntelligenceEngine {
  private ai: AIEngine;
  private supabase;
  private sources: PlatformSource[];

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
    this.sources = [];
  }

  /**
   * Main cycle for the Platform Intelligence Engine (Runs every 15 minutes)
   */
  async runCycle() {
    console.log('Starting Platform Intelligence Cycle...');
    
    // 1. Platform Monitor Service
    const rawData = await this.monitorPlatforms();
    
    if (rawData.length === 0) {
        console.log('No new platform updates found.');
        return;
    }

    // 2. Algorithm Detection Engine
    const shifts = await this.detectAlgorithmShifts(rawData);
    
    // 3. Trend Predictor
    const trends = await this.predictTrends(rawData);

    // 4. Opportunity Detector
    const opportunities = await this.detectOpportunities(shifts, trends);

    // 5. Risk Assessor
    const risks = await this.assessRisks(shifts);
    
    // 6. Store in Database
    await this.storeIntelligence(shifts, trends, opportunities, risks);
    
    const alerts = this.checkAlerts(shifts, trends, risks);

    console.log('Platform Intelligence Cycle Completed.');
    return { shifts, trends, opportunities, risks, alerts };
  }

  private checkAlerts(shifts: any[], trends: any[], risks: any[]) {
      const alerts = [];
      const criticalShifts = shifts.filter(s => s.confidence > 80 && s.type === 'algorithm_update');
      if (criticalShifts.length > 0) alerts.push({ type: 'CRITICAL_ALGO_UPDATE', data: criticalShifts });
      const highRisks = risks.filter(r => r.severity === 'high');
      if (highRisks.length > 0) alerts.push({ type: 'HIGH_RISK_DETECTED', data: highRisks });
      return alerts;
  }

  private async logSourceFailure(source: string, error: string) {
    console.error(`[IPE] Source Failure: ${source} - ${error}`);
    await this.supabase.from('system_logs').insert({
      level: 'error',
      module: 'IPE',
      message: 'Source monitoring failed',
      details: { source, error }
    });
  }

  /**
   * Monitors official blogs, dev docs, status pages, industry news
   */
  private async monitorPlatforms() {
    const results: any[] = [];
    
    const { data: dbSources } = await this.supabase
      .from('intelligence_sources')
      .select('*')
      .eq('is_active', true);

    this.sources = (dbSources || []) as PlatformSource[];
    if (this.sources.length === 0) {
      await this.logSourceFailure('intelligence_sources', 'No active intelligence sources configured');
      return results;
    }
    const allSources = this.sources;
    
    for (const source of allSources) {
      try {
        console.log(`Fetching from ${source.name}...`);
        const response = await fetch(source.url, { timeout: 10000 });
        if (response.ok) {
          const text = await response.text();
          const cleanText = text.replace(/<[^>]*>?/gm, ' ').substring(0, 15000); 
          
          results.push({ 
              source: source.name, 
              platform: source.platform, 
              content: cleanText,
              captured_at: new Date().toISOString()
          });
        } else {
            await this.logSourceFailure(source.name, `HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error: any) {
        await this.logSourceFailure(source.name, error.message || 'Unknown error');
      }
    }
    
    return results;
  }

  /**
   * Detects algorithm shifts and user behavior patterns
   */
  private async detectAlgorithmShifts(rawData: any[]) {
    if (rawData.length === 0) return [];

    const prompt = `
      Analyze the following text snippets from social media platform newsrooms/feeds.
      Focus on detecting:
      1. Algorithm changes that affect ORGANIC REACH.
      2. New features that enable interactive or immersive experiences.
      3. Shifts in USER BEHAVIOR (e.g., how people are reacting to certain content types).
      4. Policy changes regarding data privacy or ad-free experiences.
      
      DATA:
      ${JSON.stringify(rawData.map(d => ({ source: d.source, content: d.content.substring(0, 1500) })))} 
      
      Return a JSON array of detected shifts:
      [
        {
          "platform": "facebook" | "instagram" | "tiktok" | "linkedin" | "x",
          "type": "algorithm_update" | "feature_launch" | "policy_update" | "user_behavior_shift",
          "summary": "Short description of the change",
          "confidence": number (0-100),
          "impact_score": number (1-10),
          "organic_leverage": "How to exploit this for organic reach",
          "user_reaction_patterns": "How users are likely to react",
          "priorities": ["Video", "Text", "Images", "Live"]
        }
      ]
    `;

    try {
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || [];
    } catch (e: any) {
        await this.logSourceFailure('AI_ANALYSIS_SHIFTS', e.message);
        return [];
    }
  }

  /**
   * Generates short/medium/long-term predictions
   */
  private async predictTrends(rawData: any[]) {
    if (rawData.length === 0) return [];

    const prompt = `
      Based on the latest platform news, predict future trends.
      
      DATA:
      ${JSON.stringify(rawData.map(d => ({ source: d.source, content: d.content.substring(0, 500) })))}
      
      Return a JSON array of predictions:
      [
        {
          "platform": "string",
          "timeframe": "short_term" | "medium_term" | "long_term",
          "prediction": "Prediction text",
          "confidence": number,
          "trending_formats": ["Reels", "Carousel", "Stories"]
        }
      ]
    `;

    try {
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || [];
    } catch (e) {
        console.error("Error in predictTrends:", e);
        return [];
    }
  }

  /**
   * Identifies content gaps and underserved audiences
   */
  private async detectOpportunities(shifts: any[], trends: any[]) {
    if (shifts.length === 0 && trends.length === 0) return [];

    const prompt = `
      Based on these shifts and trends, identify "Arbitrage" opportunities for marketers.
      
      SHIFTS: ${JSON.stringify(shifts)}
      TRENDS: ${JSON.stringify(trends)}
      
      Return a JSON array of opportunities:
      [
        {
          "platform": "string",
          "opportunity": "Description",
          "gap_type": "content_gap" | "underserved_audience",
          "action": "What to do"
        }
      ]
    `;

    try {
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || [];
    } catch (e) {
        console.error("Error in detectOpportunities:", e);
        return [];
    }
  }

  /**
   * Monitors policy changes and enforcement patterns
   */
  private async assessRisks(shifts: any[]) {
    const policyShifts = shifts.filter(s => s.type === 'policy_update');
    
    if (policyShifts.length === 0) return [];

    const prompt = `
      Evaluate these policy changes for marketing risks.
      
      CHANGES: ${JSON.stringify(policyShifts)}
      
      Return a JSON array of risks:
      [
        {
          "platform": "string",
          "risk": "Description",
          "severity": "low" | "medium" | "high",
          "mitigation": "How to avoid"
        }
      ]
    `;
    
    try {
        const response = await this.ai.generateStrategy({}, prompt);
        return response.parsedJson || [];
    } catch (e) {
        console.error("Error in assessRisks:", e);
        return [];
    }
  }

  /**
   * Stores findings in the database
   */
  private async storeIntelligence(shifts: any[], trends: any[], opportunities: any[], risks: any[]) {
    const platforms = Array.from(new Set(this.sources.map(s => s.platform)));

    for (const platform of platforms) {
      const pShifts = shifts.filter(s => s.platform === platform);
      const pTrends = trends.filter(t => t.platform === platform);
      const pOpportunities = opportunities.filter(o => o.platform === platform);
      const pRisks = risks.filter(r => r.platform === platform);

      if (pShifts.length === 0 && pTrends.length === 0 && pOpportunities.length === 0 && pRisks.length === 0) continue;

      const algorithmPriorities = pShifts.map(s => s.priorities).flat().filter(Boolean);
      const trendingFormats = pTrends.map(t => t.trending_formats).flat().filter(Boolean);
      const predictions = pTrends.map(t => ({ timeframe: t.timeframe, prediction: t.prediction }));

      const { error } = await this.supabase
        .from('platform_intelligence')
        .insert({
          platform,
          algorithm_priorities: algorithmPriorities,
          trending_formats: trendingFormats,
          detected_shifts: pShifts,
          predictions: predictions,
          risks: pRisks,
          captured_at: new Date().toISOString(),
          optimal_times: null
        });

      if (error) console.error(`Error storing intelligence for ${platform}:`, error);
    }
  }
}
