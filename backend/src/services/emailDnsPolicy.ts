const PROVIDER_MANAGED_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.es',
  'live.com',
  'live.co.uk',
  'live.fr',
  'live.de',
  'live.nl',
  'msn.com',
  'office365.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'fastmail.com',
  'fastmail.fm',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'zoho.com',
  'zoho.eu',
  'proton.me',
  'protonmail.com',
  'pm.me',
]);

export function isProviderManagedSenderDomain(domain: string): boolean {
  return PROVIDER_MANAGED_DOMAINS.has(String(domain || '').trim().toLowerCase());
}

export function hasValidSpf(records: string[]): boolean {
  const spfRecords = records.filter((record) => /^v=spf1\b/i.test(String(record || '').trim()));
  if (spfRecords.length !== 1) return false;
  return /(?:^|\s)(?:~all|-all)\s*$/i.test(spfRecords[0].trim());
}

export function hasDkimKey(records: string[]): boolean {
  return records.some((record) =>
    /(?:^|;)\s*p=[a-z0-9+/]+=*/i.test(String(record || '').trim()),
  );
}

export function hasEnforcedDmarcPolicy(records: string[]): boolean {
  const dmarcRecords = records.filter((record) => /^v=dmarc1\b/i.test(String(record || '').trim()));
  if (dmarcRecords.length !== 1) return false;
  return /(?:^|;)\s*p=(?:quarantine|reject)\s*(?:;|$)/i.test(dmarcRecords[0].trim());
}
