import { supabase } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || 'https://backend.adroomai.com';

async function request(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated.');
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Request failed.');
  return data;
}

export const OutreachService = {
  getPreferences: () => request('/api/outreach/preferences'),
  updatePreferences: (payload: { do_not_call?: boolean; public_data_collection?: boolean }) =>
    request('/api/outreach/preferences', { method: 'PATCH', body: JSON.stringify(payload) }),
  setLeadCallConsent: (id: string, consented: boolean) =>
    request(`/api/leads/${id}/call-consent`, {
      method: 'PATCH',
      body: JSON.stringify({ consented, explicit_confirmation: consented }),
    }),
  getCalls: () => request('/api/calls'),
  provisionCallingNumber: () => request('/api/calls/number', { method: 'POST', body: '{}' }),
  getShipments: () => request('/api/logistics/shipments'),
  setShipmentDeliveryAddress: (id: string, deliveryAddress: string) =>
    request(`/api/logistics/shipments/${id}/delivery-address`, {
      method: 'PATCH', body: JSON.stringify({ delivery_address: deliveryAddress }),
    }),
  dispatchShipment: (id: string) =>
    request(`/api/logistics/shipments/${id}/dispatch`, { method: 'POST', body: '{}' }),
  confirmPickup: (id: string, evidenceUrl?: string) => request(`/api/logistics/shipments/${id}/confirm-pickup`, {
    method: 'POST', body: JSON.stringify({ evidence_url: evidenceUrl || null }),
  }),
};
