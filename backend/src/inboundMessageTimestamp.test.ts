import { normalizeInboundMessageTimestamp } from './services/inboundMessageTimestamp';

const assert = {
  strictEqual(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
      throw new Error(`Expected ${String(expected)} but received ${String(actual)}`);
    }
  },
  ok(condition: unknown): void {
    if (!condition) throw new Error('Expected condition to be truthy');
  },
};

const iso = '2024-01-15T12:30:45.000Z';
assert.strictEqual(normalizeInboundMessageTimestamp({ message_timestamp: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ messageTimestamp: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ received_at: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ receivedAt: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ created_at: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ createdAt: iso }), iso);
assert.strictEqual(normalizeInboundMessageTimestamp({ timestamp: iso }), iso);
assert.ok(/Z$/.test(normalizeInboundMessageTimestamp({})));

console.log('inbound timestamp regression checks passed');
