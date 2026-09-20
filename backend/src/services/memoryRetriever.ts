
import { SupabaseClient } from '@supabase/supabase-js';

export interface MemoryContext {
  user: any;
  product?: any;
  service?: any;
  brand?: any;
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

    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 4. Fetch real-time platform intelligence, only recent entries.
    const { data: platformIntelligence } = await this.supabase
      .from('platform_intelligence')
      .select('*')
      .gte('captured_at', recentCutoff)
      .order('captured_at', { ascending: false })
      .limit(20);

    // 5. Fetch Social Listening from the last 7 days and filter by category if present.
    let socialQuery = this.supabase.from('social_conversations').select('*').gte('collected_at', recentCutoff).order('collected_at', { ascending: false }).limit(50);
    if (category) {
        socialQuery = socialQuery.eq('category', category);
    }
    const { data: socialListening } = await socialQuery;

    // 6. Fetch Emotional Intelligence from fresh signals only.
    let emotionalQuery = this.supabase.from('emotional_ownership').select('*').gte('detected_at', recentCutoff).order('detected_at', { ascending: false }).limit(25);
    if (category) {
        emotionalQuery = emotionalQuery.eq('category', category);
    }
    const { data: emotionalIntelligence } = await emotionalQuery;

    // 7. Fetch GEO Narrative only from recent snapshots.
    const { data: geoNarrative } = await this.supabase
        .from('narrative_snapshots')
        .select('*')
        .gte('captured_at', recentCutoff)
        .order('captured_at', { ascending: false })
        .limit(20);

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
