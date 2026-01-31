import { create } from 'zustand';
import { FacebookConfig, FacebookConfigInput } from '../types/facebook';
import { FacebookService } from '../services/facebook';

interface SettingsState {
  facebookConfig: FacebookConfig | null;
  isLoading: boolean;
  error: string | null;
  
  fetchConfig: () => Promise<void>;
  saveConfig: (input: FacebookConfigInput) => Promise<void>;
  clearError: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  facebookConfig: null,
  isLoading: false,
  error: null,

  fetchConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await FacebookService.getConfig();
      set({ facebookConfig: config, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  saveConfig: async (input: FacebookConfigInput) => {
    set({ isLoading: true, error: null });
    try {
      await FacebookService.validateCredentials(input);
      // 2. Save to Supabase
      const config = await FacebookService.saveConfig(
        input.page_id,
        input.page_name || '',
        input.ad_account_id,
        input.access_token
      );
      
      set({ facebookConfig: config, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error; // Re-throw to handle in UI
    }
  },

  clearError: () => set({ error: null }),
}));
