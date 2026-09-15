const TTL_MS = 10 * 60 * 1000;

interface PendingEntry {
  code?: string;
  error?: string;
  timestamp: number;
}

const store = new Map<string, PendingEntry>();

export function setOAuthCode(state: string, code: string) {
  _cleanup();
  store.set(state, { code, timestamp: Date.now() });
}

export function setOAuthError(state: string, error: string) {
  _cleanup();
  store.set(state, { error, timestamp: Date.now() });
}

export function popOAuthEntry(state: string): PendingEntry | undefined {
  const entry = store.get(state);
  if (!entry) return undefined;
  store.delete(state);
  return entry;
}

function _cleanup() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store.entries()) {
    if (v.timestamp < cutoff) store.delete(k);
  }
}
