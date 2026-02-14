import { AutonomousService } from '../autonomous';
import { CampaignService } from '../campaign';
import { AdSetService } from '../adSet';
import { AdService } from '../ad';
import { CampaignObjective, CampaignStatus } from '../../types/campaign';
import { Strategy } from '../../types/agent';

// Mock dependencies
jest.mock('../campaign');
jest.mock('../adSet');
jest.mock('../ad');
jest.mock('../creative', () => ({
  CreativeService: {
    generateCopy: jest.fn().mockResolvedValue({ headline: 'Test Headline', body: 'Test Body' }),
    generateCreative: jest.fn().mockResolvedValue('https://test.com/creative.png')
  }
}));

describe('AutonomousService', () => {
  const mockStrategy: Strategy = {
    id: 'paid_1',
    type: 'PAID',
    title: 'Test Strategy',
    description: 'Test Description',
    platforms: ['Facebook'],
    estimatedReach: '1000',
    cost: '$10',
    budget: 2000,
    actions: [],
    // New fields
    lifespanWeeks: 4,
    targetAudience: 'Gen Z',
    brandVoice: 'Playful',
    keyMessage: 'Buy this now',
    assets: []
  };

  const mockImageUrl = 'https://example.com/image.png';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should execute organic strategy correctly', async () => {
    const organicStrategy: Strategy = { ...mockStrategy, type: 'FREE' };
    
    await AutonomousService.executeStrategy(organicStrategy);

    expect(CampaignService.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('[Organic]'),
        objective: CampaignObjective.OUTCOME_AWARENESS,
        status: CampaignStatus.ACTIVE,
      }),
      true
    );
    expect(AdSetService.createAdSet).not.toHaveBeenCalled();
  });

  it('should throw error if image is missing for paid strategy', async () => {
    await expect(AutonomousService.executeStrategy(mockStrategy)).rejects.toThrow('Product image is required');
  });

  it('should execute paid strategy correctly', async () => {
    // Mock successful responses
    (CampaignService.createCampaign as jest.Mock).mockResolvedValue({ id: 'camp_1', facebook_campaign_id: 'fb_camp_1' });
    (AdSetService.createAdSet as jest.Mock).mockResolvedValue({ id: 'adset_1', facebook_ad_set_id: 'fb_adset_1', name: 'Auto Ad Set' });
    (AdService.createAd as jest.Mock).mockResolvedValue({ id: 'ad_1', facebook_ad_id: 'fb_ad_1', name: 'Ad' });

    await AutonomousService.executeStrategy(mockStrategy, mockImageUrl);

    // Verify Campaign Creation
    expect(CampaignService.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('[Auto-Paid]'),
        objective: CampaignObjective.OUTCOME_SALES,
      })
    );

    // Verify Ad Set Creation
    expect(AdSetService.createAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: 'camp_1',
        facebook_campaign_id: 'fb_camp_1',
        daily_budget: 2000,
      })
    );

    // Verify Ad Creation (and use of real image URL and generated copy)
    expect(AdService.createAd).toHaveBeenCalledWith(
      expect.objectContaining({
        ad_set_id: 'adset_1',
        facebook_ad_set_id: 'fb_adset_1',
        creative: expect.objectContaining({
          image_url: mockImageUrl,
          title: 'Test Headline', // From mocked CreativeService
          body: 'Test Body',      // From mocked CreativeService
        }),
      })
    );
  });
});
