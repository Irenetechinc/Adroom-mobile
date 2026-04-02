// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabaseClient, getServiceSupabaseClient } from '../_shared/supabase-client.ts';
import { FacebookApi } from '../_shared/facebook-api.ts';

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
                const result = await FacebookApi.postContent(fbToken, pageId, post.content, post.imageUrl);
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

      // No paid budget or ROAS ingestion in organic-only system

      // --- SAVE UPDATES ---
      const updates: any = {};
      if (calendarUpdated) updates.content_calendar = calendar;
      // No spend/ROAS updates in organic-only system
      
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
