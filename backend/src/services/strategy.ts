import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export interface GeneratedStrategy {
  title?: string;
  rationale?: string;
  platforms?: string[];
  content_pillars?: any[];
  schedule?: any[];
  estimated_outcomes?: any;
  risk_assessment?: any;
  [key: string]: any;
}

export const StrategyService = {
  /**
   * Fetches active strategy for a user
   */
  async getActiveStrategy(userId: string) {
    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  /**
   * Saves or updates a strategy
   */
  async saveStrategy(userId: string, strategyData: any) {
    const { data, error } = await supabase
      .from('strategies')
      .upsert({
        user_id: userId,
        ...strategyData,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};
