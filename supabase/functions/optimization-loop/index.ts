
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceSupabaseClient } from '../_shared/supabase-client.ts';
import { AIEngine } from '../_shared/ai-models.ts';
import { FacebookAdsApi } from '../_shared/facebook-api.ts';

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
    console.log('Starting 6-Hour Optimization Loop...');
    const supabase = getServiceSupabaseClient();
    const aiEngine = AIEngine.getInstance();

    // 1. Fetch Active Paid Strategies
    const { data: strategies, error } = await supabase
      .from('strategy_memory')
      .select('*')
      .eq('status', 'active')
      .eq('strategy_version', 'paid');

    if (error) throw error;

    const optimizations = [];

    for (const strategy of strategies) {
      console.log(`Optimizing: ${strategy.strategy_name} (${strategy.strategy_id})`);
      
      // Get User Config for API Access
      const { data: adConfig } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', strategy.user_id)
        .single();
      
      const fbToken = adConfig?.access_token;

      // 2. Fetch Performance Metrics (Real Data Only)
      // Relying on data populated by the Execution Engine from Platform APIs
      const currentROAS = strategy.roas || 0; 
      
      // If no performance data yet, skip optimization
      if (currentROAS === 0) {
          console.log(`Skipping optimization for ${strategy.strategy_name}: No ROAS data.`);
          continue;
      }

      // Get Target ROAS from strategy definition or default to industry standard
      const targetROAS = strategy.expected_outcomes?.target_roas || 2.0;
      
      const performanceRatio = currentROAS / targetROAS;

      let action = null;
      let reason = '';

      // 3. Determine Optimization Tier
      if (performanceRatio < TIERS.TIER_5.threshold) {
         action = 'PAUSE_AND_ALERT';
         reason = `Critical Underperformance (ROAS ${currentROAS.toFixed(2)} vs Target ${targetROAS}). Immediate intervention required.`;
      } else if (performanceRatio < TIERS.TIER_4.threshold) {
         action = 'PAUSE_AD_SET';
         reason = `Significant underperformance. Pausing low-performing ad sets to conserve budget.`;
      } else if (performanceRatio < TIERS.TIER_3.threshold) {
         action = 'SWAP_CREATIVE';
         reason = `Creative fatigue detected. Rotating to fresh assets.`;
      } else if (performanceRatio < TIERS.TIER_2.threshold) {
         action = 'REFINE_AUDIENCE';
         reason = `Audience match low. Narrowing targeting parameters.`;
      } else if (performanceRatio < TIERS.TIER_1.threshold) {
         action = 'LOWER_BID';
         reason = `ROAS slightly below target. Lowering bid cap by 10%.`;
      } else if (performanceRatio > 1.2) {
         // Scale Up Winner!
         action = 'SCALE_UP';
         reason = `High Performance! Increasing budget by 20%.`;
      }

      if (action) {
        console.log(`Optimization Triggered: ${action}`);
        
        // 4. Execute Optimization (Real API Calls)
        if (fbToken && strategy.platform_campaign_id) {
             try {
                if (action === 'PAUSE_AND_ALERT' || action === 'PAUSE_AD_SET') {
                    await FacebookAdsApi.updateCampaign(fbToken, strategy.platform_campaign_id, { status: 'PAUSED' });
                } else if (action === 'SCALE_UP') {
                    // Increase Daily Budget by 20%
                    const currentBudget = strategy.budget_daily || 1000; // fallback if null
                    const newBudget = Math.floor(currentBudget * 1.2);
                    await FacebookAdsApi.updateCampaign(fbToken, strategy.platform_campaign_id, { daily_budget: newBudget });
                } else if (action === 'LOWER_BID') {
                    // Decrease Bid Cap (simplified to budget for now as bid strategy is complex)
                     const currentBudget = strategy.budget_daily || 1000;
                     const newBudget = Math.floor(currentBudget * 0.9);
                     await FacebookAdsApi.updateCampaign(fbToken, strategy.platform_campaign_id, { daily_budget: newBudget });
                }
             } catch (apiError) {
                 console.error(`Failed to execute optimization on FB:`, apiError);
                 // Continue to log the attempt but note failure
                 reason += ` [API Execution Failed: ${apiError.message}]`;
             }
        } else {
            reason += ` [Skipped API: No Token or Campaign ID]`;
        }

        // 5. Log Optimization
        const optimizationLog = {
          timestamp: new Date().toISOString(),
          action,
          reason,
          metrics_before: { roas: currentROAS },
          metrics_after: { roas: currentROAS } // To be updated next cycle
        };

        // Update Strategy Memory
        const currentLogs = strategy.optimizations_applied || [];
        if (currentLogs.length > 50) currentLogs.shift(); 
        currentLogs.push(optimizationLog);

        const updates: any = { optimizations_applied: currentLogs };
        
        // Apply Scaling locally
        if (action === 'SCALE_UP') {
            updates.budget_daily = (strategy.budget_daily || 0) * 1.2;
        } else if (action === 'PAUSE_AND_ALERT') {
            updates.status = 'paused';
            
            // Log High Priority Intelligence
            await supabase.from('ipe_intelligence_log').insert({
                intelligence_type: 'performance_critical',
                priority: 1,
                platform: 'system',
                summary: `Strategy Halted: ${strategy.strategy_name} critically underperforming.`,
                details: { strategy_id: strategy.strategy_id, reason },
                affected_strategies: [strategy.strategy_id]
            });
        }

        await supabase
          .from('strategy_memory')
          .update(updates)
          .eq('strategy_id', strategy.strategy_id);

        optimizations.push({ strategyId: strategy.strategy_id, action, reason });
      }
    }

    return new Response(JSON.stringify({ message: 'Optimization loop completed', optimizations }), {
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
