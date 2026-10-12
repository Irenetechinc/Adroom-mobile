import assert from 'node:assert/strict';
import {
  hasPublishCredentials,
  normalizePlatform,
  platformAliases,
  selectedPlatformsForStrategy,
} from './platformIdentity';
import { CLAIMABLE_AGENT_TASK_STATUSES } from './agentTaskQueue';

assert.deepEqual(CLAIMABLE_AGENT_TASK_STATUSES, ['pending', 'scheduled']);
assert.deepEqual(platformAliases('twitter'), ['twitter', 'x']);
assert.equal(normalizePlatform('x'), 'twitter');
assert.deepEqual(
  selectedPlatformsForStrategy({ selected_accounts: [], platforms: ['instagram'] }),
  ['instagram'],
);
assert.deepEqual(
  selectedPlatformsForStrategy({ selected_accounts: ['facebook'], platforms: ['instagram'] }),
  ['facebook'],
);
assert.equal(hasPublishCredentials('facebook', { access_token: 'token' }), false);
assert.equal(hasPublishCredentials('facebook', { access_token: 'token', page_id: 'page' }), true);
assert.equal(hasPublishCredentials('instagram', { access_token: 'token' }), false);
assert.equal(hasPublishCredentials('instagram', { access_token: 'token', instagram_account_id: 'account' }), true);
assert.equal(hasPublishCredentials('linkedin', { access_token: 'token' }), false);
assert.equal(hasPublishCredentials('linkedin', { access_token: 'token', person_urn: 'urn' }), true);
assert.equal(hasPublishCredentials('tiktok', { access_token: 'token' }), false);
assert.equal(hasPublishCredentials('tiktok', { access_token: 'token', open_id: 'open-id' }), true);
console.log('Platform identity and publisher credential checks passed.');
