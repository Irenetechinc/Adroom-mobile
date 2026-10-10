import crypto from 'crypto';
import fetch from 'node-fetch';
import { getServiceSupabaseClient } from '../config/supabase';
import { getSubscriptionGuard } from './subscriptionGuard';
import { AIEngine, runWithAIRequestContext } from '../config/ai-models';
import { callCampaignService } from './callCampaignService';
import { normalizePhoneE164 } from './callCampaignRules';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_COUNTRY = process.env.TWILIO_FROM_COUNTRY || 'US';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'https://backend.adroomai.com').replace(/\/$/, '');
const TWILIO_API = ACCOUNT_SID ? `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}` : '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const ELEVENLABS_VOICE_IDS_BY_COUNTRY = parseVoiceMap(process.env.ELEVENLABS_VOICE_IDS_BY_COUNTRY);
let elevenLabsVoicesCache: Array<{ voice_id: string; name?: string; labels?: Record<string, string> }> | null = null;
const MAX_VOICE_TURNS = 6;
const MAX_VOICE_TRANSCRIPT_CHARS = 12000;
const VOICE_GATHER_TIMEOUT_SECONDS = 7;
const VOICE_TURN_AI_TIMEOUT_MS = 6500;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeVoiceText(value: unknown, maxLength = 700): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function appendVoiceTranscript(existing: unknown, entries: string[]): string {
  const combined = [String(existing || '').trim(), ...entries].filter(Boolean).join('\n');
  return combined.slice(-MAX_VOICE_TRANSCRIPT_CHARS);
}

