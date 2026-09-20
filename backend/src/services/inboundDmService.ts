/**
 * Inbound DM Detection Service
 *
 * Polls connected platforms every 10 minutes for replies from leads that
 * have already received an outbound DM. When a reply is detected it:
 *   1. Deduplicates by external platform message ID (stored in meta)
 *   2. Stores the message in lead_dm_messages as direction='inbound'
 *   3. Uses AI to classify the reply (interested/question/stop/negative)
 *   4. Updates the lead's intent_score and stage accordingly
 *   5. Schedules a follow-up agent_tasks entry if warranted
 *
 * Platform coverage:
 *   - Facebook Messenger (page conversations API)
 *   - Instagram DM (Instagram Graph API)
 *   - Twitter/X DM (v2 API, elevated access required — gracefully skipped if unavailable)
 */

import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { pushService } from './pushService';

const FB_GRAPH = 'https://graph.facebook.com/v25.0';

interface InboundMsg {
  externalId: string;
  senderPsid: string;
  text: string;
  timestamp: string;
}

interface LeadRow {
  id: string;
  platform: string;
  platform_user_id: string;
  platform_username: string;
  user_id: string;
  strategy_id: string;
  intent_score: number;
  stage: string;
  dm_sequence_step: number;
  last_contacted_at: string | null;
  created_at: string;
}

class InboundDmService {
  private ai = AIEngine.getInstance();
  private supabase = getServiceSupabaseClient();

  async runCycle(): Promise<void> {
    console.log('[InboundDM] Starting inbound reply detection cycle...');

    // Get all users with active SALESMAN strategies that have contacted leads
    const { data: strategies } = await this.supabase
      .from('strategies')
      .select('id, user_id')
      .eq('is_active', true)
      .eq('agent_type', 'SALESMAN');

    if (!strategies?.length) {
      console.log('[InboundDM] No active SALESMAN strategies — skipping');
      return;
    }

    // Deduplicate by user_id
    const userIds = [...new Set(strategies.map((s: any) => s.user_id))];

    for (const userId of userIds) {
      try {
        await this.processUser(userId as string);
      } catch (e: any) {
        console.error(`[InboundDM] Error processing user ${userId}:`, e.message);
      }
    }

    console.log('[InboundDM] Cycle complete');
  }

  private async processUser(userId: string): Promise<void> {
    // Get leads that have had at least one outbound message sent
    const { data: leads } = await this.supabase
      .from('agent_leads')
      .select('id, platform, platform_user_id, platform_username, user_id, strategy_id, intent_score, stage, dm_sequence_step, last_contacted_at, created_at')
      .eq('user_id', userId)
      .gt('dm_sequence_step', 0)
      .not('stage', 'eq', 'lost')
      .not('stage', 'eq', 'won')
      .order('last_contacted_at', { ascending: false })
      .limit(30);

    if (!leads?.length) return;

    // Get platform tokens
    const { data: configs } = await this.supabase
      .from('ad_configs')
      .select('platform, access_token, page_id, instagram_account_id, open_id')
      .eq('user_id', userId)
      .not('access_token', 'is', null);

    if (!configs?.length) return;

    const tokenMap: Record<string, any> = {};
    for (const cfg of configs) tokenMap[cfg.platform] = cfg;

    // Group leads by platform
    const byPlatform: Record<string, LeadRow[]> = {};
    for (const lead of leads as LeadRow[]) {
      if (!byPlatform[lead.platform]) byPlatform[lead.platform] = [];
      byPlatform[lead.platform].push(lead);
    }

    // Process each platform
    for (const [platform, platformLeads] of Object.entries(byPlatform)) {
      const cfg = tokenMap[platform];
      if (!cfg) continue;

      try {
        switch (platform) {
          case 'facebook':
            await this.processFacebook(userId, cfg, platformLeads);
            break;
          case 'instagram':
            await this.processInstagram(userId, cfg, platformLeads);
            break;
          case 'twitter':
          case 'x':
            await this.processTwitter(userId, cfg, platformLeads);
            break;
        }
      } catch (e: any) {
        console.error(`[InboundDM] ${platform} check failed for user ${userId}:`, e.message);
      }
    }
  }

