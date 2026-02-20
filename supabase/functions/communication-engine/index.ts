
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceSupabaseClient } from '../_shared/supabase-client.ts';
import { AIEngine } from '../_shared/ai-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, userId, alertId } = await req.json();
    const supabase = getServiceSupabaseClient();
    const aiEngine = AIEngine.getInstance();

    if (action === 'generate_daily_report') {
        console.log(`Generating Daily Report for ${userId}...`);

        // 1. Fetch Yesterday's Performance Data
        const { data: strategies } = await supabase
            .from('strategy_memory')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active');

        if (!strategies || strategies.length === 0) {
            return new Response(JSON.stringify({ report: "No active strategies to report on." }), { headers: corsHeaders });
        }

        // 2. Fetch IPE Alerts
        const { data: alerts } = await supabase
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
        const reportText = await aiEngine.generateText(prompt);
        
        return new Response(JSON.stringify({ report: reportText }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (action === 'generate_alert_message') {
        if (!alertId) throw new Error('Alert ID required');

        const { data: alert } = await supabase
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

        const notificationText = await aiEngine.generateText(prompt);

        return new Response(JSON.stringify({ 
            title: "AdRoom Alert", 
            body: notificationText.trim() 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: corsHeaders });

  } catch (error) {
    console.error('Communication Engine Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
