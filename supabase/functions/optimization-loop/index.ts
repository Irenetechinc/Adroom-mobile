// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceSupabaseClient } from '../_shared/supabase-client.ts';
import { AIEngine } from '../_shared/ai-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Optimization Tiers based on PDF Strategy
const TIERS = {
  TIER_1: { name: 'Bid Adjustment', threshold: 0.8 }, // If ROAS < 0.8 * Target, adjust bid
  TIER_2: { name: 'Audience Refinement', threshold: 0.6 },
  TIER_3: { name: 'Creative Swap', threshold: 0.4 },
  TIER_4: { name: 'Strategy Pause', threshold: 0.2 },
  TIER_5: { name: 'Full Pivot', threshold: 0.1 }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Starting 6-Hour Organic Optimization Loop...');
    const supabase = getServiceSupabaseClient();
    const aiEngine = AIEngine.getInstance();

    // Fetch recent engagement logs and propose tuning actions (organic-only)
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: logs, error } = await supabase
      .from('engagement_logs')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const recommendations = [];

    // Aggregate sentiment and make tuning recommendations
    const negative = (logs || []).filter((l: any) => (l.sentiment ?? 0) < 0).length;
    const total = logs?.length || 0;
    const negativeRate = total ? negative / total : 0;

    let action = 'monitor_only';
    let reason = 'Stable engagement';
    if (negativeRate > 0.3) {
      action = 'engagement_tuning';
      reason = 'High negative sentiment detected in recent interactions (>30%)';
    }

    const recommendation = { type: action, reason, window: { since, total, negative, negativeRate } };
    await supabase.from('ai_decisions').insert({
      decision_type: 'organic_optimization',
      context: { window: since },
      intelligence_used: { logs_count: total },
      selected_option: recommendation,
      decision_time: new Date().toISOString(),
    });

    recommendations.push(recommendation);

    return new Response(JSON.stringify({ message: 'Organic optimization loop completed', recommendations }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Optimization Loop Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
