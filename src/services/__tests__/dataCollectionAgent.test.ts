import {
  buildDynamicCollectionPrompt,
  rankAndVerifyCollectedData,
} from '../../../backend/src/services/dataCollectionAgent';

describe('DataCollectionAgent', () => {
  it('creates a dynamic request prompt from the current strategy and live data need', () => {
    const prompt = buildDynamicCollectionPrompt({
      strategyId: 'strategy_123',
      strategyGoal: 'launch and demand capture',
      productName: 'GlowLift Serum',
      category: 'skincare',
      dataNeed: 'pricing, competitor reviews, and user pain points',
      audience: 'women 25-45',
      marketContext: 'retention challenge in crowded skincare category',
    });

    expect(prompt).toContain('GlowLift Serum');
    expect(prompt).toContain('pricing');
    expect(prompt).toContain('Return JSON');
  });

  it('keeps only fresh, high-quality evidence and rejects stale sources', () => {
    const result = rankAndVerifyCollectedData(
      [
        {
          title: 'Recent reddit discussion',
          source: 'reddit',
          snippet: 'People love the quick glow and texture.',
          capturedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          url: 'https://example.com/recent',
          trustScore: 0.82,
        },
        {
          title: 'Old blog article',
          source: 'blog',
          snippet: 'Old pricing notes from last year.',
          capturedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
          url: 'https://example.com/old',
          trustScore: 0.54,
        },
      ],
      { maxAgeHours: 24 },
    );

    expect(result.verified.some(item => item.source === 'reddit')).toBe(true);
    expect(result.rejected.some(item => item.reason.includes('stale'))).toBe(true);
    expect(result.verified[0].rank).toBeGreaterThan(0);
  });
});
