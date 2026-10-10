export function normalizePhoneE164(value: unknown, defaultCountryCallingCode?: unknown): string | null {
  let phone = String(value || '').trim().replace(/[^\d+]/g, '');
  if (!phone.startsWith('+') && defaultCountryCallingCode) {
    const countryCode = String(defaultCountryCallingCode).trim().replace(/[^\d+]/g, '');
    if (!/^\+[1-9]\d{0,2}$/.test(countryCode)) return null;
    phone = countryCode + phone.replace(/^0+/, '');
  }
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function isValidTimezone(value: unknown): value is string {
  const timezone = String(value || '');
  if (!timezone || timezone.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

function localDateTimeToUtc(
  timezone: string,
  target: { year: number; month: number; day: number; hour: number; minute: number },
): Date {
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  let guess = targetAsUtc;
  for (let i = 0; i < 5; i++) {
    const local = zonedParts(timezone, new Date(guess));
    const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const correction = targetAsUtc - representedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

export function isWithinCallWindow(
  timezone: string,
  startHour: number,
  endHour: number,
  now = new Date(),
): boolean {
  const { hour } = zonedParts(timezone, now);
  return hour >= startHour && hour < endHour;
}

export function nextCallWindowStart(
  timezone: string,
  startHour: number,
  endHour: number,
  now = new Date(),
): Date {
  const local = zonedParts(timezone, now);
  const dayOffset = local.hour >= endHour ? 1 : 0;
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  return localDateTimeToUtc(timezone, {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour: startHour,
    minute: 0,
  });
}
