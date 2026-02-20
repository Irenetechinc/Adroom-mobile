
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabaseClient } from '../_shared/supabase-client.ts';
import { PlatformIntelligenceEngine } from '../_shared/ipe-engine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Starting Platform Intelligence Job...');
    
    const supabase = getSupabaseClient(req);
    const ipe = new PlatformIntelligenceEngine(supabase);
    
    const result = await ipe.runCycle();
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error running IPE:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
