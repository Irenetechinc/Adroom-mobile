
import { SupabaseClient } from '@supabase/supabase-js';

export interface MemoryContext {
  user: any;
  product?: any;
  service?: any;
  history: any[];
  platformStatus: any;
  globalTrends: any;
  platformIntelligence: any[];
  socialListening: any[];
  emotionalIntelligence: any[];
  geoNarrative: any[];
}

export class MemoryRetriever {
  private supabase: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.supabase = client;
  }

  /**
   * Retrieves ALL relevant memory for a specific user and context (product/service)
   */
  async getAllContext(userId: string, contextId?: string, contextType: 'product' | 'service' | 'brand' = 'product'): Promise<MemoryContext> {
    console.log(`Retrieving memory for user: ${userId}, context: ${contextType} ${contextId}`);

    // 1. Fetch User Memory
    const { data: userMemory } = await this.supabase
      .from('users') // Changed from user_memory to users as per spec (users table exists)
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    // 2. Fetch Context (Product/Service/Brand)
    let contextData = null;
    let category = null;
    if (contextId) {
      const table = contextType === 'product' ? 'products' : 'strategies'; // Simplified mapping
      
      const { data } = await this.supabase
        .from(table)
        .select('*')
        .eq('id', contextId)
        .maybeSingle();
        
      contextData = data;
      category = data?.category;
    }

    // 3. Fetch Strategy History (Last 5 relevant strategies)
    const { data: history } = await this.supabase
      .from('strategies')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    // 4. Fetch Platform Intelligence (Real-time)
    const { data: platformIntelligence } = await this.supabase
      .from('platform_intelligence')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(5);

    // 5. Fetch Social Listening (Last 24h or recent)
    let socialQuery = this.supabase.from('social_conversations').select('*').order('collected_at', { ascending: false }).limit(20);
    if (category) {
        socialQuery = socialQuery.eq('category', category);
    }
    const { data: socialListening } = await socialQuery;

    // 6. Fetch Emotional Intelligence
    let emotionalQuery = this.supabase.from('emotional_ownership').select('*').order('detected_at', { ascending: false }).limit(10);
    if (category) {
        emotionalQuery = emotionalQuery.eq('category', category);
    }
    const { data: emotionalIntelligence } = await emotionalQuery;

    // 7. Fetch GEO Narrative (Narrative Snapshots)
    // Assuming brand_id links to user_id or product
    const { data: geoNarrative } = await this.supabase
        .from('narrative_snapshots')
        .select('*')
        // .eq('brand_id', userId) // optional filter
        .order('captured_at', { ascending: false })
        .limit(5);

    // 8. Global Trends (Keep existing if table exists, otherwise skip)
    // The spec doesn't mention removing global_strategy_memory, so we keep it if useful, 
    // but the new engines provide better data.
    
    return {
      user: userMemory || {},
      [contextType]: contextData,
      history: history || [],
      platformStatus: [], // Deprecated in favor of platformIntelligence
      globalTrends: [], // Deprecated
      platformIntelligence: platformIntelligence || [],
      socialListening: socialListening || [],
      emotionalIntelligence: emotionalIntelligence || [],
      geoNarrative: geoNarrative || []
    };
  }
}
