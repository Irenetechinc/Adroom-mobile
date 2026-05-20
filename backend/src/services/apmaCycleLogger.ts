/**
 * APMA Cycle Logger
 * Writes every perception → decision → action step to:
 * 1. Supabase apma_cycle_log table
 * 2. Admin SSE broadcast (real-time monitor)
 */

import { getServiceSupabaseClient } from '../config/supabase';

let adminBroadcast: ((event: string, data: unknown) => void) | null = null;

// Lazy-load adminBroadcast to avoid circular imports
function getBroadcast() {
  if (!adminBroadcast) {
    try {
      const mod = require('../admin/adminRouter');
      adminBroadcast = mod.adminBroadcast;
    } catch { adminBroadcast = () => {}; }
  }
  return adminBroadcast!;
}

export async function apmaCycleLog(
  clientId: string | null,
  userId: string | null,
  phase: 'perception' | 'decision' | 'action' | 'learning' | 'humanizer',
  step: string,
  status: 'running' | 'success' | 'error' | 'skipped',
  detail: Record<string, unknown> = {},
  durationMs?: number,
  errorMessage?: string,
) {
  const entry = {
    client_id: clientId,
    user_id: userId,
    phase,
    step,
    status,
    detail,
    duration_ms: durationMs ?? null,
    error_message: errorMessage ?? null,
    created_at: new Date().toISOString(),
  };

  // Fire-and-forget DB write
  getServiceSupabaseClient()
    .from('apma_cycle_log')
    .insert(entry)
    .then(() => {})
    .catch(() => {});

  // Broadcast to admin SSE immediately
  getBroadcast()('apma_cycle', {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  });
}
