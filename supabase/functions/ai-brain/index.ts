
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabaseClient } from '../_shared/supabase-client.ts';
import { AIEngine } from '../_shared/ai-models.ts';
import { MemoryRetriever } from '../_shared/memory-retriever.ts';
import { DecisionEngine } from '../_shared/decision-engine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();
    const supabase = getSupabaseClient(req);
    const aiEngine = AIEngine.getInstance();
    const memoryRetriever = new MemoryRetriever(supabase);
    const decisionEngine = new DecisionEngine();

    // Get user ID from the request context (Supabase Auth)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    console.log(`Processing action: ${action} for user: ${userId}`);

    let result;

    switch (action) {
      case 'scan_product':
        // Payload: { imageBase64: string }
        if (!payload.imageBase64) throw new Error('Image data required');
        
        const scanPrompt = `
          Analyze this product image in extreme detail.
          Extract every possible piece of information.
          Return JSON with:
          - product_type (what kind of product is this)
          - brand (any visible brand name/logo)
          - color (primary and secondary colors)
          - visible_features (array of visible features/attributes)
          - product_name (any name visible or infer best name)
          - estimated_size (relative size, dimensions if visible)
          - category (broader category like electronics, clothing, etc.)
          - material (if visible/apparent)
          - condition (new, used, etc. if apparent)
          - packaging (is it in packaging, what kind)
          - text_detected (any text visible on product/packaging)
          - suggested_target_audience (who would buy this, based on visual)
          - suggested_price_range (estimated based on appearance)
          - quality_score (1-10, how clear/useful this image is for analysis)
        `;
        
        const scanResult = await aiEngine.analyzeImage(payload.imageBase64, scanPrompt);
        result = scanResult.parsedJson || { text: scanResult.text };
        break;

      case 'generate_strategy':
        // Payload: { goal: string, duration: number, productId: string, contextType: 'product'|'service' }
        if (!payload.goal || !payload.duration || !payload.productId) throw new Error('Missing required fields');
        
        // 1. Retrieve Context
        const memoryContext = await memoryRetriever.getAllContext(userId, payload.productId, payload.contextType || 'product');
        
        // 2. Generate Strategies
        const strategies = await decisionEngine.generateStrategy(memoryContext, payload.goal, payload.duration);
        
        result = strategies;
        break;

      case 'chat':
        // Payload: { message: string, contextId?: string }
        // Basic chat implementation - needs more context awareness
        const chatPrompt = `
          You are AdRoom AI. Respond to the user's message: "${payload.message}".
          Be helpful, professional, and data-driven.
        `;
        const chatResponse = await aiEngine.generateStrategy({}, chatPrompt); // Reusing strategy gen for now as it uses GPT
        result = { message: chatResponse.text };
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error processing request:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
