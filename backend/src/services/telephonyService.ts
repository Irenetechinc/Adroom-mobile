import crypto from 'crypto';
import fetch from 'node-fetch';
import { getServiceSupabaseClient } from '../config/supabase';
import { getSubscriptionGuard } from './subscriptionGuard';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_COUNTRY = process.env.TWILIO_FROM_COUNTRY || 'US';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'https://backend.adroomai.com').replace(/\/$/, '');
const TWILIO_API = ACCOUNT_SID ? `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}` : '';

function configured() { return Boolean(ACCOUNT_SID && AUTH_TOKEN && PUBLIC_BASE_URL); }
function basicAuth() { return `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`; }

async function twilioRequest(path: string, method: 'GET' | 'POST', body?: URLSearchParams) {
  if (!configured()) throw new Error('Telephony is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and PUBLIC_BASE_URL.');
  const response = await fetch(`${TWILIO_API}${path}`, {
    method,
    headers: { Authorization: basicAuth(), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body?.toString(),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Twilio request failed (${response.status})`);
  return data;
}

export class TelephonyService {
  private supabase = getServiceSupabaseClient();

  async ensureUserNumber(userId: string): Promise<string> {
    const { data: existing } = await this.supabase.from('user_phone_numbers').select('phone_number').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (existing?.phone_number) return existing.phone_number;
    if (!configured()) throw new Error('No outbound number is available because Twilio is not configured.');

    const available = await twilioRequest(`/AvailablePhoneNumbers/${TWILIO_FROM_COUNTRY}/Local.json?VoiceEnabled=true`, 'GET');
    const candidate = available?.available_phone_numbers?.[0]?.phone_number;
    if (!candidate) throw new Error(`Twilio has no voice-enabled numbers available for country ${TWILIO_FROM_COUNTRY}.`);
    const purchased = await twilioRequest('/IncomingPhoneNumbers.json', 'POST', new URLSearchParams({
      PhoneNumber: candidate,
      VoiceUrl: `${PUBLIC_BASE_URL}/api/webhooks/twilio/voice`,
      StatusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/status`,
    }));
    const { error: saveError } = await this.supabase.from('user_phone_numbers').upsert({
      user_id: userId,
      phone_number: purchased.phone_number,
      provider: 'twilio',
      provider_sid: purchased.sid,
      status: 'active',
      metadata: { country: TWILIO_FROM_COUNTRY },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (saveError) {
      const { data: concurrent } = await this.supabase.from('user_phone_numbers').select('phone_number').eq('user_id', userId).eq('status', 'active').maybeSingle();
      if (concurrent?.phone_number) return concurrent.phone_number;
      throw new Error(`Could not save outbound number: ${saveError.message}`);
    }
    return purchased.phone_number;
  }

  async processQueuedCalls(limit = 10): Promise<number> {
    if (!configured()) return 0;
    const { data: calls } = await this.supabase.from('call_logs').select('*').eq('status', 'queued').eq('consent_confirmed', true).order('created_at', { ascending: true }).limit(limit);
    let processed = 0;
    for (const call of calls || []) {
      try { await this.startCall(call); processed++; }
      catch (error: any) {
        await this.supabase.from('call_logs').update({ status: 'failed', summary: { error: error.message }, ended_at: new Date().toISOString() }).eq('id', call.id);
      }
    }
    return processed;
  }

  private async startCall(call: any) {
    const guard = await getSubscriptionGuard(call.user_id, this.supabase as any);
    if (!['pro', 'pro_plus'].includes(guard.plan) || !['active', 'trialing'].includes(guard.status)) throw new Error('Calling requires an active Pro or Pro+ subscription.');
    const { data: prefs } = await this.supabase.from('outreach_preferences').select('do_not_call').eq('user_id', call.user_id).maybeSingle();
    if (prefs?.do_not_call) throw new Error('User has disabled outbound calls.');
    const { data: lead } = call.lead_id ? await this.supabase.from('agent_leads').select('phone, phone_number, contact_phone, platform_username').eq('id', call.lead_id).single() : { data: null };
    const destination = lead?.phone || lead?.phone_number || lead?.contact_phone;
    if (!destination) throw new Error('Lead has no verified phone number.');
    const from = await this.ensureUserNumber(call.user_id);
    const twilioCall = await twilioRequest('/Calls.json', 'POST', new URLSearchParams({
      To: destination,
      From: from,
      Url: `${PUBLIC_BASE_URL}/api/webhooks/twilio/voice?call_id=${encodeURIComponent(call.id)}`,
      StatusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/status?call_id=${encodeURIComponent(call.id)}`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      Record: 'true',
    }));
    await this.supabase.from('call_logs').update({ status: 'provider_started', provider: 'twilio', provider_call_id: twilioCall.sid, started_at: new Date().toISOString() }).eq('id', call.id);
  }

  verifyWebhook(signature: string, url: string, params: Record<string, string>): boolean {
    if (!AUTH_TOKEN || !signature) return false;
    const payload = Object.keys(params).sort().map(key => key + params[key]).join('');
    const digest = crypto.createHmac('sha1', AUTH_TOKEN).update(url + payload).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  async handleStatus(callId: string, params: Record<string, string>) {
    const statusMap: Record<string, string> = { queued: 'provider_queued', initiated: 'provider_started', ringing: 'ringing', in_progress: 'in_progress', completed: 'completed', busy: 'failed', no_answer: 'no_answer', failed: 'failed', canceled: 'canceled' };
    const status = statusMap[params.CallStatus] || 'provider_started';
    await this.supabase.from('call_logs').update({
      status,
      provider_call_id: params.CallSid,
      ended_at: ['completed', 'failed', 'no_answer', 'busy', 'canceled'].includes(status) ? new Date().toISOString() : null,
      summary: { provider_status: params.CallStatus, duration_seconds: params.CallDuration || null },
    }).eq('id', callId);
  }

  async voiceInstructions(callId: string) {
    const { data: call } = await this.supabase.from('call_logs').select('summary').eq('id', callId).single();
    const goal = String(call?.summary?.requested_goal || 'Please connect the caller with the business owner.').replace(/[<&>]/g, '');
    return `<Response><Say voice="alice">${goal.slice(0, 800)}</Say><Record maxLength="120" playBeep="true" recordingStatusCallback="${PUBLIC_BASE_URL}/api/webhooks/twilio/recording?call_id=${encodeURIComponent(callId)}" /></Response>`;
  }

  async handleRecording(callId: string, recordingUrl: string) {
    await this.supabase.from('call_logs').update({ summary: { recording_url: recordingUrl }, status: 'recorded' }).eq('id', callId);
  }
}

export const telephonyService = new TelephonyService();
