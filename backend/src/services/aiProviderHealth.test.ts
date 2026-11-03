import assert from 'assert';
import { getAIProviderHealth, recordAIProviderFailure } from './aiProviderHealth';

const now = new Date('2026-11-03T10:00:00.000Z');

recordAIProviderFailure('nvidia', 'text', { status: 402, message: 'Payment required' }, now);
const paymentRequired = getAIProviderHealth([
  { provider: 'nvidia', task: 'text', configured: true },
], now)[0];
assert.strictEqual(paymentRequired.healthStatus, 'exhausted');
assert.strictEqual(paymentRequired.lastStatusCode, 402);
assert.strictEqual(paymentRequired.nextRetryAt, '2026-11-04T00:00:00.000Z');

recordAIProviderFailure('huggingface', 'video', {
  statusCode: 429,
  message: 'Daily inference quota exceeded',
}, now);
const quotaLimited = getAIProviderHealth([
  { provider: 'huggingface', task: 'video', configured: true },
], now)[0];
assert.strictEqual(quotaLimited.healthStatus, 'exhausted');
assert.strictEqual(quotaLimited.lastStatusCode, 429);
const relatedImageQuota = getAIProviderHealth([
  { provider: 'huggingface', task: 'image', configured: true },
], now)[0];
assert.strictEqual(relatedImageQuota.healthStatus, 'exhausted');

recordAIProviderFailure('openai', 'text', {
  status: 429,
  message: 'Too many requests; rate limit reached',
}, now);
const rateLimited = getAIProviderHealth([
  { provider: 'openai', task: 'text', configured: true },
], now)[0];
assert.strictEqual(rateLimited.healthStatus, 'busy');
assert.strictEqual(rateLimited.lastStatusCode, 429);
assert.strictEqual(rateLimited.nextRetryAt, '2026-11-03T10:01:00.000Z');

console.log('AI provider health tests passed.');
