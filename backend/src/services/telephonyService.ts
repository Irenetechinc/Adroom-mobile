import crypto from 'crypto';
import fetch from 'node-fetch';
import { getServiceSupabaseClient } from '../config/supabase';
import { getSubscriptionGuard } from './subscriptionGuard';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_COUNTRY = process.env.TWILIO_FROM_COUNTRY || 'US';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'https://backend.adroomai.com').replace(/\/$/, '');
const TWILIO_API = ACCOUNT_SID ? `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}` : '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const ELEVENLABS_VOICE_IDS_BY_COUNTRY = parseVoiceMap(process.env.ELEVENLABS_VOICE_IDS_BY_COUNTRY);
let elevenLabsVoicesCache: Array<{ voice_id: string; name?: string; labels?: Record<string, string> }> | null = null;

function parseVoiceMap(value?: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.error('[Telephony] ELEVENLABS_VOICE_IDS_BY_COUNTRY must be valid JSON.');
    return {};
  }
}

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

  async ensureUserNumber(userId: string, country = TWILIO_FROM_COUNTRY): Promise<string> {
    const { data: existing } = await this.supabase.from('user_phone_numbers').select('phone_number').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (existing?.phone_number) return existing.phone_number;
    if (!configured()) throw new Error('No outbound number is available because Twilio is not configured.');

    const normalizedCountry = /^[A-Z]{2}$/.test(country.toUpperCase()) ? country.toUpperCase() : TWILIO_FROM_COUNTRY;
    const available = await twilioRequest(`/AvailablePhoneNumbers/${normalizedCountry}/Local.json?VoiceEnabled=true`, 'GET');
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
      metadata: { country: normalizedCountry },
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
    const { data: calls } = await this.supabase.from('call_logs').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(limit);
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
    const { data: lead } = call.lead_id ? await this.supabase.from('agent_leads').select('phone, phone_number, contact_phone, platform_username, country, country_code, source, contact_source').eq('id', call.lead_id).single() : { data: null };
    const destination = lead?.phone || lead?.phone_number || lead?.contact_phone;
    if (!destination) throw new Error('Lead has no verified phone number.');
    const contactSource = String(call.summary?.contact_source || lead?.contact_source || lead?.source || '').toLowerCase();
    const publicBusinessSource = ['google_places', 'google_business_profile', 'public_domain', 'public_directory', 'website'].includes(contactSource);
    if (!call.consent_confirmed && !publicBusinessSource) {
      throw new Error('Outbound call requires consent or a recorded public-business contact source.');
    }
    const destinationCountry = String(call.summary?.country_code || lead?.country_code || lead?.country || TWILIO_FROM_COUNTRY);
    const from = await this.ensureUserNumber(call.user_id, destinationCountry);
    const twilioCall = await twilioRequest('/Calls.json', 'POST', new URLSearchParams({
      To: destination,
      From: from,
      Url: `${PUBLIC_BASE_URL}/api/webhooks/twilio/voice?call_id=${encodeURIComponent(call.id)}`,
      StatusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/status?call_id=${encodeURIComponent(call.id)}`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      Record: 'true',
    }));
    await this.supabase.from('call_logs').update({ status: 'provider_started', provider: 'twilio', provider_call_id: twilioCall.sid, started_at: new Date().toISOString(), summary: { ...(call.summary || {}), country_code: destinationCountry.toUpperCase(), from_number: from } }).eq('id', call.id);
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
    const country = String(call?.summary?.country_code || TWILIO_FROM_COUNTRY).toUpperCase();
    const voiceId = await this.selectVoiceForCountry(country);
    const audioUrl = voiceId ? await this.createElevenLabsAudio(callId, goal.slice(0, 800), voiceId) : null;
    const greeting = audioUrl ? `<Play>${audioUrl}</Play>` : `<Say voice="alice">${goal.slice(0, 800)}</Say>`;
    return `<Response>${greeting}<Record maxLength="120" playBeep="true" recordingStatusCallback="${PUBLIC_BASE_URL}/api/webhooks/twilio/recording?call_id=${encodeURIComponent(callId)}" /></Response>`;
  }

  private async selectVoiceForCountry(country: string): Promise<string> {
    if (ELEVENLABS_VOICE_IDS_BY_COUNTRY[country]) return ELEVENLABS_VOICE_IDS_BY_COUNTRY[country];
    if (!ELEVENLABS_API_KEY) return ELEVENLABS_DEFAULT_VOICE_ID;
    try {
      if (!elevenLabsVoicesCache) {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ELEVENLABS_API_KEY, Accept: 'application/json' } });
        if (response.ok) {
          const data: any = await response.json();
          elevenLabsVoicesCache = Array.isArray(data?.voices) ? data.voices : [];
        }
      }
      const countryTerms: Record<string, string[]> = {
        NG: ['nigerian', 'african', 'west african'], US: ['american', 'united states'],
        GB: ['british', 'english', 'united kingdom'], CA: ['canadian'], AU: ['australian'],
        ZA: ['south african'], GH: ['ghanaian'], KE: ['kenyan'], IN: ['indian'],
      };
      const terms = countryTerms[country] || [];
      const match = elevenLabsVoicesCache?.find((voice) => {
        const text = `${voice.name || ''} ${Object.values(voice.labels || {}).join(' ')}`.toLowerCase();
        return terms.some((term) => text.includes(term));
      });
      return match?.voice_id || ELEVENLABS_DEFAULT_VOICE_ID;
    } catch (error: any) {
      console.error(`[Telephony] ElevenLabs voice selection failed for ${country}:`, error.message);
      return ELEVENLABS_DEFAULT_VOICE_ID;
    }
  }

  private async createElevenLabsAudio(callId: string, text: string, voiceId: string): Promise<string | null> {
    if (!ELEVENLABS_API_KEY) return null;
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
      });
      if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status})`);
      const audio = Buffer.from(await response.arrayBuffer());
      const path = `calls/${callId}-${Date.now()}.mp3`;
      const upload = await this.supabase.storage.from('call-audio').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (upload.error) throw upload.error;
      const signed = await this.supabase.storage.from('call-audio').createSignedUrl(path, 60 * 60);
      if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Could not create call audio URL');
      return signed.data.signedUrl;
    } catch (error: any) {
      console.error(`[Telephony] ElevenLabs audio failed for ${callId}:`, error.message);
      return null;
    }
  }

  async handleRecording(callId: string, recordingUrl: string) {
    await this.supabase.from('call_logs').update({ summary: { recording_url: recordingUrl }, status: 'recorded' }).eq('id', callId);
  }
}

export const telephonyService = new TelephonyService();
