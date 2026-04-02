import { AutonomousService } from '../autonomous';
import { Strategy } from '../../types/agent';

jest.mock('../facebook', () => ({
  FacebookService: {
    getConfig: jest.fn(),
    createPost: jest.fn(),
  },
}));
jest.mock('../creative', () => ({
  CreativeService: {
    generateCopy: jest.fn().mockResolvedValue({ headline: 'Test Headline', body: 'Test Body' }),
  }
}));

describe('AutonomousService', () => {
  const mockStrategy: Strategy = {
    id: 'strategy_1',
    title: 'Test Strategy',
    description: 'Test Description',
    targetAudience: 'Gen Z',
    platforms: ['Facebook'],
    estimatedReach: '1000',
    actions: [],
    lifespanWeeks: 4,
    brandVoice: 'Playful',
    keyMessage: 'Buy this now',
    assets: []
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when brandVoice is missing', async () => {
    await expect(
      AutonomousService.executeStrategy({ ...mockStrategy, brandVoice: '' } as any)
    ).rejects.toThrow('Strategy brandVoice is required.');
  });

  it('posts to Facebook when config exists', async () => {
    const { FacebookService } = require('../facebook');
    FacebookService.getConfig.mockResolvedValue({
      page_id: 'page_1',
      access_token: 'token_1',
    });
    FacebookService.createPost.mockResolvedValue('post_1');

    await AutonomousService.executeStrategy(mockStrategy, 'https://example.com/image.png');

    expect(FacebookService.createPost).toHaveBeenCalledWith(
      'page_1',
      expect.stringContaining('Test Headline'),
      'https://example.com/image.png',
      'token_1'
    );
  });

  it('throws when config is missing', async () => {
    const { FacebookService } = require('../facebook');
    FacebookService.getConfig.mockResolvedValue(null);

    await expect(AutonomousService.executeStrategy(mockStrategy)).rejects.toThrow('Facebook config missing.');
  });
});
