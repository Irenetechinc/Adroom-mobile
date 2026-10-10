export const AUTONOMOUS_CALL_CREDITS = 25;
export const MAX_CAMPAIGN_CONTACTS = 500;
export const MAX_CAMPAIGN_DAILY_CALLS = 25;
export const MAX_CAMPAIGN_ATTEMPTS = 3;
export const MIN_CALL_GAP_MS = 2 * 60 * 1000;

const PHONE_TIME_ZONES: Array<{ prefix: string; country: string; timeZone?: string }> = [
  { prefix: '+234', country: 'NG', timeZone: 'Africa/Lagos' },
  { prefix: '+233', country: 'GH', timeZone: 'Africa/Accra' },
  { prefix: '+254', country: 'KE', timeZone: 'Africa/Nairobi' },
  { prefix: '+27', country: 'ZA', timeZone: 'Africa/Johannesburg' },
  { prefix: '+44', country: 'GB', timeZone: 'Europe/London' },
  { prefix: '+91', country: 'IN', timeZone: 'Asia/Kolkata' },
  { prefix: '+971', country: 'AE', timeZone: 'Asia/Dubai' },
  { prefix: '+65', country: 'SG', timeZone: 'Asia/Singapore' },
  { prefix: '+81', country: 'JP', timeZone: 'Asia/Tokyo' },
  { prefix: '+86', country: 'CN', timeZone: 'Asia/Shanghai' },
  { prefix: '+33', country: 'FR', timeZone: 'Europe/Paris' },
  { prefix: '+49', country: 'DE', timeZone: 'Europe/Berlin' },
  { prefix: '+61', country: 'AU' },
  { prefix: '+1', country: 'US' },
];

export function normalizeE164(value: unknown): string {
  return String(value ?? '').trim().replace(/[()\s.-]/g, '');
}

export function isValidE164(value: unknown): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizeE164(value));
}

export function phoneCountryCode(value: unknown): string | null {
  const phone = normalizeE164(value);
  return PHONE_TIME_ZONES.find(({ prefix }) => phone.startsWith(prefix))?.country ?? null;
}

export function inferPhoneTimeZone(value: unknown): string | null {
  const phone = normalizeE164(value);
  return PHONE_TIME_ZONES.find(({ prefix }) => phone.startsWith(prefix))?.timeZone ?? null;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isWithinCallingWindow(
  at: Date,
  timeZone: string,
  startHour = 9,
  endHour = 17,
): boolean {
  if (!isValidTimeZone(timeZone) || !Number.isInteger(startHour) || !Number.isInteger(endHour)
    || startHour < 0 || endHour > 24 || startHour >= endHour) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const localMinute = hour * 60 + minute;
  return localMinute >= startHour * 60 && localMinute < endHour * 60;
}

export function localDayStartUtc(at: Date, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) throw new Error('A valid IANA time zone is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const utcAt = at.getTime();
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const localHour = Number(localParts.find((entry) => entry.type === 'hour')?.value);
  const localMinute = Number(localParts.find((entry) => entry.type === 'minute')?.value);
  const localSecond = Number(localParts.find((entry) => entry.type === 'second')?.value);
  const representedUtc = Date.UTC(year, month - 1, day, localHour, localMinute, localSecond);
  const offset = representedUtc - utcAt;
  return new Date(Date.UTC(year, month - 1, day) - offset);
}

