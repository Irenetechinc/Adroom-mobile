const { parseStructuredJson } = require('../../../backend/src/config/ai-models');

describe('parseStructuredJson', () => {
  it('extracts JSON from fenced model output', () => {
    const result = parseStructuredJson(`Here is the strategy I recommend.
\n\`\`\`json
{ "title": "Launch Sprint", "platforms": ["instagram", "tiktok"] }
\`\`\`
`);

    expect(result).toMatchObject({
      title: 'Launch Sprint',
      platforms: ['instagram', 'tiktok'],
    });
  });

  it('extracts JSON from trailing narration', () => {
    const result = parseStructuredJson(`I would prioritize a video-first campaign.
{ "title": "Creator Push", "content_pillars": [{ "title": "Hook" }] }
This should outperform static posts.`);

    expect(result).toMatchObject({
      title: 'Creator Push',
      content_pillars: [{ title: 'Hook' }],
    });
  });
});