function isCallTerminal(status: unknown): boolean {
  return ['completed', 'failed', 'no_answer', 'canceled', 'recorded'].includes(String(status || '').toLowerCase());
}

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
  private ai = AIEngine.getInstance();

  static getConfigurationStatus() {
    const missingKeys = [
      !ACCOUNT_SID && 'TWILIO_ACCOUNT_SID',
      !AUTH_TOKEN && 'TWILIO_AUTH_TOKEN',
    ].filter(Boolean) as string[];
    return {
      ready: missingKeys.length === 0,
      missingKeys,
      publicBaseUrlSource: process.env.PUBLIC_BASE_URL ? 'PUBLIC_BASE_URL' : process.env.APP_URL ? 'APP_URL' : 'canonical_fallback',
    };
  }

  async ensureUserNumber(userId: string, country = TWILIO_FROM_COUNTRY): Promise<string> {
    const { data: existing, error: existingError } = await this.supabase.from('user_phone_numbers').select('phone_number').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (existingError) throw new Error(`Could not check for an existing Twilio number: ${existingError.message}`);
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
    const { data: calls, error } = await this.supabase.from('call_logs').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(limit);
    if (error) throw new Error(`Could not load queued calls: ${error.message}`);
    let processed = 0;
    for (const call of calls || []) {
      const { data: claimed, error: claimError } = await this.supabase
        .from('call_logs')
        .update({ status: 'processing' })
        .eq('id', call.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();
      if (claimError) {
        console.error(`[Telephony] Could not claim queued call ${call.id}: ${claimError.message}`);
        continue;
      }
      if (!claimed) continue;
      try { await this.startCall(claimed); processed++; }
      catch (error: any) {
        const rawErrorCode = String(error?.code || error?.message || 'CALL_START_FAILED');
        const errorCode = rawErrorCode.split(':')[0];
        const windowClosed = errorCode === 'CALL_WINDOW_CLOSED';
        const terminalStatus = windowClosed || [
          'CAMPAIGN_NOT_RUNNING',
          'CAMPAIGN_CONTACT_NOT_QUEUED',
          'CALL_CONSENT_REQUIRED',
          'CALL_SUPPRESSED',
          'CAMPAIGN_PHONE_CHANGED',
        ].includes(errorCode) ? 'canceled' : 'failed';
        const { data: updated, error: updateError } = await this.supabase.from('call_logs').update({
          status: terminalStatus,
          outcome: errorCode,
          summary: { ...(claimed.summary || {}), error: String(error?.message || errorCode) },
          ended_at: new Date().toISOString(),
        }).eq('id', call.id).eq('status', 'processing').select('id').maybeSingle();
        if (updateError) console.error(`[Telephony] Could not record call failure ${call.id}: ${updateError.message}`);
        if (updated && call.campaign_id) {
          if (windowClosed) {
            const nextAttemptAt = rawErrorCode.split(':').slice(1).join(':') || String(error?.message || '').split(':').slice(1).join(':');
            await this.supabase.from('call_campaign_contacts').update({
              status: 'scheduling',
              next_attempt_at: /^\d{4}-\d\d-\d\dT/.test(nextAttemptAt) ? nextAttemptAt : new Date(Date.now() + 3600000).toISOString(),
              last_outcome: 'waiting_for_local_call_window',
              updated_at: new Date().toISOString(),
            }).eq('id', call.campaign_contact_id).eq('status', 'queued');
          } else {
            await callCampaignService.finalizeCall(call.id, terminalStatus, claimed.summary || {}, errorCode);
          }
        }
      }
    }
    return processed;
  }

  private async startCall(call: any) {
    const guard = await getSubscriptionGuard(call.user_id, this.supabase as any);
    if (!['pro', 'pro_plus'].includes(guard.plan) || !['active', 'trialing'].includes(guard.status)) throw new Error('Calling requires an active Pro or Pro+ subscription.');
    const { data: prefs, error: preferencesError } = await this.supabase.from('outreach_preferences').select('do_not_call').eq('user_id', call.user_id).maybeSingle();
    if (preferencesError) throw new Error(`Could not verify calling preferences: ${preferencesError.message}`);
    if (prefs?.do_not_call) throw new Error('User has disabled outbound calls.');
    const { data: lead, error: leadError } = call.lead_id
      ? await this.supabase.from('agent_leads')
        .select('phone, phone_number, contact_phone, platform_username, country, country_code, call_consent')
        .eq('id', call.lead_id)
        .eq('user_id', call.user_id)
        .single()
      : { data: null, error: new Error('Call has no lead.') };
    if (leadError || !lead) throw new Error(`Could not load call lead: ${leadError?.message || 'lead not found'}`);
    if (lead.call_consent !== true || call.consent_confirmed !== true) {
      throw new Error('Outbound call requires recorded, explicit consent from this lead.');
    }
    const campaignContext = await callCampaignService.assertCallCanStart(call, lead);
    const rawDestination = lead.phone || lead.phone_number || lead.contact_phone;
    if (!rawDestination) throw new Error('Lead has no phone number.');
    const destination = String(rawDestination).trim().replace(/[()\s-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(destination)) {
      throw new Error('Lead phone number must be in E.164 format, including its country code.');
    }
    const destinationCountry = String(call.summary?.country_code || lead?.country_code || lead?.country || TWILIO_FROM_COUNTRY);
    const from = await this.ensureUserNumber(call.user_id, destinationCountry);
    const { data: charge, error: chargeError } = await this.supabase.rpc('charge_call_credits', {
      p_call_id: call.id,
      p_user_id: call.user_id,
      p_credits: 1,
    });
    if (chargeError) throw new Error(`CALL_CREDIT_CHARGE_FAILED:${chargeError.message}`);
    if (!charge?.ok) {
      const reason = String(charge?.reason || 'CALL_CREDIT_CHARGE_FAILED');
      const failure = new Error(reason);
      (failure as any).code = reason;
      throw failure;
    }
    await callCampaignService.markAttemptStarted(call, campaignContext);
    const twilioCall = await twilioRequest('/Calls.json', 'POST', new URLSearchParams({
      To: destination,
      From: from,
      Url: `${PUBLIC_BASE_URL}/api/webhooks/twilio/voice?call_id=${encodeURIComponent(call.id)}`,
      StatusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/status?call_id=${encodeURIComponent(call.id)}`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      RecordingStatusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/recording?call_id=${encodeURIComponent(call.id)}`,
      RecordingStatusCallbackEvent: 'completed',
      Record: 'true',
      TimeLimit: '180',
    }));
    const { error: updateError } = await this.supabase.from('call_logs').update({
      status: 'provider_started',
      provider: 'twilio',
      provider_call_id: twilioCall.sid,
      started_at: new Date().toISOString(),
      summary: { ...(call.summary || {}), country_code: destinationCountry.toUpperCase(), from_number: from },
    }).eq('id', call.id).eq('status', 'processing');
    if (updateError) throw new Error(`Twilio started the call, but its call record could not be updated: ${updateError.message}`);
  }

  verifyWebhook(signature: string, url: string, params: Record<string, string>): boolean {
    if (!AUTH_TOKEN || !signature) return false;
    const payload = Object.keys(params).sort().map(key => key + params[key]).join('');
    const digest = crypto.createHmac('sha1', AUTH_TOKEN).update(url + payload).digest('base64');
    const expected = Buffer.from(digest);
    const received = Buffer.from(signature);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  createRecordingPlaybackSignature(callId: string, expiresAt: number): string {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SESSION_SECRET || '';
    if (!key) throw new Error('Call recording playback signing is not configured.');
    return crypto.createHmac('sha256', key).update(`${callId}.${expiresAt}`).digest('hex');
  }

  verifyRecordingPlaybackSignature(callId: string, expiresAt: number, signature: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 900 || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SESSION_SECRET || '';
    if (!key) return false;
    const expected = Buffer.from(this.createRecordingPlaybackSignature(callId, expiresAt), 'hex');
    const received = Buffer.from(signature, 'hex');
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  async downloadRecording(recordingUrl: string): Promise<Buffer> {
    if (!configured()) throw new Error('Twilio recording playback is not configured.');
    const parsed = new URL(recordingUrl);
    const expectedPrefix = `/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/`;
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== 'api.twilio.com'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !parsed.pathname.startsWith(expectedPrefix)
      || !/^RE[a-fA-F0-9]+$/.test(parsed.pathname.slice(expectedPrefix.length))
    ) {
      throw new Error('Stored recording URL is not a valid Twilio recording resource.');
    }
    const url = `${parsed.toString().replace(/\/$/, '')}.mp3`;
    const response = await fetch(url, {
      headers: { Authorization: basicAuth(), Accept: 'audio/mpeg' },
    });
    if (!response.ok) throw new Error(`Twilio recording download failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  async handleStatus(callId: string, params: Record<string, string>) {
    const statusMap: Record<string, string> = { queued: 'provider_queued', initiated: 'provider_started', ringing: 'ringing', in_progress: 'in_progress', completed: 'completed', busy: 'failed', no_answer: 'no_answer', failed: 'failed', canceled: 'canceled' };
    const status = statusMap[params.CallStatus] || 'provider_started';
    const { data: call, error: readError } = await this.supabase.from('call_logs')
      .select('status,summary,user_id,campaign_id,campaign_contact_id')
      .eq('id', callId).maybeSingle();
    if (readError) throw new Error(`Could not load call status: ${readError.message}`);
    if (!call) return;
    const terminalStatuses = ['completed', 'failed', 'no_answer', 'canceled', 'recorded'];
    if (terminalStatuses.includes(call.status) && !terminalStatuses.includes(status)) return;
    const patch: Record<string, any> = {
      status,
      provider_call_id: params.CallSid,
      outcome: call.summary?.voice_disposition || status,
      summary: {
        ...(call.summary || {}),
        provider_status: params.CallStatus,
        duration_seconds: params.CallDuration || call.summary?.duration_seconds || null,
      },
    };
    if (terminalStatuses.includes(status)) patch.ended_at = new Date().toISOString();
    const { error } = await this.supabase.from('call_logs').update(patch).eq('id', callId);
    if (error) throw new Error(`Could not save call status: ${error.message}`);
    if (terminalStatuses.includes(status)) {
      await callCampaignService.finalizeCall(callId, status, {
        ...(call.summary || {}),
        provider_status: params.CallStatus,
        duration_seconds: params.CallDuration || call.summary?.duration_seconds || null,
      });
    }
  }

  private hangupXml(message?: string): string {
    const spoken = message ? `<Say voice="alice">${escapeXml(safeVoiceText(message))}</Say>` : '';
    return `<Response>${spoken}<Hangup/></Response>`;
  }

  private gatherXml(callId: string, turn: number, prompt: string): string {
    const action = `${PUBLIC_BASE_URL}/api/webhooks/twilio/voice/turn?call_id=${encodeURIComponent(callId)}&amp;turn=${turn}`;
    return `<Gather input="speech" action="${action}" method="POST" language="en-US" speechTimeout="auto" timeout="${VOICE_GATHER_TIMEOUT_SECONDS}" actionOnEmptyResult="true"><Say voice="alice">${escapeXml(safeVoiceText(prompt, 240))}</Say></Gather>`;
  }

  private async speechXml(callId: string, text: string, country: string): Promise<string> {
    const voiceId = await this.selectVoiceForCountry(country);
    const audioUrl = voiceId ? await this.createElevenLabsAudio(callId, text, voiceId) : null;
    return audioUrl
      ? `<Play>${escapeXml(audioUrl)}</Play>`
      : `<Say voice="alice">${escapeXml(text)}</Say>`;
  }

  private async speechAndHangupXml(callId: string, text: string, country: string): Promise<string> {
    return `<Response>${await this.speechXml(callId, text, country)}<Hangup/></Response>`;
  }

  private async loadVoiceCall(callId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('call_logs')
      .select('id,user_id,lead_id,status,consent_confirmed,campaign_id,campaign_contact_id,summary,transcript')
      .eq('id', callId)
      .maybeSingle();
    if (error) throw new Error(`Could not load voice call: ${error.message}`);
    return data || null;
  }

  private async checkVoiceEligibility(call: any): Promise<{ allowed: boolean; plan?: string; status?: string; reason?: string }> {
    if (!call?.user_id || !call?.lead_id || call.consent_confirmed !== true) {
      return { allowed: false, reason: 'call_consent_not_confirmed' };
    }
    const [leadResult, preferencesResult, subscriptionResult, campaignResult] = await Promise.all([
      this.supabase.from('agent_leads')
        .select('call_consent,phone,phone_number,contact_phone')
        .eq('id', call.lead_id)
        .eq('user_id', call.user_id)
        .maybeSingle(),
      this.supabase.from('outreach_preferences')
        .select('do_not_call')
        .eq('user_id', call.user_id)
        .maybeSingle(),
      this.supabase.from('subscriptions')
        .select('plan, status')
        .eq('user_id', call.user_id)
        .maybeSingle(),
      call.campaign_id
        ? this.supabase.from('call_campaigns').select('status').eq('id', call.campaign_id).eq('user_id', call.user_id).maybeSingle()
        : Promise.resolve({ data: { status: 'running' }, error: null }),
    ]);
    const phone = normalizePhoneE164(leadResult.data?.phone || leadResult.data?.phone_number || leadResult.data?.contact_phone);
    const suppressionResult = phone
      ? await this.supabase.from('call_suppressions').select('id').eq('user_id', call.user_id).eq('phone_e164', phone).maybeSingle()
      : { data: null, error: null };
    const error = leadResult.error || preferencesResult.error || subscriptionResult.error || campaignResult.error || suppressionResult.error;
    if (error) return { allowed: false, reason: `eligibility_check_failed:${error.message}` };
    const plan = String(subscriptionResult.data?.plan || 'none');
    const status = String(subscriptionResult.data?.status || 'inactive');
    if (leadResult.data?.call_consent !== true) return { allowed: false, plan, status, reason: 'lead_consent_revoked' };
    if (suppressionResult.data) return { allowed: false, plan, status, reason: 'call_suppressed' };
    if (campaignResult.data?.status !== 'running') return { allowed: false, plan, status, reason: 'campaign_not_running' };
    if (preferencesResult.data?.do_not_call === true) return { allowed: false, plan, status, reason: 'user_do_not_call_enabled' };
    if (!['pro', 'pro_plus'].includes(plan) || !['active', 'trialing'].includes(status)) {
      return { allowed: false, plan, status, reason: 'calling_plan_inactive' };
    }
    return { allowed: true, plan, status };
  }

  private async saveVoiceState(call: any, summaryPatch: Record<string, any>, transcriptEntries: string[]): Promise<void> {
    const summary = { ...(call.summary || {}), ...summaryPatch };
    const transcript = appendVoiceTranscript(call.transcript, transcriptEntries);
    const { error } = await this.supabase.from('call_logs').update({ summary, transcript }).eq('id', call.id);
    if (error) throw new Error(`Could not save voice conversation: ${error.message}`);
    call.summary = summary;
    call.transcript = transcript;
  }

  async voiceInstructions(callId: string): Promise<string> {
    try {
      const call = await this.loadVoiceCall(callId);
      if (!call || isCallTerminal(call.status)) return this.hangupXml();
      const eligibility = await this.checkVoiceEligibility(call);
      if (!eligibility.allowed) {
        console.warn(`[Telephony] Ending call ${callId} before greeting: ${eligibility.reason}`);
        return this.hangupXml('I’m sorry, I can’t continue this call. Goodbye.');
      }

      const existingTurn = Number(call.summary?.voice_turn_index);
      if (call.summary?.voice_conversation_started && Number.isFinite(existingTurn)) {
        const lastResponse = safeVoiceText(call.summary?.voice_last_response || 'Please go ahead.');
        if (existingTurn >= MAX_VOICE_TURNS) return this.hangupXml(lastResponse);
        const audio = await this.speechXml(callId, lastResponse, String(call.summary?.country_code || TWILIO_FROM_COUNTRY));
        return `<Response>${audio}${this.gatherXml(callId, existingTurn + 1, 'What else would you like to know?')}</Response>`;
      }

      const subject = safeVoiceText(call.summary?.product_name || call.summary?.requested_goal || 'the product or service you asked about', 240);
      const greeting = `Hi, I’m an AI assistant calling about ${subject}. This call is recorded. Is now a good time to talk?`;
      await this.saveVoiceState(call, {
        voice_conversation_started: true,
        voice_turn_index: 0,
        voice_turn_count: 0,
        voice_no_speech_count: 0,
        voice_last_response: greeting,
        voice_started_at: new Date().toISOString(),
        voice_ai_plan: eligibility.plan,
        voice_ai_status: eligibility.status,
      }, [`AI: ${greeting}`]);
      const audio = await this.speechXml(callId, greeting, String(call.summary?.country_code || TWILIO_FROM_COUNTRY));
      return `<Response>${audio}${this.gatherXml(callId, 1, 'Please go ahead.')}</Response>`;
    } catch (error: any) {
      console.error(`[Telephony] Could not prepare voice conversation ${callId}:`, error.message);
      return this.hangupXml('I’m sorry, I can’t continue this call right now. Goodbye.');
    }
  }

  async handleVoiceTurn(callId: string, turn: number, rawSpeech: unknown): Promise<string> {
    try {
      if (!Number.isSafeInteger(turn) || turn < 1 || turn > MAX_VOICE_TURNS) return this.hangupXml();
      const call = await this.loadVoiceCall(callId);
      if (!call || isCallTerminal(call.status)) return this.hangupXml();

      const eligibility = await this.checkVoiceEligibility(call);
      if (!eligibility.allowed) {
        await this.saveVoiceState(call, {
          voice_disposition: 'cancelled_by_policy',
          voice_stopped_reason: eligibility.reason,
        }, []);
        return this.hangupXml('I’m sorry, I can’t continue this call. Goodbye.');
      }

      const currentTurn = Number(call.summary?.voice_turn_index || 0);
      if (turn <= currentTurn) {
        const lastResponse = safeVoiceText(call.summary?.voice_last_response || 'Thank you for speaking with me.');
        if (currentTurn >= MAX_VOICE_TURNS) return this.hangupXml(lastResponse);
        const audio = await this.speechXml(callId, lastResponse, String(call.summary?.country_code || TWILIO_FROM_COUNTRY));
        return `<Response>${audio}${this.gatherXml(callId, currentTurn + 1, 'What else would you like to know?')}</Response>`;
      }
      if (turn !== currentTurn + 1 || !call.summary?.voice_conversation_started) return this.hangupXml();

      const speech = safeVoiceText(rawSpeech, 1000);
      const nextTurnCount = Number(call.summary?.voice_turn_count || 0) + (speech ? 1 : 0);
      const priorSilenceCount = Number(call.summary?.voice_no_speech_count || 0);
      if (!speech) {
        const silenceCount = priorSilenceCount + 1;
        const message = silenceCount > 1 || turn >= MAX_VOICE_TURNS
          ? 'I’m sorry we could not connect. Goodbye.'
          : 'I didn’t hear a response. Are you still there?';
        await this.saveVoiceState(call, {
          voice_turn_index: turn,
          voice_turn_count: nextTurnCount,
          voice_no_speech_count: silenceCount,
          voice_last_response: message,
          ...(silenceCount > 1 || turn >= MAX_VOICE_TURNS ? { voice_disposition: 'no_response' } : {}),
        }, [`AI: ${message}`]);
        if (silenceCount > 1 || turn >= MAX_VOICE_TURNS) return this.hangupXml(message);
        return `<Response>${this.gatherXml(callId, turn + 1, message)}</Response>`;
      }

      const optedOut = /\b(?:stop\s+(?:calling|call(?:s)?|contacting|texting)|(?:do not|don't|never)\s+(?:call|contact)(?:\s+me)?|no\s+more\s+calls?|remove\s+(?:me|my\s+number)\s+from\s+(?:your\s+)?(?:call(?:ing)?\s+)?(?:list|system)|take\s+me\s+off\s+(?:your\s+)?(?:call(?:ing)?\s+)?list|opt[\s-]?out|unsubscribe)\b/i.test(speech);
      if (optedOut) {
        const { error: consentError } = await this.supabase.from('agent_leads').update({
          call_consent: false,
          call_consent_at: null,
          call_consent_source: 'lead_revoked_during_call',
        }).eq('id', call.lead_id).eq('user_id', call.user_id);
        if (consentError) console.error(`[Telephony] Could not persist call opt-out for call ${callId}: ${consentError.message}`);
        const { data: lead } = await this.supabase.from('agent_leads')
          .select('phone,phone_number,contact_phone')
          .eq('id', call.lead_id).eq('user_id', call.user_id).maybeSingle();
        await callCampaignService.recordCallOptOut(call, lead);
        const message = 'I understand. We will not call you again. Goodbye.';
        await this.saveVoiceState(call, {
          voice_turn_index: turn,
          voice_turn_count: nextTurnCount,
          voice_last_response: message,
          voice_disposition: 'do_not_call',
          voice_opt_out_persisted: !consentError,
        }, [`Lead: ${speech}`, `AI: ${message}`]);
        return this.hangupXml(message);
      }

      const goal = safeVoiceText(call.summary?.requested_goal || 'the product or service the caller asked about', 500);
      const productFacts = safeVoiceText(JSON.stringify({
        product_name: call.summary?.product_name || null,
        product_description: call.summary?.product_description || null,
        product_price: call.summary?.product_price || null,
      }), 1800);
      const callPlan = safeVoiceText(JSON.stringify(call.summary?.call_plan || {}), 1200);
      const history = safeVoiceText(call.transcript || '', 5000);
      const prompt = `You are the disclosed AI assistant in a short, recorded business phone conversation.
Use the caller's words and this call objective to answer naturally, then ask at most one relevant follow-up question.
Never invent product facts, prices, guarantees, discounts, or private facts. Do not request payment details, passwords, or sensitive personal information. If the caller is not interested or asks to end the call, politely end it. If they ask not to be called again, confirm and end the call.
Keep the reply to 1–2 short spoken sentences. Return JSON only: {"reply":"...", "end_call":false, "disposition":"continue"}.
OBJECTIVE: ${goal}
APPROVED PRODUCT FACTS: ${productFacts}
EXISTING STRATEGY CALL NOTES: ${callPlan}
RECENT TRANSCRIPT: ${history}
CALLER JUST SAID: ${speech}`;

      let response: any = null;
      let timeout: NodeJS.Timeout | undefined;
      try {
        const generate = runWithAIRequestContext({
          userId: call.user_id,
          plan: eligibility.plan || String(call.summary?.voice_ai_plan || 'trial'),
          status: eligibility.status || String(call.summary?.voice_ai_status || 'active'),
        }, () => this.ai.generateJson(prompt));
        response = await Promise.race([
          generate,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Voice response timed out')), VOICE_TURN_AI_TIMEOUT_MS);
          }),
        ]);
      } catch (error: any) {
        console.warn(`[Telephony] AI voice reply failed for call ${callId}: ${error.message}`);
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      const reply = safeVoiceText(response?.reply, 500);
      const reachedTurnLimit = turn >= MAX_VOICE_TURNS;
      const shouldEnd = response?.end_call === true || !reply || reachedTurnLimit;
      const assistantReply = reply || 'I’m sorry, I can’t continue this conversation right now. Goodbye.';
      const disposition = safeVoiceText(
        reachedTurnLimit ? 'turn_limit' : response?.disposition || (shouldEnd ? 'ai_unavailable' : 'continue'),
        80,
      );
      await this.saveVoiceState(call, {
        voice_turn_index: turn,
        voice_turn_count: nextTurnCount,
        voice_no_speech_count: 0,
        voice_last_response: assistantReply,
        ...(shouldEnd ? { voice_disposition: disposition } : {}),
      }, [`Lead: ${speech}`, `AI: ${assistantReply}`]);

      if (shouldEnd) {
        return this.speechAndHangupXml(callId, assistantReply, String(call.summary?.country_code || TWILIO_FROM_COUNTRY));
      }
      const audio = await this.speechXml(callId, assistantReply, String(call.summary?.country_code || TWILIO_FROM_COUNTRY));
      return `<Response>${audio}${this.gatherXml(callId, turn + 1, 'What else would you like to know?')}</Response>`;
    } catch (error: any) {
      console.error(`[Telephony] Voice turn failed for call ${callId}:`, error.message);
      return this.hangupXml('I’m sorry, I can’t continue this call right now. Goodbye.');
    }
  }

  private async selectVoiceForCountry(country: string): Promise<string> {
    if (ELEVENLABS_VOICE_IDS_BY_COUNTRY[country]) return ELEVENLABS_VOICE_IDS_BY_COUNTRY[country];
    if (!ELEVENLABS_API_KEY) return ELEVENLABS_DEFAULT_VOICE_ID;
    try {
      if (!elevenLabsVoicesCache) {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY, Accept: 'application/json' },
          timeout: 2000,
        } as any);
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
        timeout: 3000,
      } as any);
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
    const { data: call, error: readError } = await this.supabase.from('call_logs').select('summary').eq('id', callId).maybeSingle();
    if (readError) throw new Error(`Could not load call recording state: ${readError.message}`);
    if (!call) return;
    const { error } = await this.supabase.from('call_logs').update({
      summary: { ...(call.summary || {}), recording_url: recordingUrl, recording_saved_at: new Date().toISOString() },
    }).eq('id', callId);
    if (error) throw new Error(`Could not save call recording: ${error.message}`);
  }
}

export const telephonyService = new TelephonyService();