  // ─── Facebook Messenger ─────────────────────────────────────────────────────

  private async processFacebook(userId: string, cfg: any, leads: LeadRow[]): Promise<void> {
    const { access_token, page_id } = cfg;
    if (!access_token || !page_id) return;

    // Build a PSID lookup map for fast matching
    const leadByPsid = new Map(leads.map(l => [l.platform_user_id, l]));

    // Fetch the page's Messenger conversations with recent messages
    const url = `${FB_GRAPH}/${page_id}/conversations?platform=messenger`
      + `&fields=id,participants,messages.limit(10){id,message,created_time,from}`
      + `&access_token=${access_token}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const err: any = await resp.json();
      console.error(`[InboundDM] Facebook conversations fetch failed:`, err?.error?.message);
      return;
    }

    const data: any = await resp.json();
    const conversations: any[] = data?.data || [];

    for (const convo of conversations) {
      // Identify the non-page participant (the lead)
      const participants: any[] = convo.participants?.data || [];
      const leadParticipant = participants.find((p: any) => p.id !== page_id);
      if (!leadParticipant) continue;

      const lead = leadByPsid.get(leadParticipant.id);
      if (!lead) continue;

      // Cut-off: only process messages after the last outbound contact
      const cutoff = lead.last_contacted_at
        ? new Date(lead.last_contacted_at).getTime()
        : new Date(lead.created_at).getTime();

      const messages: any[] = convo.messages?.data || [];

      for (const msg of messages) {
        // Only process messages from the lead (not from the page)
        if (msg.from?.id === page_id) continue;

        const msgTime = new Date(msg.created_time).getTime();
        if (msgTime <= cutoff) continue;
        if (!msg.message?.trim()) continue;

        await this.storeInbound(userId, lead, {
          externalId: msg.id,
          senderPsid: msg.from?.id || leadParticipant.id,
          text: msg.message,
          timestamp: msg.created_time,
        });
      }
    }
  }

  // ─── Instagram DM ────────────────────────────────────────────────────────────

  private async processInstagram(userId: string, cfg: any, leads: LeadRow[]): Promise<void> {
    const { access_token, instagram_account_id } = cfg;
    if (!access_token || !instagram_account_id) return;

    const leadByPsid = new Map(leads.map(l => [l.platform_user_id, l]));

    // Instagram conversations via Graph API
    const url = `${FB_GRAPH}/${instagram_account_id}/conversations?platform=instagram`
      + `&fields=id,participants,messages.limit(10){id,message,created_time,from}`
      + `&access_token=${access_token}`;

    const resp = await fetch(url);
    if (!resp.ok) return; // Instagram DM API requires specific permissions — skip silently

    const data: any = await resp.json();
    const conversations: any[] = data?.data || [];

    for (const convo of conversations) {
      const participants: any[] = convo.participants?.data || [];
      const leadParticipant = participants.find((p: any) => p.id !== instagram_account_id);
      if (!leadParticipant) continue;

      const lead = leadByPsid.get(leadParticipant.id);
      if (!lead) continue;

      const cutoff = lead.last_contacted_at
        ? new Date(lead.last_contacted_at).getTime()
        : new Date(lead.created_at).getTime();

      const messages: any[] = convo.messages?.data || [];

      for (const msg of messages) {
        if (msg.from?.id === instagram_account_id) continue;
        const msgTime = new Date(msg.created_time).getTime();
        if (msgTime <= cutoff) continue;
        if (!msg.message?.trim()) continue;

        await this.storeInbound(userId, lead, {
          externalId: msg.id,
          senderPsid: msg.from?.id || leadParticipant.id,
          text: msg.message,
          timestamp: msg.created_time,
        });
      }
    }
  }

  // ─── Twitter / X DM ──────────────────────────────────────────────────────────

  private async processTwitter(userId: string, cfg: any, leads: LeadRow[]): Promise<void> {
    const { access_token } = cfg;
    if (!access_token) return;

    const leadByUserId = new Map(leads.map(l => [l.platform_user_id, l]));

    // Twitter v2 DM Events API — requires Basic or Pro access
    const resp = await fetch('https://api.twitter.com/2/dm_events?dm_event.fields=created_at,text,sender_id,dm_conversation_id&max_results=50', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!resp.ok) {
      // Elevated access not available — skip silently, not an error
      console.log('[InboundDM] Twitter DM API not available (requires elevated access) — skipping');
      return;
    }

    const data: any = await resp.json();
    const events: any[] = data?.data || [];

    for (const event of events) {
      const senderId = event.sender_id;
      const lead = leadByUserId.get(senderId);
      if (!lead) continue;

      const cutoff = lead.last_contacted_at
        ? new Date(lead.last_contacted_at).getTime()
        : new Date(lead.created_at).getTime();

      const msgTime = new Date(event.created_at).getTime();
      if (msgTime <= cutoff) continue;
      if (!event.text?.trim()) continue;

      await this.storeInbound(userId, lead, {
        externalId: event.id,
        senderPsid: senderId,
        text: event.text,
        timestamp: event.created_at,
      });
    }
  }

  // ─── Store + Score + Update ───────────────────────────────────────────────────

  private async storeInbound(userId: string, lead: LeadRow, msg: InboundMsg): Promise<void> {
    // ── Dedup: check if we've already stored this message ────────────────────
    const { data: existing } = await this.supabase
      .from('lead_dm_messages')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('direction', 'inbound')
      .filter('meta->>external_message_id', 'eq', msg.externalId)
      .limit(1);

    if (existing?.length) return; // Already processed

    console.log(`[InboundDM] New reply from @${lead.platform_username} (${lead.platform}): "${msg.text.slice(0, 60)}..."`);

    // ── Push notification: lead replied ───────────────────────────────────────
    pushService.notifyLeadReplied(userId, {
      leadId: lead.id,
      leadName: lead.platform_username || 'A lead',
      platform: lead.platform,
      replyPreview: msg.text,
      strategyId: lead.strategy_id,
    }).catch(() => { /* best-effort */ });

    // ── Store inbound message ─────────────────────────────────────────────────
    await this.supabase.from('lead_dm_messages').insert({
      lead_id: lead.id,
      user_id: userId,
      direction: 'inbound',
      message: msg.text,
      platform: lead.platform,
      sent_at: msg.timestamp,
      meta: {
        external_message_id: msg.externalId,
        sender_psid: msg.senderPsid,
      },
    });

    // ── AI: classify the reply and decide next action ─────────────────────────
    await this.scoreAndActOnReply(userId, lead, msg.text);
  }

  private async scoreAndActOnReply(userId: string, lead: LeadRow, replyText: string): Promise<void> {
    const classifyPrompt = `A lead has replied to an outbound sales DM. Classify this reply and decide the next action.

LEAD CONTEXT:
- Platform: ${lead.platform}
- Current stage: ${lead.stage}
- Current intent score: ${lead.intent_score}
- DM sequence step: ${lead.dm_sequence_step}/3

THEIR REPLY: "${replyText}"

Classify the reply into exactly one of:
- "very_interested" — clearly wants to buy, asking how to proceed, explicitly saying yes
- "interested" — positive response, wants more info, curious but hasn't committed
- "question" — asking something specific about the product or service
- "neutral" — polite but non-committal, just acknowledging
- "not_now" — not ready but not a hard no (e.g. "maybe later", "next month")
- "negative" — expressing disinterest or dissatisfaction without blocking
- "stop" — explicit opt-out, "stop", "not interested", "leave me alone", "remove me"

Then return:
{
  "classification": "one of the above",
  "new_intent_score": <number 0.0–1.0 reflecting updated confidence>,
  "new_stage": "new|warm|engaged|nurturing|closing|won|lost",
  "should_reply_now": <true if the AI should send an immediate follow-up response>,
  "reply_urgency": "immediate|within_hour|next_cycle|none",
  "reasoning": "one sentence why"
}

Rules:
- "stop" → new_intent_score MUST be 0, new_stage MUST be "lost", should_reply_now MUST be false
- "very_interested" → new_stage should be "closing" if not already won
- "question" → should_reply_now is usually true
- Never decrease score for neutral or question replies`;

    let classification: any = null;
    try {
      const res = await this.ai.generateStrategyEconomy({}, classifyPrompt);
      classification = res.parsedJson;
    } catch {
      // If AI fails, apply safe defaults: store message, boost intent slightly, keep stage
      classification = {
        classification: 'neutral',
        new_intent_score: Math.min(lead.intent_score + 0.05, 0.95),
        new_stage: lead.stage,
        should_reply_now: false,
        reply_urgency: 'next_cycle',
      };
    }

    if (!classification) return;

    const now = new Date().toISOString();

    // ── Update lead: intent_score, stage, and mark as replied ────────────────
    const updates: Record<string, any> = {
      intent_score: Math.max(0, Math.min(1, classification.new_intent_score ?? lead.intent_score)),
      stage: classification.new_stage ?? lead.stage,
      updated_at: now,
    };

    // When a lead replies, reset the follow-up timer based on urgency
    if (classification.reply_urgency === 'immediate') {
      updates.next_followup_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
    } else if (classification.reply_urgency === 'within_hour') {
      updates.next_followup_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hr
    } else if (classification.reply_urgency === 'next_cycle') {
      updates.next_followup_at = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hr
    }

    await this.supabase.from('agent_leads').update(updates).eq('id', lead.id);

    console.log(`[InboundDM] Lead @${lead.platform_username} → "${classification.classification}" | intent: ${lead.intent_score.toFixed(2)} → ${updates.intent_score.toFixed(2)} | stage: ${lead.stage} → ${updates.stage}`);

    // ── Schedule an AI follow-up task if the reply warrants one ──────────────
    if (classification.should_reply_now && classification.classification !== 'stop') {
      const scheduleAt = classification.reply_urgency === 'immediate'
        ? new Date(Date.now() + 2 * 60 * 1000).toISOString()   // 2 min
        : classification.reply_urgency === 'within_hour'
          ? new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min
          : new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hr

      await this.supabase.from('agent_tasks').insert({
        user_id: userId,
        task_type: 'INBOUND_REPLY',
        status: 'pending',
        platform: lead.platform,
        scheduled_at: scheduleAt,
        content: {
          lead_id: lead.id,
          lead_username: lead.platform_username,
          lead_psid: lead.platform_user_id,
          inbound_text: replyText,
          classification: classification.classification,
          reasoning: classification.reasoning,
          current_step: lead.dm_sequence_step,
        },
        created_at: now,
      });

      console.log(`[InboundDM] Scheduled INBOUND_REPLY task for @${lead.platform_username} (urgency: ${classification.reply_urgency})`);
    }

    // ── Send push notification to user when a lead replies ───────────────────
    // Only notify for significant replies (not neutral/negative) to avoid noise
    if (['very_interested', 'interested', 'question'].includes(classification.classification)) {
      try {
        const emoji = classification.classification === 'very_interested' ? '🔥' : '💬';
        await pushService.send(userId, {
          title: `${emoji} Lead replied on ${lead.platform}`,
          body: `@${lead.platform_username}: "${replyText.slice(0, 80)}${replyText.length > 80 ? '…' : ''}"`,
          data: {
            type: 'lead_replied',
            leadId: lead.id,
            platform: lead.platform,
            classification: classification.classification,
            actionScreen: 'Interactions',
          },
        });
      } catch { /* push failure must never disrupt the detection cycle */ }
    }
  }
}

export const inboundDmService = new InboundDmService();
