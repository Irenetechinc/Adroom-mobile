
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://adroom-mobile-production-35f8.up.railway.app';

export const RemoteLogger = {
  log: (category: string, message: string, data?: any) => {
    console.log(`[${category}] ${message}`, data || '');
    RemoteLogger.send('info', category, message, data);
  },

  warn: (category: string, message: string, data?: any) => {
    console.warn(`[${category}] ${message}`, data || '');
    RemoteLogger.send('warn', category, message, data);
  },

  error: (category: string, message: string, error?: any) => {
    console.error(`[${category}] ${message}`, error || '');
    RemoteLogger.send('error', category, message, { error: error?.message || error });
  },

  send: async (level: 'info' | 'warn' | 'error', category: string, message: string, data?: any) => {
    try {
      await fetch(`${BACKEND_URL}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          category,
          message,
          data,
          timestamp: Date.now()
        })
      });
    } catch (e) {
      // Fail silently to avoid feedback loops
    }
  }
};
