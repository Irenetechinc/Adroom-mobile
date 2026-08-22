interface APMAEvent {
  id: number;
  event: string;
  campaign_id: string;
  client_name?: string;
  ts: string;
  data: Record<string, unknown>;
}

let _seq = 0;
const _log: APMAEvent[] = [];
const MAX_EVENTS = 150;

export function pushAPMAEvent(
  event: string,
  campaign_id: string,
  data: Record<string, unknown>,
  client_name?: string,
): void {
  _log.push({ id: ++_seq, event, campaign_id, client_name, ts: new Date().toISOString(), data });
  if (_log.length > MAX_EVENTS) _log.shift();
}

export function getAPMAEvents(since?: number, campaign_id?: string): APMAEvent[] {
  let events = since != null ? _log.filter((e) => e.id > since) : [..._log];
  if (campaign_id) events = events.filter((e) => e.campaign_id === campaign_id);
  return events;
}

export function getLatestSeq(): number {
  return _seq;
}
