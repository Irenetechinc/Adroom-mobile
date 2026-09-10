
import { supabase } from './supabase';
import { RemoteLogger } from './remoteLogger';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

export interface GeneratedStrategy {
  strategy: any;
  strategyId?: string;
  productId?: string;
}

export const StrategyService = {
  async getConnectedAccounts(): Promise<Array<{ platform: string; name?: string }>> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !BACKEND_URL) throw new Error('User not authenticated');
    const response = await fetch(`${BACKEND_URL}/api/platform-configs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load connected accounts');
    return Object.values(data.configs || {}).map((config: any) => ({
      platform: config.platform,
      name: config.page_name || config.account_name || config.platform,
    }));
  },

  /**
   * Generates comprehensive marketing strategies using the AI Brain.
   */
  async generateStrategies(productId: string, goal: string, duration: number, options?: {
    selectedAccounts?: string[];
    productType?: 'physical' | 'digital';
    dispatchAddress?: string;
    product?: {
      name?: string;
      description?: string;
      category?: string;
      targetAudience?: string;
      price?: string;
      currency?: string;
      websiteUrl?: string;
      videoUri?: string | null;
    };
  }): Promise<GeneratedStrategy> {
    RemoteLogger.log('STRATEGY', `Generating strategies for product ${productId}, goal: ${goal}, duration: ${duration}`);

    try {
      if (!BACKEND_URL) {
        throw new Error('Backend URL is not configured');
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(`${BACKEND_URL}/api/ai/generate-strategy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          productId,
          goal,
          duration,
          contextType: 'product',
          selectedAccounts: options?.selectedAccounts,
          productType: options?.productType,
          dispatchAddress: options?.dispatchAddress,
          product: options?.product,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('AI Strategy Generation Error:', data);
        throw new Error(data.error || 'Strategy Generation Failed');
      }

      RemoteLogger.log('STRATEGY', 'Generation complete');
      return data;
    } catch (error: any) {
      RemoteLogger.error('STRATEGY', 'Generation Error', error);
      throw error;
    }
  }
};
