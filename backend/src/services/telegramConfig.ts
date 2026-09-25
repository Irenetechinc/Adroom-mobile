const API_ID_KEYS = [
  'TELEGRAM_API_ID',
  'TELEGRAM_APP_API_ID',
  'TELEGRAM_APP_ID',
  'TG_API_ID',
] as const;

const API_HASH_KEYS = [
  'TELEGRAM_API_HASH',
  'TELEGRAM_APP_API_HASH',
  'TELEGRAM_APP_HASH',
  'TG_API_HASH',
] as const;

export interface TelegramAppConfigStatus {
  apiIdValid: boolean;
  apiHashPresent: boolean;
  configured: boolean;
}

function readApiId(): number | null {
  for (const key of API_ID_KEYS) {
    const rawValue = String(process.env[key] || '').trim();
    if (!rawValue) continue;

    const apiId = Number(rawValue);
    if (Number.isSafeInteger(apiId) && apiId > 0) return apiId;
  }

  return null;
}

function readApiHash(): string | null {
  for (const key of API_HASH_KEYS) {
    const apiHash = String(process.env[key] || '').trim();
    if (apiHash) return apiHash;
  }

  return null;
}

export function getTelegramAppConfigStatus(): TelegramAppConfigStatus {
  const apiIdValid = readApiId() !== null;
  const apiHashPresent = readApiHash() !== null;

  return {
    apiIdValid,
    apiHashPresent,
    configured: apiIdValid && apiHashPresent,
  };
}

export function getTelegramAppConfig(): { apiId: number; apiHash: string } {
  const apiId = readApiId();
  const apiHash = readApiHash();

  if (apiId === null || !apiHash) {
    console.error(
      '[SocialAccountService] Telegram server credentials are unavailable at runtime.',
      `apiIdValid=${apiId !== null}, apiHashPresent=${Boolean(apiHash)}.`,
      'Set TELEGRAM_API_ID and TELEGRAM_API_HASH on the running backend service.',
    );
    throw new Error('TELEGRAM_SERVER_NOT_READY');
  }

  return { apiId, apiHash };
}