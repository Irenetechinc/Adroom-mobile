import assert from 'node:assert/strict';
import { isPersonalProvider } from './platformIdentity';
import { AgentReachAdapter, extractPublicBusinessEmail } from './agentReachAdapter';

const publicContact = extractPublicBusinessEmail(
  'Contact our team at info@brand.example.',
  'https://www.brand.example/contact?campaign=lookup#email',
);
assert.deepEqual(publicContact, {
  email: 'info@brand.example',
  sourceUrl: 'https://www.brand.example/contact',
});

assert.equal(
  extractPublicBusinessEmail('Email ada@brand.example for details.', 'https://brand.example/contact'),
  undefined,
);
assert.equal(
  extractPublicBusinessEmail('Write to sales@other.example.', 'https://brand.example/contact'),
  undefined,
);
assert.equal(
  extractPublicBusinessEmail('Contact info@brand.example.', 'https://www.instagram.com/brand'),
  undefined,
);
assert.equal(
  extractPublicBusinessEmail('Contact info@brand.example.', 'https://brand.example/contact', 'https://other.example'),
  undefined,
);
assert.equal(isPersonalProvider('email'), true);

const adapter = new AgentReachAdapter();
const result = (adapter as any).mapItem('email', {
  id: 'email:info@brand.example',
  author_name: 'info@brand.example',
  author_id: 'contact-owner-id',
  snippet: 'Contact us at info@brand.example for booking details.',
  url: 'https://brand.example/contact?email=info%40brand.example',
  source: 'public-web',
}, 0, 'brand contact');

assert.equal(result.metadata.recipient, 'info@brand.example');
assert.equal(result.authorId, undefined);
assert.equal(result.url, 'https://brand.example/contact');
assert.equal(result.metadata.raw, undefined);
assert.doesNotMatch(result.text, /info@brand\.example/i);
assert.doesNotMatch(result.externalId, /info@brand\.example/i);
assert.doesNotMatch(result.authorName, /info@brand\.example/i);

console.log('AgentReach email discovery checks passed.');
