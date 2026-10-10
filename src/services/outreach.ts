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
  getCallCampaignOptions: () => request('/api/call-campaigns/options'),
  getCallCampaigns: () => request('/api/call-campaigns'),
  createCallCampaign: (payload: Record<string, unknown>) =>
    request('/api/call-campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  getCallCampaignContacts: (id: string) => request(`/api/call-campaigns/${id}/contacts`),
  addCallCampaignContacts: (id: string, leadIds: string[], consentConfirmed: boolean) =>
    request(`/api/call-campaigns/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ lead_ids: leadIds, consent_confirmed: consentConfirmed }),
    }),
  approveCallCampaign: (id: string, explicitConfirmation: boolean) =>
    request(`/api/call-campaigns/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ explicit_confirmation: explicitConfirmation }),
    }),
  startCallCampaign: (id: string) => request(`/api/call-campaigns/${id}/start`, { method: 'POST', body: '{}' }),
  pauseCallCampaign: (id: string) => request(`/api/call-campaigns/${id}/pause`, { method: 'POST', body: '{}' }),
  stopCallCampaign: (id: string) => request(`/api/call-campaigns/${id}/stop`, { method: 'POST', body: '{}' }),
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
