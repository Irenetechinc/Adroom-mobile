type RealtimePayload = {
  eventType?: string;
  new?: Record<string, any>;
  old?: Record<string, any>;
};

/**
 * Coalesces bursty Supabase events and ignores an older update arriving after
 * a newer one. Realtime delivery is at-least-once and ordering is not
 * guaranteed across channels, so screens should not blindly refetch per event.
 */
export function createRealtimeEventGuard(delayMs = 180) {
  const latestByRow = new Map<string, number>();
  const seenAt = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (payload: RealtimePayload, refresh: () => void) => {
    const row = payload.new || payload.old || {};
    const rowId = String(row.id || row.lead_id || row.task_id || JSON.stringify(row));
    const timestamp = Date.parse(String(row.updated_at || row.created_at || row.sent_at || '')) || 0;
    const eventKey = `${payload.eventType || 'event'}:${rowId}:${timestamp}:${JSON.stringify(row)}`;
    const now = Date.now();
    if ((seenAt.get(eventKey) || 0) + 1000 > now) return;
    seenAt.set(eventKey, now);
    const previous = latestByRow.get(rowId) || 0;
    if (timestamp && timestamp < previous) return;
    if (timestamp) latestByRow.set(rowId, timestamp);

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delayMs);
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    latestByRow.clear();
    seenAt.clear();
  };

  return { schedule, dispose };
}