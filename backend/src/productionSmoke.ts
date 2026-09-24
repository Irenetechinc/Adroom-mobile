import { createClient } from '@supabase/supabase-js';

const baseUrl = String(process.env.SMOKE_BASE_URL || process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');
const userToken = String(process.env.SMOKE_USER_ACCESS_TOKEN || '').trim();
const userId = String(process.env.SMOKE_USER_ID || '').trim();
const adminEmail = String(process.env.ADMIN_EMAIL || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
const runProviderFlows = process.env.SMOKE_RUN_PROVIDER_FLOWS === 'true';
const runRealtimeWrite = process.env.SMOKE_RUN_REALTIME_WRITE === 'true';

const providers = ['telegram', 'whatsapp_personal', 'signal_personal', 'bluesky', 'delta_chat'];
const failures: string[] = [];

function requireValue(name: string, value: string): void {
  if (!value) failures.push(`${name} is required`);
}

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: response.status, body };
}

async function checkPublicHealth(): Promise<void> {
  const result = await request('/api/health');
  if (result.status !== 200 || result.body?.status !== 'ok') {
    failures.push(`health failed (${result.status})`);
  }

  const config = await request('/api/health/config');
  if (config.status !== 200 || config.body?.ok !== true) {
    failures.push(`runtime config failed (${config.status}): ${JSON.stringify(config.body?.missingRequired || [])}`);
  }
}

async function checkAuthenticatedCapabilities(): Promise<any> {
  const availability = await request('/api/social-connections/availability');
  if (availability.status !== 200) {
    failures.push(`social availability failed (${availability.status})`);
    return {};
  }
  for (const provider of providers) {
    if (!availability.body?.availability?.[provider]) failures.push(`missing capability state for ${provider}`);
  }

  const connections = await request('/api/social-connections');
  if (connections.status !== 200) failures.push(`social connections failed (${connections.status})`);
  return availability.body?.availability || {};
}

async function checkMigrationStatus(): Promise<void> {
  if (!adminEmail || !adminPassword) {
    failures.push('ADMIN_EMAIL and ADMIN_PASSWORD are required for migration verification');
    return;
  }
  const login = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginBody = await login.json().catch(() => ({}));
  if (!login.ok || !loginBody.token) {
    failures.push(`admin login failed (${login.status})`);
    return;
  }
  const status = await fetch(`${baseUrl}/admin/api/apma-migration/status`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  const body = await status.json().catch(() => ({}));
  if (!status.ok || body.migrated !== true) failures.push(`APMA migration status failed: ${JSON.stringify(body.missing || [])}`);
}

async function checkPush(): Promise<void> {
  const result = await request('/api/push/test', { method: 'POST' });
  if (result.status !== 200) {
    failures.push(`push diagnostic failed (${result.status})`);
    return;
  }
  if (!Number.isFinite(result.body?.tokensFound)) failures.push('push diagnostic did not return token count');
  if (!Array.isArray(result.body?.projectIds)) failures.push('push diagnostic did not return project IDs');
  if (result.body?.result?.ok !== true) failures.push(`push delivery failed: ${result.body?.result?.errorSummary || 'Expo rejected the test push'}`);
}

async function checkRealtime(): Promise<void> {
  requireValue('SUPABASE_URL', String(process.env.SUPABASE_URL || ''));
  requireValue('SUPABASE_SERVICE_ROLE_KEY', String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''));
  requireValue('SMOKE_USER_ID', userId);
  if (!runRealtimeWrite || failures.length) return;

  const client = createClient(String(process.env.SUPABASE_URL), String(process.env.SUPABASE_SERVICE_ROLE_KEY));
  const marker = `smoke-${Date.now()}`;
  let received = false;
  const channel = client.channel(`production-smoke-${marker}`).on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'agent_tasks', filter: `user_id=eq.${userId}`,
  }, (payload) => {
    if ((payload.new as any)?.task_type === marker) received = true;
  });
  await channel.subscribe();
  const { error } = await client.from('agent_tasks').insert({ user_id: userId, agent_type: 'SMOKE', task_type: marker, status: 'cancelled' });
  if (error) failures.push(`realtime insert failed: ${error.message}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await client.from('agent_tasks').delete().eq('user_id', userId).eq('task_type', marker);
  await client.removeChannel(channel);
  if (!received) failures.push('realtime event was not received for agent_tasks');
}

async function checkProviderFlows(availability: any): Promise<void> {
  if (!runProviderFlows) return;
  for (const provider of providers) {
    const state = availability[provider];
    if (!state?.enabled || state?.comingSoon || state?.serverConfigured === false) {
      console.log(`[smoke] skipped ${provider}: unavailable or coming soon`);
      continue;
    }
    console.log(`[smoke] ${provider} is enabled; provider-specific login requires explicit interactive credentials and is not automated by this command`);
  }
}

async function main(): Promise<void> {
  requireValue('SMOKE_BASE_URL or EXPO_PUBLIC_API_URL', baseUrl);
  requireValue('SMOKE_USER_ACCESS_TOKEN', userToken);
  if (failures.length) throw new Error(failures.join('; '));

  await checkPublicHealth();
  const availability = await checkAuthenticatedCapabilities();
  await checkMigrationStatus();
  await checkPush();
  await checkRealtime();
  await checkProviderFlows(availability);

  if (failures.length) throw new Error(failures.join('; '));
  console.log('[smoke] deployed API, migration status, push diagnostics, capability states, and enabled realtime checks passed');
}

main().catch((error) => {
  console.error(`[smoke] FAILED: ${error.message}`);
  process.exitCode = 1;
});
