import assert from 'assert';
import {
  mergeOfferContexts,
  normalizeDiscoveryQueryPlan,
  normalizeOfferContext,
  selectConversationResults,
} from './conversationAgent';
import { normalizePublicAuthorName } from './agentReachAdapter';

const offer = normalizeOfferContext({
  product_name: 'Lagos Night Market Meal Box',
  brand: 'Kora Kitchen',
  category: 'prepared meals',
  description: 'A weekly dinner box for busy families who want locally made meals.',
  target_audience: 'busy families in Lagos',
  images: [
    'https://cdn.example.com/meal-box.jpg',
    { url: 'https://cdn.example.com/meal-box-alt.jpg' },
  ],
});

assert.equal(normalizePublicAuthorName('Unknown person'), '');
assert.equal(normalizePublicAuthorName('anonymous'), '');
assert.equal(normalizePublicAuthorName('Ada Nwosu'), 'Ada Nwosu');

assert.deepEqual(offer.imageUrls, [
  'https://cdn.example.com/meal-box.jpg',
  'https://cdn.example.com/meal-box-alt.jpg',
]);
assert.equal(offer.name, 'Lagos Night Market Meal Box');
assert.ok(offer.searchableTerms.includes('Lagos'));

const mergedOffer = mergeOfferContexts(
  normalizeOfferContext({ product_name: 'L' }),
  offer,
);
assert.equal(mergedOffer.name, 'Lagos Night Market Meal Box');
const mergedPlan = normalizeDiscoveryQueryPlan({ queries: ['people looking for meal boxes'] }, mergedOffer);
assert.ok(mergedPlan.queries[0].includes('"Lagos Night Market Meal Box"'));

const plan = normalizeDiscoveryQueryPlan({
  queries: ['people comparing weekly dinner options', 'Kora Kitchen meal box recommendations'],
  demandTerms: ['comparing dinner options', 'asking for a weekly meal service'],
  exclusions: ['recipe'],
}, offer);

assert.equal(plan.queries.length, 2);
assert.ok(plan.queries[0].toLowerCase().includes('lagos night market meal box'));
assert.ok(!plan.queries.some((query) => query.includes('https://')));
assert.deepEqual(plan.demandTerms, ['comparing dinner options', 'asking for a weekly meal service']);

const fallbackPlan = normalizeDiscoveryQueryPlan(null, offer);
assert.deepEqual(fallbackPlan.queries, ['"Lagos Night Market Meal Box"']);

const strict = selectConversationResults([
  {
    platform: 'web',
    externalId: 'strict',
    authorName: '',
    text: 'Looking for Lagos Night Market Meal Box recommendations for next week.',
    kind: 'post',
    capturedAt: new Date().toISOString(),
  },
  {
    platform: 'web',
    externalId: 'relaxed',
    authorName: '',
    text: 'Lagos Night Market Meal Box details and ingredients.',
    kind: 'post',
    capturedAt: new Date().toISOString(),
  },
], offer, ['looking for']);
assert.equal(strict.strict, 1);
assert.equal(strict.results[0].externalId, 'strict');

const retained = selectConversationResults([
  {
    platform: 'web',
    externalId: 'provider-title-only',
    authorName: '',
    text: 'A result with useful provider context but no exact extracted keywords.',
    kind: 'post',
    capturedAt: new Date().toISOString(),
  },
], offer, ['seeking']);
assert.equal(retained.fallback, true);
assert.equal(retained.results.length, 1);

console.log('Conversation discovery contract checks passed.');