import { create } from 'zustand';
import { Campaign, CreateCampaignInput } from '../types/campaign';
import { CampaignService } from '../services/campaign';

interface CampaignState {
  campaigns: Campaign[];
  isLoading: boolean;
  error: string | null;

  fetchCampaigns: () => Promise<void>;
  createCampaign: (input: CreateCampaignInput) => Promise<void>;
  clearError: () => void;
}

export const useCampaignStore = create<CampaignState>((set, get) => ({
  campaigns: [],
  isLoading: false,
  error: null,

  fetchCampaigns: async () => {
    set({ isLoading: true, error: null });
    try {
      const campaigns = await CampaignService.getCampaigns();
      set({ campaigns, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createCampaign: async (input: CreateCampaignInput) => {
    set({ isLoading: true, error: null });
    try {
      const newCampaign = await CampaignService.createCampaign(input);
      set((state) => ({ 
        campaigns: [newCampaign, ...state.campaigns], 
        isLoading: false 
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
