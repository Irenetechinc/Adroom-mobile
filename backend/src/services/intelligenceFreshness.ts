export interface IntelligenceFreshness {
  sourceTimestamp: string | null;
  isFresh: boolean;
  fallback: string | null;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function resolveIntelligenceFreshness(
  timestamps: unknown[],
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): IntelligenceFreshness {
  const latest = timestamps
    .filter((value): value is string | number | Date => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left)[0];
  const isFresh = Boolean(latest && now - latest <= maxAgeMs);

  return {
    sourceTimestamp: latest ? new Date(latest).toISOString() : null,
    isFresh,
    fallback: isFresh
      ? null
      : 'intelligence is missing or older than 24 hours; use conservative platform-native creative decisions',
  };
}