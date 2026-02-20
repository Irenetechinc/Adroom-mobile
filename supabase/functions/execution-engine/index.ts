
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabaseClient, getServiceSupabaseClient } from '../_shared/supabase-client.ts';
import { FacebookAdsApi } from '../_shared/facebook-api.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Starting Execution Engine Job...');
    const supabase = getServiceSupabaseClient(); 

    // 1. Fetch Active Strategies with User Config
    const { data: strategies, error: strategyError } = await supabase
      .from('strategy_memory')
      .select(`
        *,
        user_memory:user_id (
            user_id
        )
      `)
      .eq('status', 'active');

    if (strategyError) throw strategyError;

    const results = [];

    for (const strategy of strategies) {
      console.log(`Processing strategy: ${strategy.strategy_name} (${strategy.strategy_id})`);
      
      // Get User's Ad Config
      const { data: adConfig } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', strategy.user_id)
        .single();

      const fbToken = adConfig?.access_token;
      const adAccountId = adConfig?.ad_account_id;
      const pageId = adConfig?.page_id;

      // --- CONTENT EXECUTION ---
      const calendar = strategy.content_calendar;
      let calendarUpdated = false;

      if (calendar && Array.isArray(calendar.posts)) {
        const now = new Date();
        const duePosts = calendar.posts.filter((post: any) => {
          const postTime = new Date(post.scheduled_time);
          return !post.posted && postTime <= now && postTime > new Date(now.getTime() - 60 * 60 * 1000);
        });

        for (const post of duePosts) {
          console.log(`Executing post: ${post.id} for platform ${post.platform}`);
          try {
            if (post.platform.includes('facebook') && fbToken && pageId) {
                // Real API Call
                const result = await FacebookAdsApi.postContent(fbToken, pageId, post.content, post.imageUrl);
                post.platform_post_id = result.id;
                results.push({ strategyId: strategy.strategy_id, postId: post.id, status: 'executed', platformId: result.id });
            } else {
                // If no token, we can't post. Log error.
                // We do NOT simulate success anymore.
                throw new Error("Missing Facebook configuration or token.");
            }
            
            post.posted = true;
            post.posted_at = new Date().toISOString();
            calendarUpdated = true;
          } catch (postError) {
            console.error(`Failed to execute post ${post.id}:`, postError);
            results.push({ strategyId: strategy.strategy_id, postId: post.id, status: 'failed', error: postError.message });
          }
        }
      }

      // --- BUDGET & METRICS INGESTION (For PAID Strategies) ---
      let metricsUpdated = false;
      let newTotalSpend = strategy.total_spend || 0;
      let currentROAS = strategy.roas || 0;

      if (strategy.strategy_version === 'paid' && strategy.budget_daily > 0) {
        if (fbToken && adAccountId) {
            try {
                // Real API Fetch
                const insights = await FacebookAdsApi.getCampaignInsights(fbToken, adAccountId, strategy.platform_campaign_id);
                
                if (insights) {
                    const spend = parseFloat(insights.spend || '0');
                    const revenue = parseFloat(insights.action_values?.[0]?.value || '0'); // Simplified revenue check
                    
                    newTotalSpend = spend; // Update with ACTUAL total spend from platform
                    currentROAS = spend > 0 ? revenue / spend : 0;
                    
                    metricsUpdated = true;
                    results.push({ strategyId: strategy.strategy_id, type: 'metrics_update', spend, roas: currentROAS });
                }
            } catch (apiError) {
                console.error(`Failed to fetch metrics for ${strategy.strategy_id}:`, apiError);
                // Do NOT fallback to random data. Keep existing values.
            }
        } else {
             console.warn(`Skipping metrics fetch for ${strategy.strategy_id}: No Ad Config`);
        }
        
        // Budget Guardrails (using Real or Last Known Spend)
        if (newTotalSpend >= strategy.budget_total) {
            console.log(`Budget Exhausted for ${strategy.strategy_name}. Pausing.`);
            await supabase.from('strategy_memory')
                .update({ status: 'paused', notes: (strategy.notes || '') + '\n[System] Paused due to budget exhaustion.' })
                .eq('strategy_id', strategy.strategy_id);
                
            await supabase.from('ipe_intelligence_log').insert({
                 intelligence_type: 'budget_exhausted',
                 priority: 1,
                 platform: 'system',
                 summary: `Strategy Paused: ${strategy.strategy_name} reached budget limit.`,
                 details: { strategy_id: strategy.strategy_id },
                 affected_strategies: [strategy.strategy_id]
             });
             continue;
        }
      }

      // --- SAVE UPDATES ---
      const updates: any = {};
      if (calendarUpdated) updates.content_calendar = calendar;
      if (metricsUpdated) {
          updates.total_spend = newTotalSpend;
          updates.roas = currentROAS;
      }
      
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('strategy_memory')
          .update(updates)
          .eq('strategy_id', strategy.strategy_id);
          
        if (updateError) console.error(`Failed to update strategy ${strategy.strategy_id}:`, updateError);
      }
    }

    return new Response(JSON.stringify({ message: 'Execution cycle completed', results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Execution Engine Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
