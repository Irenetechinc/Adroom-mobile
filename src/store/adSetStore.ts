import { create } from 'zustand';
import { AdSet, CreateAdSetInput } from '../types/adSet';
import { AdSetService } from '../services/adSet';

interface AdSetState {
  adSets: AdSet[];
  isLoading: boolean;
  error: string | null;

  fetchAdSets: (campaignId: string) => Promise<void>;
  createAdSet: (input: CreateAdSetInput) => Promise<void>;
  clearError: () => void;
}

export const useAdSetStore = create<AdSetState>((set) => ({
  adSets: [],
  isLoading: false,
  error: null,

  fetchAdSets: async (campaignId: string) => {
    set({ isLoading: true, error: null });
    try {
      const adSets = await AdSetService.getAdSets(campaignId);
      set({ adSets, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createAdSet: async (input: CreateAdSetInput) => {
    set({ isLoading: true, error: null });
    try {
      const newAdSet = await AdSetService.createAdSet(input);
      set((state) => ({ 
        adSets: [newAdSet, ...state.adSets], 
        isLoading: false 
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
