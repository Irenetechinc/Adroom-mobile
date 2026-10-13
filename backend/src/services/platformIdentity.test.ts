import assert from 'node:assert/strict';
import {
  hasPublishCredentials,
  isPersonalProvider,
  normalizePlatform,
  platformAliases,
  selectedPlatformsForStrategy,
  supportsPublicPosts,
} from './platformIdentity';
import { CLAIMABLE_AGENT_TASK_STATUSES } from './agentTaskQueue';

assert.deepEqual(CLAIMABLE_AGENT_TASK_STATUSES, ['pending', 'scheduled']);
assert.deepEqual(platformAliases('twitter'), ['twitter', 'x']);
assert.equal(normalizePlatform('x'), 'twitter');
assert.equal(isPersonalProvider('bluesky'), true, 'Bluesky credentials remain in the managed social-account store');
assert.equal(supportsPublicPosts('bluesky'), true, 'Bluesky supports public-feed strategy posts');
assert.equal(supportsPublicPosts('bluesky_personal'), true, 'Bluesky aliases retain public-feed support');
assert.equal(supportsPublicPosts('x'), true, 'X aliases retain public-feed support');
assert.equal(supportsPublicPosts('telegram'), false, 'Messaging-only accounts must not be treated as public feeds');
assert.equal(supportsPublicPosts('email'), false, 'Email must not be treated as a public social feed');
assert.equal(supportsPublicPosts('whatsapp_personal'), false, 'WhatsApp accounts are recipient-only');
assert.equal(supportsPublicPosts('signal_personal'), false, 'Signal accounts are recipient-only');
assert.equal(supportsPublicPosts('delta_chat'), false, 'Delta Chat accounts are recipient-only');
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
