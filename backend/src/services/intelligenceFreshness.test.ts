import { resolveIntelligenceFreshness } from './intelligenceFreshness';

const now = Date.parse('2026-09-24T12:00:00.000Z');
const fresh = resolveIntelligenceFreshness(['2026-09-24T01:00:00.000Z'], now);
if (!fresh.isFresh || !fresh.sourceTimestamp || fresh.fallback !== null) {
  throw new Error('Expected current intelligence to be marked fresh without a fallback.');
}

const stale = resolveIntelligenceFreshness(['2026-09-22T12:00:00.000Z'], now);
if (stale.isFresh || !stale.fallback) throw new Error('Expected stale intelligence to require a fallback.');

const missing = resolveIntelligenceFreshness([], now);
if (missing.isFresh || missing.sourceTimestamp !== null || !missing.fallback) {
  throw new Error('Expected missing intelligence to require a fallback.');
}

console.log('intelligence freshness regression checks passed');