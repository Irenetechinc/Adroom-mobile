
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
    console.log('Starting Learning Loop...');
    const supabase = getServiceSupabaseClient();
    const aiEngine = AIEngine.getInstance();

    // 1. Fetch Recently Completed Strategies (Last 24 hours)
    // In a real scheduler, we'd run this daily at midnight
    const { data: strategies, error } = await supabase
      .from('strategy_memory')
      .select(`
        *,
        product_memory:product_id (*)
      `)
      .in('status', ['completed', 'paused']) // Analyze finished or failed runs
      // .gt('updated_at', yesterday) // Filter for recent completion
      .order('updated_at', { ascending: false })
      .limit(10); // Process in batches

    if (error) throw error;

    const insights = [];

    for (const strategy of strategies) {
      console.log(`Analyzing strategy: ${strategy.strategy_name} (${strategy.strategy_id})`);

      // 2. Prepare Data for AI Analysis
      const performanceData = {
        goal: strategy.goal,
        duration: strategy.duration_days,
        spend: strategy.total_spend,
        roas: strategy.roas,
        clicks: strategy.total_clicks,
        impressions: strategy.total_impressions,
        platform_breakdown: strategy.platform_data,
        optimizations: strategy.optimizations_applied,
        product_category: strategy.product_memory?.category
      };

      const prompt = `
        Analyze the performance of this marketing strategy.
        Identify specific patterns that led to success or failure.
        
        DATA:
        ${JSON.stringify(performanceData)}
        
        TASK:
        Extract 3-5 key learnings in JSON format:
        {
          "patterns": [
            { 
              "type": "positive" | "negative",
              "insight": "Video ads on TikTok outperformed images by 40%",
              "confidence": 0.9,
              "applicability": "category_specific" | "global" 
            }
          ],
          "suggested_profile_update": {
             "performance_patterns": { ...new patterns to merge into user profile... }
          }
        }
      `;

      // 3. Generate Learnings
      const analysis = await aiEngine.generateStrategy({}, prompt); // Reuse strategy gen model
      const learnings = analysis.parsedJson;

      if (learnings) {
          // 4. Update User Memory (Profile) with new patterns
          if (learnings.suggested_profile_update) {
              // We need to fetch current profile first to merge
              const { data: userProfile } = await supabase
                  .from('user_memory')
                  .select('performance_patterns')
                  .eq('user_id', strategy.user_id)
                  .single();
                  
              const currentPatterns = userProfile?.performance_patterns || {};
              const newPatterns = { ...currentPatterns, ...learnings.suggested_profile_update.performance_patterns };
              
              await supabase
                  .from('user_memory')
                  .update({ performance_patterns: newPatterns })
                  .eq('user_id', strategy.user_id);
          }

          // 5. Update Global Strategy Memory (Aggregated)
          // If the insight is "global", we update the global knowledge base
          for (const pattern of learnings.patterns) {
              if (pattern.applicability === 'global' && pattern.confidence > 0.8) {
                  // Naive update: just log it for now. 
                  // In a real system, we'd have a 'knowledge_graph' table.
                  console.log(`Global Insight Found: ${pattern.insight}`);
                  
                  // Update Global Stats if high performance
                  if (strategy.roas > 3.0) {
                      // Fetch current global stats for this category
                      const { data: globalStats } = await supabase
                          .from('global_strategy_memory')
                          .select('*')
                          .eq('category', strategy.product_memory?.category || 'General')
                          .single();
                          
                      if (globalStats) {
                          // Update average
                          const newCount = (globalStats.total_strategies_run || 0) + 1;
                          const newAvgRoas = ((globalStats.average_roas || 0) * (newCount - 1) + strategy.roas) / newCount;
                          
                          await supabase
                              .from('global_strategy_memory')
                              .update({ 
                                  total_strategies_run: newCount,
                                  average_roas: newAvgRoas
                              })
                              .eq('id', globalStats.id);
                      }
                  }
              }
          }
          
          insights.push({ strategyId: strategy.strategy_id, learnings });
      }
    }

    return new Response(JSON.stringify({ message: 'Learning loop completed', insights }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Learning Loop Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
