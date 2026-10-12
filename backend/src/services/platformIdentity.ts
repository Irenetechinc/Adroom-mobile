/**
 * Canonical platform identifiers shared by connection, strategy, and
 * execution code. UI labels and older integrations use several aliases; the
 * scheduler must never treat those aliases as different accounts.
 */
export const PERSONAL_PROVIDERS = [
  'telegram',
  'whatsapp_personal',
  'signal_personal',
  'bluesky',
  'delta_chat',
  'email',
] as const;

export type CanonicalPlatform = string;

const ALIASES: Record<string, CanonicalPlatform> = {
  x: 'twitter',
  twitter: 'twitter',
  telegram_personal: 'telegram',
  telegram: 'telegram',
  whatsapp_personal: 'whatsapp_personal',
  'whatsapp-personal': 'whatsapp_personal',
  signal: 'signal_personal',
  signal_personal: 'signal_personal',
  'signal-personal': 'signal_personal',
  bluesky: 'bluesky',
  bluesky_personal: 'bluesky',
  'bluesky-personal': 'bluesky',
  delta_chat: 'delta_chat',
  deltachat: 'delta_chat',
  'delta-chat': 'delta_chat',
};

export function normalizePlatform(value: unknown): CanonicalPlatform {
  const raw = String(value ?? '').trim().toLowerCase();
  return ALIASES[raw] || raw;
}

export function isPersonalProvider(value: unknown): boolean {
  return (PERSONAL_PROVIDERS as readonly string[]).includes(normalizePlatform(value));
}

export function platformAliases(value: unknown): string[] {
  const canonical = normalizePlatform(value);
  const aliases = Object.entries(ALIASES)
    .filter(([, mapped]) => mapped === canonical)
    .map(([alias]) => alias);
  return Array.from(new Set([canonical, ...aliases]));
}

/**
 * Accept both the current string-only selection contract and the account
 * objects used by newer selection surfaces. Only platform identity is stored
 * in the existing strategy schema; ownership is checked against the user's
 * connection rows before activation.
 */
export function normalizeSelectedPlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry: any) => {
      if (entry && typeof entry === 'object') {
        return entry.platform || entry.provider || entry.id;
      }
      return entry;
    })
    .map(normalizePlatform)
    .filter(Boolean)));
}

export function selectedPlatformsForStrategy(strategy: any): string[] {
  const selected = normalizeSelectedPlatforms(strategy?.selected_accounts);
  return selected.length > 0 ? selected : normalizeSelectedPlatforms(strategy?.platforms);
}

export function hasPublishCredentials(platformValue: unknown, config: any): boolean {
  if (!config?.access_token) return false;

  switch (normalizePlatform(platformValue)) {
    case 'facebook':
      return Boolean(config.page_id);
    case 'instagram':
      return Boolean(config.instagram_account_id);
    case 'linkedin':
      return Boolean(config.person_urn || config.org_urn);
    case 'tiktok':
      return Boolean(config.open_id);
    case 'twitter':
      return true;
    default:
      return true;
  }
}

export function connectionFlagForPlatform(value: unknown): string {
  return `social_${normalizePlatform(value)}_connections`;
}