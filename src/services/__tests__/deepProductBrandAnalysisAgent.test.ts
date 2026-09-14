import {
  buildDeepBrandAnalysisPrompt,
  normalizeDeepBrandAnalysis,
} from '../../../backend/src/services/deepProductBrandAnalysisAgent';

describe('DeepProductBrandAnalysisAgent', () => {
  it('builds a prompt that requires live intelligence and structured output', () => {
    const prompt = buildDeepBrandAnalysisPrompt({
      productName: 'GlowLift Serum',
      category: 'skincare',
      description: 'Vitamin-rich facial serum',
      socialSignals: [{ content: 'The texture feels amazing', sentiment: 'positive' }],
      platformIntel: { algorithm: 'video-first' },
      emotionSignals: [{ emotion: 'confidence', ownership_percentage: 41 }],
      geoSignals: [{ query: 'glow serum', sentiment: 'positive' }],
    });

    expect(prompt).toContain('LIVE INTELLIGENCE');
    expect(prompt).toContain('GlowLift Serum');
    expect(prompt).toContain('Return JSON');
  });

  it('normalizes a partial analysis into a stable, safe structure', () => {
    const normalized = normalizeDeepBrandAnalysis({
      summary: '',
      audienceSegments: ['beauty seekers'],
      unmetNeeds: ['hydration'],
      competitiveEdges: [],
      riskFlags: [],
      nextActions: [{ action: 'Refresh positioning', reason: 'more clarity', priority: 'high' }],
    });

    expect(normalized.summary).toContain('brand');
    expect(normalized.audienceSegments).toHaveLength(1);
    expect(normalized.nextActions[0].priority).toBe('high');
    expect(normalized.confidence).toBeGreaterThan(0);
  });
});
