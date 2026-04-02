
import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';

export class CommunicationService {
  private supabase = getServiceSupabaseClient();
  private aiEngine = AIEngine.getInstance();

  async generateDailyReport(userId: string) {
    console.log(`Generating Daily Report for ${userId}...`);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: strategies, error: strategiesError } = await this.supabase
      .from('strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (strategiesError) {
      throw new Error(strategiesError.message);
    }

    if (!strategies || strategies.length === 0) {
      return 'No active strategies to report on.';
    }

    const { data: engagementLogs } = await this.supabase
      .from('engagement_logs')
      .select('interaction_type, sentiment, created_at')
      .eq('user_id', userId)
      .gte('created_at', since);

    const { data: platformIntel } = await this.supabase
      .from('platform_intelligence')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(5);

    const { data: conversationPatterns } = await this.supabase
      .from('conversation_patterns')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(3);

    const prompt = `
        You are AdRoom AI. Generate a concise, professional, and encouraging daily ORGANIC marketing report for the user.

        DATE: ${new Date().toLocaleDateString()}
        WINDOW: last 24 hours

        ACTIVE STRATEGIES (organic-only):
        ${JSON.stringify(strategies)}

        ENGAGEMENT LOGS (last 24h):
        ${JSON.stringify(engagementLogs || [])}

        RECENT PLATFORM INTELLIGENCE:
        ${JSON.stringify(platformIntel || [])}

        RECENT CONVERSATION PATTERNS:
        ${JSON.stringify(conversationPatterns || [])}

        REQUIREMENTS:
        - Start with a friendly greeting.
        - Summarize engagement trends (comments/messages sentiment/volume) if data is available.
        - Highlight the most promising organic strategy focus for today.
        - Mention any critical platform shifts or risks relevant to organic reach.
        - End with 1 specific recommended action for today.
        - Keep it under 200 words.
    `;

    // 4. Generate Text
    const reportText = await this.aiEngine.generateText(prompt);
    
    return reportText;
  }

  async generateAlertMessage(alertId: string) {
    if (!alertId) throw new Error('Alert ID required');

    const { data: alert, error } = await this.supabase
      .from('platform_intelligence')
      .select('*')
      .eq('id', alertId)
      .single();

    if (error || !alert) throw new Error('Alert not found');

    const prompt = `
        Rephrase this technical alert into a short, urgent push notification for a marketing user.
        Keep it under 100 characters if possible.
        
        PLATFORM: ${alert.platform}
        DETECTED_SHIFTS: ${JSON.stringify(alert.detected_shifts)}
        RISKS: ${JSON.stringify(alert.risks)}
    `;

    const notificationText = await this.aiEngine.generateText(prompt);

    return { 
        title: "AdRoom Alert", 
        body: notificationText.trim() 
    };
  }
}
