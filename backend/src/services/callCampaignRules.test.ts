import assert from 'assert';
import {
  isValidTimezone,
  isWithinCallWindow,
  nextCallWindowStart,
  normalizePhoneE164,
} from './callCampaignRules';

assert.strictEqual(normalizePhoneE164('+234 801-234-5678'), '+2348012345678');
assert.strictEqual(normalizePhoneE164('08012345678'), null);
assert.strictEqual(isValidTimezone('Africa/Lagos'), true);
assert.strictEqual(isValidTimezone('Not/A_Timezone'), false);

const lagosWorkday = new Date('2026-10-10T08:30:00.000Z'); // 09:30 in Lagos
assert.strictEqual(isWithinCallWindow('Africa/Lagos', 9, 17, lagosWorkday), true);

const lagosAfterHours = new Date('2026-10-10T18:30:00.000Z'); // 19:30 in Lagos
assert.strictEqual(isWithinCallWindow('Africa/Lagos', 9, 17, lagosAfterHours), false);
assert.strictEqual(
  nextCallWindowStart('Africa/Lagos', 9, 17, lagosAfterHours).toISOString(),
  '2026-10-11T08:00:00.000Z',
);

console.log('callCampaignRules tests passed');
