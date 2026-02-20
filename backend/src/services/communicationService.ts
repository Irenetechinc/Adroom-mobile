
import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';

export class CommunicationService {
  private supabase = getServiceSupabaseClient();
  private aiEngine = AIEngine.getInstance();

  async generateDailyReport(userId: string) {
    console.log(`Generating Daily Report for ${userId}...`);

    // 1. Fetch Yesterday's Performance Data
    const { data: strategies } = await this.supabase
        .from('strategy_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

    if (!strategies || strategies.length === 0) {
        return "No active strategies to report on.";
    }

    // 2. Fetch IPE Alerts
    const { data: alerts } = await this.supabase
        .from('ipe_intelligence_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);

    // 3. Construct Prompt
    const prompt = `
        You are AdRoom AI. Generate a concise, professional, and encouraging daily marketing report for the user.
        
        DATE: ${new Date().toLocaleDateString()}
        
        ACTIVE STRATEGIES:
        ${JSON.stringify(strategies.map(s => ({
            name: s.strategy_name,
            spend: s.total_spend,
            roas: s.roas,
            clicks: s.total_clicks,
            impressions: s.total_impressions
        })))}
        
        RECENT INTELLIGENCE/ALERTS:
        ${JSON.stringify(alerts)}
        
        REQUIREMENTS:
        - Start with a friendly greeting.
        - Summarize total spend and key results (ROAS, conversions).
        - Highlight the best performing strategy.
        - Mention any critical alerts or platform changes they need to know.
        - End with a recommended action for today.
        - Keep it under 200 words.
    `;

    // 4. Generate Text
    const reportText = await this.aiEngine.generateText(prompt);
    
    return reportText;
  }

  async generateAlertMessage(alertId: string) {
    if (!alertId) throw new Error('Alert ID required');

    const { data: alert } = await this.supabase
        .from('ipe_intelligence_log')
        .select('*')
        .eq('id', alertId)
        .single();

    if (!alert) throw new Error('Alert not found');

    const prompt = `
        Rephrase this technical alert into a short, urgent push notification for a marketing user.
        Keep it under 100 characters if possible.
        
        ALERT: ${alert.summary}
        DETAILS: ${JSON.stringify(alert.details)}
    `;

    const notificationText = await this.aiEngine.generateText(prompt);

    return { 
        title: "AdRoom Alert", 
        body: notificationText.trim() 
    };
  }
}
