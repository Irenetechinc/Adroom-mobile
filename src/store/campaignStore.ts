import { create } from 'zustand';

interface Campaign {
  id: string;
  name: string;
  status: string;
  platform: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  created_at: string;
}

interface CampaignStore {
  campaigns: Campaign[];
  isLoading: boolean;
  fetchCampaigns: () => Promise<void>;
}

export const useCampaignStore = create<CampaignStore>((set) => ({
  campaigns: [],
  isLoading: false,
  fetchCampaigns: async () => {
    set({ isLoading: true });
    try {
      set({ campaigns: [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
