import { useCampaignStore } from '../campaignStore';
import { CampaignService } from '../../services/campaign';
import { CampaignObjective, CampaignStatus } from '../../types/campaign';

// Mock CampaignService
jest.mock('../../services/campaign', () => ({
  CampaignService: {
    getCampaigns: jest.fn(),
    createCampaign: jest.fn(),
  },
}));

describe('useCampaignStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCampaignStore.setState({
      campaigns: [],
      isLoading: false,
      error: null,
    });
  });

  it('should have initial state', () => {
    const state = useCampaignStore.getState();
    expect(state.campaigns).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetchCampaigns', () => {
    it('should fetch campaigns successfully', async () => {
      const mockCampaigns = [
        { id: '1', name: 'Campaign 1', status: 'ACTIVE' },
        { id: '2', name: 'Campaign 2', status: 'PAUSED' },
      ];
      (CampaignService.getCampaigns as jest.Mock).mockResolvedValue(mockCampaigns);

      await useCampaignStore.getState().fetchCampaigns();

      const state = useCampaignStore.getState();
      expect(state.campaigns).toEqual(mockCampaigns);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      (CampaignService.getCampaigns as jest.Mock).mockRejectedValue(new Error('Fetch failed'));

      await useCampaignStore.getState().fetchCampaigns();

      const state = useCampaignStore.getState();
      expect(state.campaigns).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Fetch failed');
    });
  });

  describe('createCampaign', () => {
    const input = {
      name: 'New Campaign',
      objective: CampaignObjective.OUTCOME_TRAFFIC,
      status: CampaignStatus.PAUSED,
    };

    it('should create campaign successfully', async () => {
      const mockCampaign = { ...input, id: '1', facebook_campaign_id: 'fb_123' };
      (CampaignService.createCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      await useCampaignStore.getState().createCampaign(input);

      const state = useCampaignStore.getState();
      expect(CampaignService.createCampaign).toHaveBeenCalledWith(input);
      expect(state.campaigns).toEqual([mockCampaign]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle create errors', async () => {
      (CampaignService.createCampaign as jest.Mock).mockRejectedValue(new Error('Creation failed'));

      await expect(useCampaignStore.getState().createCampaign(input)).rejects.toThrow('Creation failed');

      const state = useCampaignStore.getState();
      expect(state.campaigns).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Creation failed');
    });
  });
});
