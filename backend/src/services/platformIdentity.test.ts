import assert from 'node:assert/strict';
import {
  hasPublishCredentials,
  isPersonalProvider,
  normalizePlatform,
  normalizePublicTelegramChannel,
  platformAliases,
  selectedPlatformsForStrategy,
  supportsPublicPosts,
  supportsPublicPostsForDestination,
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
assert.equal(supportsPublicPostsForDestination('telegram', '@MyBrandChannel'), true, 'Telegram public-channel publishing requires an explicit channel');
assert.equal(supportsPublicPostsForDestination('telegram', 'private-recipient'), false, 'A private Telegram recipient is not a public channel');
assert.equal(normalizePublicTelegramChannel('MyBrandChannel'), '@MyBrandChannel');
assert.equal(supportsPublicPosts('email'), false, 'Email must not be treated as a public social feed');
assert.equal(supportsPublicPosts('whatsapp_personal'), false, 'WhatsApp personal accounts do not provide a public-feed publisher');
assert.equal(supportsPublicPosts('signal_personal'), false, 'Signal personal accounts do not provide a public-feed publisher');
assert.equal(supportsPublicPosts('delta_chat'), false, 'Delta Chat does not provide a public-feed publisher');
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
