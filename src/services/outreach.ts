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

async function requestMultipart(path: string, body: FormData) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated.');
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Import failed.');
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
  importCallCampaignContacts: (id: string, contacts: any[], consentConfirmed: boolean, defaultCountryCode: string) =>
    request(`/api/call-campaigns/${id}/contacts/import`, {
      method: 'POST',
      body: JSON.stringify({
        contacts,
        consent_confirmed: consentConfirmed,
        default_country_code: defaultCountryCode,
      }),
    }),
  importCallCampaignFile: (id: string, file: { uri: string; name: string; type?: string }, consentConfirmed: boolean, defaultCountryCode: string) => {
    const formData = new FormData();
    formData.append('file', { uri: file.uri, name: file.name, type: file.type || 'application/octet-stream' } as any);
    formData.append('consent_confirmed', String(consentConfirmed));
    formData.append('default_country_code', defaultCountryCode);
    return requestMultipart(`/api/call-campaigns/${id}/contacts/import`, formData);
  },
  updateCallCampaignContact: (id: string, contactId: string, patch: Record<string, unknown>) =>
    request(`/api/call-campaigns/${id}/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  removeCallCampaignContact: (id: string, contactId: string) =>
    request(`/api/call-campaigns/${id}/contacts/${contactId}`, { method: 'DELETE' }),
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
