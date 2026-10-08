import assert from 'assert';
import {
  cloudflarePolicyAllows,
  estimateCloudflareImageNeurons,
  estimateCloudflareTextNeurons,
  isCloudflareConfigured,
  isCloudflareModelError,
  isCloudflareQuotaError,
  resolveCloudflareModel,
} from './cloudflareWorkersAi';

function runTests(): void {
  const credentials = {
    CLOUDFLARE_ACCOUNT_ID_1: 'text-account',
    CLOUDFLARE_API_TOKEN_1: 'text-token',
    CLOUDFLARE_ACCOUNT_ID_2: 'image-account',
    CLOUDFLARE_API_TOKEN_2: 'image-token',
  } as NodeJS.ProcessEnv;

  assert.strictEqual(isCloudflareConfigured('text', credentials), true);
  assert.strictEqual(isCloudflareConfigured('image', credentials), true);
  assert.strictEqual(isCloudflareConfigured('text', {
    CLOUDFLARE_ACCOUNT_ID_1: 'text-account',
  } as NodeJS.ProcessEnv), false);
  assert.strictEqual(isCloudflareConfigured('image', {
    CLOUDFLARE_ACCOUNT_ID_2: 'bad/account',
    CLOUDFLARE_API_TOKEN_2: 'image-token',
  } as NodeJS.ProcessEnv), false);

  assert.strictEqual(cloudflarePolicyAllows('tiered', true, {
    freeModeEnabled: true,
    universalFreeModeEnabled: false,
  }), true);
  assert.strictEqual(cloudflarePolicyAllows('tiered', false, {
    freeModeEnabled: true,
    universalFreeModeEnabled: true,
  }), false);
  assert.strictEqual(cloudflarePolicyAllows('free', false, {
    freeModeEnabled: false,
    universalFreeModeEnabled: true,
  }), true);
  assert.strictEqual(cloudflarePolicyAllows('paid', true, {
    freeModeEnabled: true,
    universalFreeModeEnabled: true,
  }), false);

  assert.strictEqual(
    estimateCloudflareTextNeurons('@cf/meta/llama-3.2-1b-instruct', 1000, 500),
    12,
  );
  assert.strictEqual(
    estimateCloudflareTextNeurons('@cf/unsupported/model', 1000, 500),
    130,
  );
  assert.strictEqual(estimateCloudflareImageNeurons('@cf/black-forest-labs/flux-1-schnell'), 44);
  assert.strictEqual(estimateCloudflareImageNeurons('@cf/black-forest-labs/flux-2-klein-4b'), 27);
  assert.strictEqual(estimateCloudflareImageNeurons('@cf/unsupported/model'), 44);

  assert.strictEqual(isCloudflareModelError(400, 'requested model is not available'), true);
  assert.strictEqual(isCloudflareModelError(429, 'daily neuron quota'), false);
  assert.strictEqual(isCloudflareQuotaError(429, 'daily neuron quota exceeded'), true);
  assert.strictEqual(isCloudflareQuotaError(429, 'temporary service issue'), false);
  assert.strictEqual(
    resolveCloudflareModel('text', 'not-a-cloudflare-model'),
    '@cf/meta/llama-3.2-1b-instruct',
  );
  assert.strictEqual(
    resolveCloudflareModel('text', '@cf/models/../credentials'),
    '@cf/meta/llama-3.2-1b-instruct',
  );

  console.log('Cloudflare Workers AI provider checks passed.');
}

runTests();
