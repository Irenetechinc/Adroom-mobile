export function normalizeInboundMessageTimestamp(value: unknown, fallback: Date | string | number = new Date()): string {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const candidates = [
    record.message_timestamp,
    record.messageTimestamp,
    record.received_at,
    record.receivedAt,
    record.created_at,
    record.createdAt,
    record.timestamp,
    value,
  ].filter((candidate): candidate is string | number | Date => candidate !== undefined && candidate !== null && String(candidate).trim() !== '');

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const fallbackDate = new Date(fallback);
  if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
  return new Date().toISOString();
}
