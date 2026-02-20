
import { SupabaseClient } from '@supabase/supabase-js';

export interface MemoryContext {
  user: any;
  product?: any;
  service?: any;
  history: any[];
  platformStatus: any;
  globalTrends: any;
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
    const { data: userMemory, error: userError } = await this.supabase
      .from('user_memory')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (userError) console.error('Error fetching user memory:', userError);

    // 2. Fetch Context (Product/Service/Brand)
    let contextData = null;
    if (contextId) {
      const table = contextType === 'product' ? 'product_memory' : 
                    contextType === 'service' ? 'service_memory' : 'brand_memory';
      const idField = `${contextType}_id`;
      
      const { data, error } = await this.supabase
        .from(table)
        .select('*')
        .eq(idField, contextId)
        .single();
        
      if (error) console.error(`Error fetching ${contextType} memory:`, error);
      contextData = data;
    }

    // 3. Fetch Strategy History (Last 5 relevant strategies)
    const { data: history, error: historyError } = await this.supabase
      .from('strategy_memory')
      .select('strategy_id, goal, status, roas, total_spend, platform_data, outcomes')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (historyError) console.error('Error fetching strategy history:', historyError);

    // 4. Fetch Platform Memory (Global Intelligence)
    const { data: platformData, error: platformError } = await this.supabase
      .from('platform_memory')
      .select('*');

    if (platformError) console.error('Error fetching platform memory:', platformError);

    // 5. Fetch Global Strategy Trends (Aggregated)
    let globalQuery = this.supabase.from('global_strategy_memory').select('*');
    if (contextData?.category) {
        globalQuery = globalQuery.eq('category', contextData.category);
    }
    const { data: globalTrends, error: globalError } = await globalQuery.limit(10);

    if (globalError) console.error('Error fetching global trends:', globalError);

    return {
      user: userMemory || {},
      [contextType]: contextData,
      history: history || [],
      platformStatus: platformData || [],
      globalTrends: globalTrends || []
    };
  }
}
