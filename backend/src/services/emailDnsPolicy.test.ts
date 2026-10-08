import assert from 'assert';
import {
  hasDkimKey,
  hasEnforcedDmarcPolicy,
  hasValidSpf,
  isProviderManagedSenderDomain,
} from './emailDnsPolicy';

assert.strictEqual(isProviderManagedSenderDomain('GMAIL.COM'), true);
assert.strictEqual(isProviderManagedSenderDomain('company.example'), false);
assert.strictEqual(hasValidSpf(['v=spf1 include:mail.example ~all']), true);
assert.strictEqual(hasValidSpf(['v=spf1 include:mail.example ?all']), false);
assert.strictEqual(hasValidSpf(['v=spf1 ~all', 'v=spf1 -all']), false);
assert.strictEqual(hasDkimKey(['v=DKIM1; k=rsa; p=AbCd123+/=']), true);
assert.strictEqual(hasDkimKey(['v=DKIM1; k=rsa']), false);
assert.strictEqual(hasDkimKey(['google-site-verification=AbCd123']), false);
assert.strictEqual(hasEnforcedDmarcPolicy(['v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com']), true);
assert.strictEqual(hasEnforcedDmarcPolicy(['v=DMARC1; p=none']), false);
assert.strictEqual(hasEnforcedDmarcPolicy(['v=DMARC1; p=reject', 'v=DMARC1; p=quarantine']), false);

console.log('emailDnsPolicy tests passed');
