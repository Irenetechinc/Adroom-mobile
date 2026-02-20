
import { supabase } from './supabase';
import { RemoteLogger } from './remoteLogger';

export interface GeneratedStrategy {
  free: any;
  paid: any;
  comparison: any;
}

export const StrategyService = {
  /**
   * Generates comprehensive marketing strategies using the AI Brain.
   */
  async generateStrategies(productId: string, goal: string, duration: number): Promise<GeneratedStrategy> {
    RemoteLogger.log('STRATEGY', `Generating strategies for product ${productId}, goal: ${goal}, duration: ${duration}`);

    try {
      const { data, error } = await supabase.functions.invoke('ai-brain', {
        body: {
          action: 'generate_strategy',
          payload: {
            productId,
            goal,
            duration,
            contextType: 'product'
          }
        }
      });

      if (error) {
        console.error('AI Strategy Generation Error:', error);
        throw new Error(error.message || 'Strategy Generation Failed');
      }

      if (!data) {
        throw new Error('No strategy data returned from AI');
      }

      RemoteLogger.log('STRATEGY', 'Generation complete');
      return data;
    } catch (error: any) {
      RemoteLogger.error('STRATEGY', 'Generation Error', error);
      throw error;
    }
  }
};
