import { getServiceSupabaseClient } from '../config/supabase';
import { getSubscriptionGuard } from './subscriptionGuard';
import { isEnabled as isFeatureEnabled } from './featureFlagService';
import { inferPhoneTimeZone, MAX_CAMPAIGN_CONTACTS, MAX_CAMPAIGN_DAILY_CALLS, MIN_CALL_GAP_MS, phoneCountryCode } from './callCompliance';
import { MemoryRetriever } from './memoryRetriever';
import { DecisionEngine } from './decisionEngine';
import { energyService } from './energyService';
import { creditManagementAgent } from './creditManagementAgent';
import { isFreeAIRequest } from '../config/ai-models';
import {
  isValidTimezone,
  isWithinCallWindow,
  nextCallWindowStart,
  normalizePhoneE164,
} from './callCampaignRules';

const ACTIVE_CALL_STATUSES = ['queued', 'processing', 'provider_started', 'provider_queued', 'ringing', 'in_progress'];
const OPEN_CONTACT_STATUSES = ['pending', 'scheduling', 'queued', 'calling'];
const TERMINAL_CONTACT_STATUSES = ['completed', 'no_answer', 'failed', 'converted', 'opted_out', 'blocked', 'stopped'];
const MAX_CONTACT_IMPORT = Math.min(200, MAX_CAMPAIGN_CONTACTS);
const CAMPAIGN_FAILURE_PAUSE_THRESHOLD = 3;

export class CallCampaignError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = 'CallCampaignError';
  }
}

function invalid(message: string, code = 'INVALID_CALL_CAMPAIGN') {
  return new CallCampaignError(400, code, message);
}

function migrationError() {
  return new CallCampaignError(503, 'CALL_CAMPAIGN_MIGRATION_REQUIRED', 'Call campaigns are not available until the call-campaign database migration is applied.');
}

function text(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

function validOptionalUrl(value: unknown): string | null {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

function toError(error: any, message: string): CallCampaignError {
  if (error?.code === '42P01' || error?.code === '42703' || /does not exist|schema cache/i.test(String(error?.message || ''))) {
    return migrationError();
  }
  return new CallCampaignError(500, 'CALL_CAMPAIGN_ERROR', message);
}

class CallCampaignService {
  private get db() {
    return getServiceSupabaseClient();
  }

  private async campaignForUser(userId: string, campaignId: string): Promise<any> {
    const { data, error } = await this.db.from('call_campaigns').select('*')
      .eq('id', campaignId).eq('user_id', userId).maybeSingle();
    if (error) throw toError(error, 'Could not load this call campaign.');
    if (!data) throw new CallCampaignError(404, 'CALL_CAMPAIGN_NOT_FOUND', 'Call campaign not found.');
    return data;
  }

  async options(userId: string) {
    try {
      const [strategyResult, leadResult] = await Promise.all([
        this.db.from('strategies')
          .select('id,goal,is_active,current_execution_plan,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(100),
        this.db.from('agent_leads')
          .select('id,platform_username,platform_user_id,phone,phone_number,contact_phone,country,country_code,contact_timezone,call_consent,call_consent_at')
          .eq('user_id', userId).eq('call_consent', true)
          .order('created_at', { ascending: false }).limit(500),
      ]);
      if (strategyResult.error) throw toError(strategyResult.error, 'Could not load your strategies.');
      if (leadResult.error) throw toError(leadResult.error, 'Could not load consented leads.');

      const eligible = (leadResult.data || []).map((lead: any) => ({
        ...lead,
        phone_e164: normalizePhoneE164(lead.phone || lead.phone_number || lead.contact_phone),
      })).filter((lead: any) => lead.phone_e164);
      const phones = eligible.map((lead: any) => lead.phone_e164);
      let suppressed = new Set<string>();
      if (phones.length) {
        const { data, error } = await this.db.from('call_suppressions').select('phone_e164')
          .eq('user_id', userId).in('phone_e164', phones);
        if (error) throw toError(error, 'Could not check the call suppression list.');
        suppressed = new Set((data || []).map((row: any) => String(row.phone_e164)));
      }
      return {
        strategies: (strategyResult.data || []).map((strategy: any) => ({
          id: strategy.id,
          goal: text(strategy.goal, 300),
          current_execution_plan: strategy.current_execution_plan || {},
        })),
        leads: eligible.filter((lead: any) => !suppressed.has(lead.phone_e164)).map((lead: any) => ({
          id: lead.id,
          name: text(lead.platform_username || lead.platform_user_id || 'Lead', 160),
          phone_e164: lead.phone_e164,
          country: text(lead.country_code || lead.country, 8),
          time_zone: isValidTimezone(lead.contact_timezone) ? lead.contact_timezone : null,
          consent_at: lead.call_consent_at || null,
        })),
      };
    } catch (error: any) {
      if (error instanceof CallCampaignError) throw error;
      throw toError(error, 'Could not load call campaign options.');
    }
  }

  async list(userId: string) {
    const { data: campaigns, error } = await this.db.from('call_campaigns').select('*')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
    if (error) throw toError(error, 'Could not load call campaigns.');
    const ids = (campaigns || []).map((campaign: any) => campaign.id);
    const counts: Record<string, Record<string, number>> = {};
    if (ids.length) {
      const { data: contacts, error: contactError } = await this.db.from('call_campaign_contacts')
        .select('campaign_id,status').eq('user_id', userId).in('campaign_id', ids).limit(10000);
      if (contactError) throw toError(contactError, 'Could not load campaign contact counts.');
      for (const contact of contacts || []) {
        counts[contact.campaign_id] ||= {};
        counts[contact.campaign_id][contact.status] = (counts[contact.campaign_id][contact.status] || 0) + 1;
      }
    }
    return (campaigns || []).map((campaign: any) => ({
      ...campaign,
      contact_counts: counts[campaign.id] || {},
      contact_count: Object.values(counts[campaign.id] || {}).reduce((sum, count) => sum + count, 0),
    }));
  }

  async contacts(userId: string, campaignId: string) {
    await this.campaignForUser(userId, campaignId);
    const { data, error } = await this.db.from('call_campaign_contacts').select('*')
      .eq('user_id', userId).eq('campaign_id', campaignId)
      .order('created_at', { ascending: false }).limit(1000);
    if (error) throw toError(error, 'Could not load campaign contacts.');
    return data || [];
  }

  async create(userId: string, input: any) {
    if (!(await isFeatureEnabled('calling_ui', userId))) {
      throw new CallCampaignError(403, 'CALLING_DISABLED', 'Calling is currently unavailable.');
    }
    const name = text(input?.name, 120);
    const goal = text(input?.goal, 500);
    const productName = text(input?.product_name, 160);
    const productDescription = text(input?.product_description, 2000);
    const timezone = String(input?.default_timezone || '');
    const strategyId = text(input?.strategy_id, 80);
    const startHour = Number(input?.calling_start_hour ?? 9);
    const endHour = Number(input?.calling_end_hour ?? 17);
    const dailyLimit = Number(input?.daily_limit ?? 10);
    const maxAttempts = Number(input?.max_attempts ?? 2);
    const followUpDays = Number(input?.follow_up_days ?? 7);
    if (!name || !goal || !productName || !productDescription) {
      throw invalid('Campaign name, goal, product name, and product description are required.');
    }
    if (!isValidTimezone(timezone)) throw invalid('Choose a valid IANA time zone, such as Africa/Lagos.');
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) {
      throw invalid('Calling hours must be a valid range, such as 9 to 17.');
    }
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 25) throw invalid('Daily call limit must be between 1 and 25.');
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw invalid('Maximum attempts must be between 1 and 3.');
    if (!Number.isInteger(followUpDays) || followUpDays < 1 || followUpDays > 90) throw invalid('Follow-up interval must be between 1 and 90 days.');
    if (!strategyId) throw invalid('Select an existing strategy for this campaign.');

    const { data: strategy, error: strategyError } = await this.db.from('strategies')
      .select('id,goal,current_execution_plan').eq('id', strategyId).eq('user_id', userId).maybeSingle();
    if (strategyError) throw toError(strategyError, 'Could not validate the selected strategy.');
    if (!strategy) throw new CallCampaignError(404, 'STRATEGY_NOT_FOUND', 'Select one of your existing strategies.');
    const cma = await creditManagementAgent.evaluate(userId, 'generate_call_strategy');
    if (cma.decision === 'deny_tier') throw new CallCampaignError(403, 'PLAN_REQUIRED', cma.reason);
    if (cma.decision === 'deny_cap') throw new CallCampaignError(429, 'DAILY_CAP_REACHED', cma.reason);
    if (cma.decision === 'deny_cooldown') throw new CallCampaignError(429, 'COOLDOWN_ACTIVE', cma.reason);
    const energy = await energyService.checkEnergy(userId, 'generate_call_strategy');
    if (energy.balance < cma.credits) {
      throw new CallCampaignError(402, 'INSUFFICIENT_ENERGY', `Generating the call strategy requires ${cma.credits} credits; the current balance is ${energy.balance.toFixed(2)}.`);
    }

    const retriever = new MemoryRetriever(this.db as any);
    const context = await retriever.getAllContext(userId, strategy.product_id, 'product');
    const { data: savedProduct, error: productError } = strategy.product_id
      ? await this.db.from('product_memory').select('*')
        .eq('product_id', strategy.product_id).eq('user_id', userId).maybeSingle()
      : { data: null, error: null };
    if (productError) throw toError(productError, 'Could not load the campaign product context.');
    context.product = {
      ...(savedProduct || context.product || {}),
      product_name: productName,
      name: productName,
      description: productDescription,
      product_price: text(input?.product_price, 100) || null,
      product_image_url: validOptionalUrl(input?.product_image_url),
    };
    const economyMode = cma.decision === 'allow_economy';
    const strategyGenerator = new DecisionEngine();
    let generated;
    try {
      generated = await strategyGenerator.generateStrategy(
        context,
        goal,
        followUpDays,
        economyMode,
        await isFreeAIRequest(),
        { callCampaign: true, selectedAccounts: strategy.selected_accounts || [], strategyId: strategy.id },
      );
    } catch (error: any) {
      throw new CallCampaignError(502, 'CALL_STRATEGY_GENERATION_FAILED', error?.message || 'The call strategy could not be generated.');
    }
    if (!generated.autonomous_calls?.enabled || !generated.autonomous_calls?.objective) {
      throw new CallCampaignError(502, 'CALL_STRATEGY_GENERATION_FAILED', 'The AI did not return a usable call plan. Regenerate the campaign strategy before adding contacts.');
    }
    const generatedStrategy = {
      source: 'dedicated_ai_call_strategy',
      strategy_id: strategy.id,
      strategy_goal: text(strategy.goal, 500),
      title: generated.title,
      rationale: generated.rationale,
      autonomous_calls: generated.autonomous_calls,
      campaign_objective: goal,
      product_name: productName,
      product_description: productDescription,
      product_price: text(input?.product_price, 100) || null,
      generated_at: new Date().toISOString(),
      cma_model: cma.model,
      cma_credits: cma.credits,
    };
    const { data, error } = await this.db.from('call_campaigns').insert({
      user_id: userId,
      strategy_id: strategy.id,
      name,
      goal,
      product_name: productName,
      product_description: productDescription,
      product_image_url: validOptionalUrl(input?.product_image_url),
      product_price: text(input?.product_price, 100) || null,
      follow_up_days: followUpDays,
      default_timezone: timezone,
      calling_start_hour: startHour,
      calling_end_hour: endHour,
      daily_limit: dailyLimit,
      max_attempts: maxAttempts,
      status: 'draft',
      generated_strategy: generatedStrategy,
    }).select('*').single();
    if (error) throw toError(error, 'Could not create the call campaign.');
    try {
      await energyService.deductEnergyWithRouting(userId, 'generate_call_strategy', {
        campaign_id: data.id,
        strategy_id: strategy.id,
      }, cma);
    } catch (chargeError: any) {
      await this.db.from('call_campaigns').delete().eq('id', data.id).eq('user_id', userId);
      throw new CallCampaignError(
        chargeError?.message?.includes('INSUFFICIENT_ENERGY') ? 402 : 409,
        chargeError?.message?.split(':')[0] || 'CALL_STRATEGY_CREDIT_CHARGE_FAILED',
        chargeError?.message || 'Could not charge credits for the generated call strategy.',
      );
    }
    return data;
  }

  async addContacts(userId: string, campaignId: string, input: any) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (campaign.status !== 'draft') throw invalid('Contacts can only be changed while the campaign is a draft.', 'CAMPAIGN_NOT_DRAFT');
    if (input?.consent_confirmed !== true) {
      throw invalid('Confirm that every selected person explicitly agreed to recorded AI calls.', 'CALL_CONSENT_REQUIRED');
    }
    const ids = Array.from(new Set((Array.isArray(input?.lead_ids) ? input.lead_ids : [])
      .map((id: unknown) => text(id, 80)).filter(Boolean))).slice(0, MAX_CONTACT_IMPORT);
    if (!ids.length) throw invalid('Select at least one lead with a phone number and recorded call consent.');

    const { data: leads, error: leadError } = await this.db.from('agent_leads')
      .select('id,platform_username,platform_user_id,phone,phone_number,contact_phone,country,country_code,contact_email,company,contact_timezone,call_consent,call_consent_at')
      .eq('user_id', userId).in('id', ids);
    if (leadError) throw toError(leadError, 'Could not validate the selected leads.');
    if ((leads || []).length !== ids.length) throw new CallCampaignError(404, 'LEAD_NOT_FOUND', 'One or more selected leads could not be found.');
    const rows = (leads || []).map((lead: any) => {
      const phone = normalizePhoneE164(lead.phone || lead.phone_number || lead.contact_phone);
      if (!phone) throw invalid('Every selected lead must have a valid E.164 phone number.', 'LEAD_PHONE_E164_REQUIRED');
      if (lead.call_consent !== true) throw invalid('Every selected lead needs recorded call consent.', 'CALL_CONSENT_REQUIRED');
      const timezone = isValidTimezone(lead.contact_timezone)
        ? lead.contact_timezone
        : inferPhoneTimeZone(phone) || campaign.default_timezone;
      return {
        user_id: userId,
        campaign_id: campaignId,
        lead_id: lead.id,
        name: text(lead.platform_username || lead.platform_user_id || 'Lead', 160),
        phone_e164: phone,
        email: text(lead.contact_email, 320) || null,
        company: text(lead.company, 160) || null,
        time_zone: timezone,
        call_consent: true,
        consent_confirmed: true,
        consent_source: 'owner_attested_in_app',
        consent_at: new Date().toISOString(),
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
      };
    });

    const phones = rows.map((row) => row.phone_e164);
    const { data: suppressed, error: suppressionError } = await this.db.from('call_suppressions')
      .select('phone_e164').eq('user_id', userId).in('phone_e164', phones);
    if (suppressionError) throw toError(suppressionError, 'Could not check the call suppression list.');
    if ((suppressed || []).length) {
      throw new CallCampaignError(409, 'CONTACT_SUPPRESSED', 'One or more selected phone numbers are on the do-not-call suppression list.');
    }
    const { data: inserted, error } = await this.db.from('call_campaign_contacts')
      .upsert(rows, { onConflict: 'campaign_id,phone_e164', ignoreDuplicates: true }).select('id');
    if (error) throw toError(error, 'Could not add contacts to the campaign.');
    return { added: inserted?.length || 0 };
  }

  async importContacts(userId: string, campaignId: string, input: any) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (campaign.status !== 'draft') throw invalid('Contacts can only be changed while the campaign is a draft.', 'CAMPAIGN_NOT_DRAFT');
    if (input?.consent_confirmed !== true) {
      throw invalid('Confirm that every imported person explicitly agreed to automated AI calls that may be recorded.', 'CALL_CONSENT_REQUIRED');
    }
    const supplied = Array.isArray(input?.contacts) ? input.contacts : [];
    if (!supplied.length) throw invalid('Select at least one contact to import.');
    if (supplied.length > MAX_CONTACT_IMPORT) throw invalid(`Import no more than ${MAX_CONTACT_IMPORT} contacts at a time.`);

    const countryCallingCode = text(input?.default_country_code, 5);
    const normalized = supplied.map((item: any, index: number) => {
      const name = text(item?.name, 160);
      const phone = normalizePhoneE164(item?.phone, countryCallingCode);
      const timezone = text(item?.time_zone || item?.contact_timezone, 80);
      if (!name) throw invalid(`Contact ${index + 1} needs a name.`, 'CONTACT_NAME_REQUIRED');
      if (!phone) throw invalid(`Contact ${index + 1} needs a valid international number, such as +2348012345678.`, 'LEAD_PHONE_E164_REQUIRED');
      if (timezone && !isValidTimezone(timezone)) throw invalid(`Contact ${index + 1} has an invalid IANA time zone.`, 'CONTACT_TIMEZONE_INVALID');
      return {
        name,
        phone,
        email: text(item?.email, 320) || null,
        company: text(item?.company, 160) || null,
        notes: text(item?.notes, 2000) || null,
        time_zone: timezone || inferPhoneTimeZone(phone) || campaign.default_timezone,
      };
    });
    const byPhone = new Map<string, typeof normalized[number]>();
    for (const contact of normalized) {
      if (!isValidTimezone(contact.time_zone)) throw invalid(`Set a valid time zone for ${contact.name} before importing.`, 'CONTACT_TIMEZONE_INVALID');
      byPhone.set(contact.phone, contact);
    }
    const rows = [...byPhone.values()];
    const phones = rows.map((row) => row.phone);
    const { data: suppressed, error: suppressionError } = await this.db.from('call_suppressions')
      .select('phone_e164').eq('user_id', userId).in('phone_e164', phones);
    if (suppressionError) throw toError(suppressionError, 'Could not check the do-not-call suppression list.');
    if ((suppressed || []).length) {
      throw new CallCampaignError(409, 'CONTACT_SUPPRESSED', 'One or more imported numbers are on the do-not-call suppression list and were not imported.');
    }

    const [byPhoneField, byPhoneNumberField, byContactPhoneField] = await Promise.all([
      this.db.from('agent_leads').select('id,platform_username,phone,phone_number,contact_phone,call_consent,contact_timezone')
        .eq('user_id', userId).in('phone', phones),
      this.db.from('agent_leads').select('id,platform_username,phone,phone_number,contact_phone,call_consent,contact_timezone')
        .eq('user_id', userId).in('phone_number', phones),
      this.db.from('agent_leads').select('id,platform_username,phone,phone_number,contact_phone,call_consent,contact_timezone')
        .eq('user_id', userId).in('contact_phone', phones),
    ]);
    const lookupError = byPhoneField.error || byPhoneNumberField.error || byContactPhoneField.error;
    if (lookupError) throw toError(lookupError, 'Could not check for existing contacts.');
    const existingByPhone = new Map<string, any>();
    for (const lead of [
      ...(byPhoneField.data || []),
      ...(byPhoneNumberField.data || []),
      ...(byContactPhoneField.data || []),
    ]) {
      const phone = normalizePhoneE164(lead.phone || lead.phone_number || lead.contact_phone);
      if (phone && !existingByPhone.has(phone)) existingByPhone.set(phone, lead);
    }

    const contactRows: any[] = [];
    for (const contact of rows) {
      let lead = existingByPhone.get(contact.phone);
      if (lead) {
        const { data: updatedLead, error } = await this.db.from('agent_leads').update({
          phone: contact.phone,
          contact_email: contact.email,
          company: contact.company,
          contact_timezone: contact.time_zone,
          call_consent: true,
          call_consent_at: new Date().toISOString(),
          call_consent_source: 'owner_attested_import',
        }).eq('id', lead.id).eq('user_id', userId).select('id').single();
        if (error || !updatedLead) throw toError(error || new Error('Could not save consent for an existing contact.'), 'Could not save consent for an existing contact.');
      } else {
        const { data: insertedLead, error } = await this.db.from('agent_leads').insert({
          strategy_id: campaign.strategy_id,
          user_id: userId,
          platform: 'call_campaign',
          platform_user_id: contact.phone,
          platform_username: contact.name,
          first_interaction: 'User-imported contact. Automated calling requires explicit consent.',
          intent_score: 0,
          intent_signals: [],
          stage: 'identified',
          dm_sequence_step: 0,
          notes: contact.notes,
          phone: contact.phone,
          contact_email: contact.email,
          company: contact.company,
          contact_timezone: contact.time_zone,
          country_code: phoneCountryCode(contact.phone),
          call_consent: true,
          call_consent_at: new Date().toISOString(),
          call_consent_source: 'owner_attested_import',
        }).select('id').single();
        if (error || !insertedLead) throw toError(error || new Error('Could not create an imported contact.'), 'Could not create an imported contact.');
        lead = insertedLead;
      }
      const leadId = lead.id;
      contactRows.push({
        user_id: userId,
        campaign_id: campaignId,
        lead_id: leadId,
        name: contact.name,
        phone_e164: contact.phone,
        email: contact.email,
        company: contact.company,
        notes: contact.notes,
        time_zone: contact.time_zone,
        call_consent: true,
        consent_confirmed: true,
        consent_source: 'owner_attested_import',
        consent_at: new Date().toISOString(),
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
      });
    }
    const { data: inserted, error } = await this.db.from('call_campaign_contacts')
      .upsert(contactRows, { onConflict: 'campaign_id,phone_e164', ignoreDuplicates: true }).select('id');
    if (error) throw toError(error, 'Could not add imported contacts to the campaign.');
    return { added: inserted?.length || 0, duplicates_skipped: rows.length - (inserted?.length || 0) };
  }

  async updateContact(userId: string, campaignId: string, contactId: string, input: any) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (campaign.status !== 'draft') throw invalid('Contacts can only be edited while the campaign is a draft.', 'CAMPAIGN_NOT_DRAFT');
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input?.name !== undefined) {
      patch.name = text(input.name, 160);
      if (!patch.name) throw invalid('Contact name cannot be empty.', 'CONTACT_NAME_REQUIRED');
    }
    if (input?.email !== undefined) patch.email = text(input.email, 320) || null;
    if (input?.company !== undefined) patch.company = text(input.company, 160) || null;
    if (input?.notes !== undefined) patch.notes = text(input.notes, 2000) || null;
    if (input?.time_zone !== undefined) {
      patch.time_zone = text(input.time_zone, 80);
      if (!isValidTimezone(patch.time_zone)) throw invalid('Enter a valid IANA time zone.', 'CONTACT_TIMEZONE_INVALID');
    }
    if (Object.keys(patch).length === 1) throw invalid('Provide at least one contact field to update.');
    const { data: current, error: lookupError } = await this.db.from('call_campaign_contacts').select('id,lead_id')
      .eq('id', contactId).eq('campaign_id', campaignId).eq('user_id', userId).maybeSingle();
    if (lookupError) throw toError(lookupError, 'Could not load the campaign contact.');
    if (!current) throw new CallCampaignError(404, 'CAMPAIGN_CONTACT_NOT_FOUND', 'Campaign contact not found.');
    const { data, error } = await this.db.from('call_campaign_contacts').update(patch)
      .eq('id', contactId).eq('campaign_id', campaignId).eq('user_id', userId).select('*').single();
    if (error) throw toError(error, 'Could not update the campaign contact.');
    if (current.lead_id) {
      const leadPatch: Record<string, any> = {};
      if (patch.name !== undefined) leadPatch.platform_username = patch.name;
      if (patch.email !== undefined) leadPatch.contact_email = patch.email;
      if (patch.company !== undefined) leadPatch.company = patch.company;
      if (patch.notes !== undefined) leadPatch.notes = patch.notes;
      if (patch.time_zone !== undefined) leadPatch.contact_timezone = patch.time_zone;
      if (Object.keys(leadPatch).length) {
        const { error: leadUpdateError } = await this.db.from('agent_leads').update(leadPatch)
          .eq('id', current.lead_id).eq('user_id', userId);
        if (leadUpdateError) throw toError(leadUpdateError, 'The campaign contact changed but its lead record could not be synchronized.');
      }
    }
    return data;
  }

  async removeContact(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (campaign.status !== 'draft') throw invalid('Contacts can only be removed while the campaign is a draft.', 'CAMPAIGN_NOT_DRAFT');
    const { data, error } = await this.db.from('call_campaign_contacts').delete()
      .eq('id', contactId).eq('campaign_id', campaignId).eq('user_id', userId).select('id').maybeSingle();
    if (error) throw toError(error, 'Could not remove the campaign contact.');
    if (!data) throw new CallCampaignError(404, 'CAMPAIGN_CONTACT_NOT_FOUND', 'Campaign contact not found.');
    return { removed: true };
  }

  async approve(userId: string, campaignId: string, confirmed: boolean) {
    if (confirmed !== true) throw invalid('Confirm consent and review the campaign before approving it.', 'APPROVAL_CONFIRMATION_REQUIRED');
    const campaign = await this.campaignForUser(userId, campaignId);
    if (!['draft', 'awaiting_approval'].includes(campaign.status)) throw invalid('Only a draft campaign can be approved.', 'CAMPAIGN_NOT_DRAFT');
    const contacts = await this.contacts(userId, campaignId);
    if (!contacts.length) throw invalid('Add at least one consented contact before approval.', 'CAMPAIGN_HAS_NO_CONTACTS');
    const blocked = contacts.some((contact: any) => contact.call_consent !== true || contact.consent_confirmed !== true);
    if (blocked) throw invalid('Every campaign contact needs explicit recorded consent.', 'CALL_CONSENT_REQUIRED');
    const { data, error } = await this.db.from('call_campaigns').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', campaignId).eq('user_id', userId).in('status', ['draft', 'awaiting_approval']).select('*').maybeSingle();
    if (error) throw toError(error, 'Could not approve the campaign.');
    if (!data) throw invalid('Campaign status changed. Refresh and try again.');
    return data;
  }

  async start(userId: string, campaignId: string) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (!['approved', 'paused'].includes(campaign.status)) throw invalid('Approve the campaign before starting it.', 'CAMPAIGN_NOT_APPROVED');
    if (!(await isFeatureEnabled('calling_ui', userId))) {
      throw new CallCampaignError(403, 'CALLING_DISABLED', 'Calling is currently unavailable.');
    }
    const [guard, preferences, strategy] = await Promise.all([
      getSubscriptionGuard(userId, this.db as any),
      this.db.from('outreach_preferences').select('do_not_call').eq('user_id', userId).maybeSingle(),
      campaign.strategy_id
        ? this.db.from('strategies').select('id').eq('id', campaign.strategy_id).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (!['pro', 'pro_plus'].includes(guard.plan) || !['active', 'trialing'].includes(guard.status)) {
      throw new CallCampaignError(403, 'CALLING_REQUIRES_PRO', 'Autonomous calling requires an active Pro or Pro+ subscription.');
    }
    if (preferences.error) throw toError(preferences.error, 'Could not verify calling preferences.');
    if (preferences.data?.do_not_call) throw new CallCampaignError(403, 'DO_NOT_CALL', 'Calling is disabled in your outreach preferences.');
    if (strategy.error || !strategy.data) throw new CallCampaignError(409, 'STRATEGY_NOT_FOUND', 'The campaign strategy is no longer available.');

    if (campaign.status === 'paused') {
      await this.db.from('call_campaign_contacts').update({
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('campaign_id', campaignId).eq('user_id', userId)
        .eq('status', 'blocked').in('last_outcome', ['insufficient_energy', 'call_credit_charge_failed']);
    }
    const { data: contacts, error: contactError } = await this.db.from('call_campaign_contacts')
      .select('id,status,call_consent,consent_confirmed,last_outcome')
      .eq('user_id', userId).eq('campaign_id', campaignId).in('status', OPEN_CONTACT_STATUSES);
    if (contactError) throw toError(contactError, 'Could not validate campaign contacts.');
    if (!(contacts || []).some((contact: any) => contact.call_consent && contact.consent_confirmed)) {
      throw invalid('No eligible consented contacts remain in this campaign.', 'NO_ELIGIBLE_CONTACTS');
    }

    const { data, error } = await this.db.from('call_campaigns').update({
      status: 'running',
      failure_reason: null,
      started_at: campaign.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', campaignId).eq('user_id', userId).in('status', ['approved', 'paused']).select('*').maybeSingle();
    if (error) throw toError(error, 'Could not start the call campaign.');
    if (!data) throw invalid('Campaign status changed. Refresh and try again.');
    return data;
  }

  async pause(userId: string, campaignId: string, stop = false) {
    const campaign = await this.campaignForUser(userId, campaignId);
    if (['completed', 'stopped'].includes(campaign.status)) throw invalid('This campaign has already finished.');
    const status = stop ? 'stopped' : 'paused';
    const now = new Date().toISOString();
    const { data, error } = await this.db.from('call_campaigns').update({
      status,
      stopped_at: stop ? now : campaign.stopped_at,
      updated_at: now,
    }).eq('id', campaignId).eq('user_id', userId).select('*').single();
    if (error) throw toError(error, 'Could not update the campaign.');
    const pendingStatuses = stop ? ['pending', 'scheduling', 'queued'] : ['queued'];
    const { error: contactUpdateError } = await this.db.from('call_campaign_contacts').update({
      status: stop ? 'stopped' : 'pending',
      last_outcome: stop ? 'campaign_stopped' : 'campaign_paused',
      updated_at: now,
    }).eq('campaign_id', campaignId).eq('user_id', userId).in('status', pendingStatuses);
    if (contactUpdateError) throw toError(contactUpdateError, 'Could not update campaign contacts.');
    const { error: callUpdateError } = await this.db.from('call_logs').update({
      status: 'canceled',
      ended_at: now,
      outcome: stop ? 'campaign_stopped' : 'campaign_paused',
    }).eq('campaign_id', campaignId).eq('user_id', userId).eq('status', 'queued');
    if (callUpdateError) throw toError(callUpdateError, 'Could not cancel queued campaign calls.');
    return data;
  }

  async assertCallCanStart(call: any, lead: any) {
    if (!call.campaign_id) {
      const phone = normalizePhoneE164(lead?.phone || lead?.phone_number || lead?.contact_phone);
      if (!phone) throw new CallCampaignError(400, 'LEAD_PHONE_E164_REQUIRED', 'Lead phone number must be in E.164 format.');
      const { data: suppression, error } = await this.db.from('call_suppressions').select('id')
        .eq('user_id', call.user_id).eq('phone_e164', phone).maybeSingle();
      if (error) throw toError(error, 'Could not verify the do-not-call list.');
      if (suppression) throw new CallCampaignError(403, 'CALL_SUPPRESSED', 'This phone number requested no further calls.');
      return null;
    }
    const { data: campaign, error: campaignError } = await this.db.from('call_campaigns').select('*')
      .eq('id', call.campaign_id).eq('user_id', call.user_id).maybeSingle();
    if (campaignError) throw toError(campaignError, 'Could not validate the call campaign.');
    if (!campaign || campaign.status !== 'running') throw new CallCampaignError(409, 'CAMPAIGN_NOT_RUNNING', 'The campaign is not running.');
    const { data: contact, error: contactError } = await this.db.from('call_campaign_contacts').select('*')
      .eq('id', call.campaign_contact_id).eq('campaign_id', campaign.id).eq('user_id', call.user_id).maybeSingle();
    if (contactError) throw toError(contactError, 'Could not validate campaign contact consent.');
    if (!contact || !['queued', 'calling'].includes(contact.status)) {
      throw new CallCampaignError(409, 'CAMPAIGN_CONTACT_NOT_QUEUED', 'The campaign contact is no longer queued.');
    }
    if (!contact.call_consent || !contact.consent_confirmed || lead.call_consent !== true) {
      throw new CallCampaignError(403, 'CALL_CONSENT_REQUIRED', 'The campaign contact no longer has recorded call consent.');
    }
    const suppression = await this.db.from('call_suppressions').select('id')
      .eq('user_id', call.user_id).eq('phone_e164', contact.phone_e164).maybeSingle();
    if (suppression.error) throw toError(suppression.error, 'Could not verify the do-not-call list.');
    if (suppression.data) throw new CallCampaignError(403, 'CALL_SUPPRESSED', 'This phone number is on the do-not-call list.');
    const leadPhone = normalizePhoneE164(lead.phone || lead.phone_number || lead.contact_phone);
    if (contact.lead_id !== call.lead_id || leadPhone !== contact.phone_e164) {
      throw new CallCampaignError(409, 'CAMPAIGN_PHONE_CHANGED', 'The lead phone number changed after consent was recorded. Review consent before calling.');
    }
    if (!isValidTimezone(contact.time_zone)) {
      throw new CallCampaignError(409, 'CAMPAIGN_CONTACT_TIMEZONE_INVALID', 'The campaign contact has an invalid local time zone.');
    }
    if (!isWithinCallWindow(contact.time_zone, campaign.calling_start_hour, campaign.calling_end_hour)) {
      const nextAt = nextCallWindowStart(contact.time_zone, campaign.calling_start_hour, campaign.calling_end_hour);
      throw new CallCampaignError(409, `CALL_WINDOW_CLOSED:${nextAt.toISOString()}`, 'The contact is outside the campaign calling window.');
    }
    if (Number(contact.attempt_count || 0) >= Number(campaign.max_attempts)) {
      throw new CallCampaignError(409, 'CAMPAIGN_MAX_ATTEMPTS', 'The campaign contact reached its attempt limit.');
    }
    return { campaign, contact };
  }

  async markAttemptStarted(call: any, campaignContext: any) {
    if (!campaignContext) return;
    const { campaign, contact } = campaignContext;
    const { data, error } = await this.db.from('call_campaign_contacts').update({
      status: 'calling',
      attempt_count: Number(contact.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_call_id: call.id,
      updated_at: new Date().toISOString(),
    }).eq('id', contact.id).eq('campaign_id', campaign.id).eq('status', 'queued').select('id').maybeSingle();
    if (error) throw toError(error, 'Could not record the campaign call attempt.');
    if (!data) throw new CallCampaignError(409, 'CAMPAIGN_CONTACT_NOT_QUEUED', 'The campaign contact is no longer queued.');
  }

  async recordCallOptOut(call: any, lead: any) {
    if (!call?.user_id) return;
    const phone = normalizePhoneE164(lead?.phone || lead?.phone_number || lead?.contact_phone);
    if (!phone) return;
    const now = new Date().toISOString();
    const { error } = await this.db.from('call_suppressions').upsert({
      user_id: call.user_id,
      phone_e164: phone,
      source: 'voice_call_opt_out',
      reason: 'Recipient requested no further calls during a recorded call.',
    }, { onConflict: 'user_id,phone_e164', ignoreDuplicates: true });
    if (error) console.warn('[Telephony] Could not save call suppression.');
    await this.db.from('call_campaign_contacts').update({
      status: 'opted_out',
      call_consent: false,
      last_outcome: 'recipient_opted_out',
      updated_at: now,
    }).eq('user_id', call.user_id).eq('phone_e164', phone).in('status', OPEN_CONTACT_STATUSES);
  }

  async recordLeadConsentRevoked(userId: string, leadId: string) {
    const { data: lead } = await this.db.from('agent_leads').select('phone,phone_number,contact_phone')
      .eq('id', leadId).eq('user_id', userId).maybeSingle();
    const phone = normalizePhoneE164(lead?.phone || lead?.phone_number || lead?.contact_phone);
    const now = new Date().toISOString();
    await this.db.from('call_campaign_contacts').update({
      status: 'blocked',
      call_consent: false,
      last_outcome: 'lead_consent_revoked',
      updated_at: now,
    }).eq('user_id', userId).eq('lead_id', leadId).in('status', OPEN_CONTACT_STATUSES);
    await this.db.from('call_logs').update({
      status: 'canceled',
      ended_at: now,
      outcome: 'lead_consent_revoked',
    }).eq('user_id', userId).eq('lead_id', leadId).eq('status', 'queued');
    if (phone) {
      await this.db.from('call_campaign_contacts').update({
        status: 'blocked',
        call_consent: false,
        last_outcome: 'lead_consent_revoked',
        updated_at: now,
      }).eq('user_id', userId).eq('phone_e164', phone).in('status', OPEN_CONTACT_STATUSES);
    }
  }

  async finalizeCall(callId: string, finalStatus: string, summary: any, failureReason?: string) {
    const { data: call, error: callError } = await this.db.from('call_logs')
      .select('id,user_id,campaign_id,campaign_contact_id').eq('id', callId).maybeSingle();
    if (callError) throw toError(callError, 'Could not load the campaign call result.');
    if (!call?.campaign_id || !call?.campaign_contact_id) return;
    const { data: contact, error: contactError } = await this.db.from('call_campaign_contacts').select('*')
      .eq('id', call.campaign_contact_id).eq('user_id', call.user_id).maybeSingle();
    if (contactError) throw toError(contactError, 'Could not load campaign contact status.');
    if (!contact || ['opted_out', 'stopped', 'converted'].includes(contact.status)) return;
    if (contact.last_finalized_call_id === callId) return;
    if (contact.status === 'blocked' && contact.last_outcome === 'lead_consent_revoked') return;
    const { data: campaign, error: campaignError } = await this.db.from('call_campaigns').select('*')
      .eq('id', call.campaign_id).eq('user_id', call.user_id).maybeSingle();
    if (campaignError) throw toError(campaignError, 'Could not load campaign retry settings.');
    if (!campaign) return;

    const now = new Date();
    const outcome = text(summary?.voice_disposition || failureReason || finalStatus, 120);
    if (failureReason === 'INSUFFICIENT_ENERGY' || failureReason === 'CALL_CREDIT_CHARGE_FAILED') {
      const creditFailure = failureReason === 'INSUFFICIENT_ENERGY' ? 'insufficient_energy' : 'call_credit_charge_failed';
      await this.db.from('call_campaign_contacts').update({
        status: 'blocked',
        last_finalized_call_id: callId,
        last_outcome: creditFailure,
        updated_at: now.toISOString(),
      }).eq('id', contact.id);
      await this.db.from('call_campaigns').update({
        status: 'paused',
        failure_reason: creditFailure,
        consecutive_failures: Number(campaign.consecutive_failures || 0) + 1,
        updated_at: now.toISOString(),
      }).eq('id', campaign.id).eq('user_id', call.user_id).eq('status', 'running');
      return;
    }

    const policyStopped = summary?.voice_disposition === 'cancelled_by_policy';
    const isSuccessful = finalStatus === 'completed' && !policyStopped && campaign.status !== 'stopped';
    const stillRunning = campaign.status === 'running';
    const attemptsRemain = Number(contact.attempt_count || 0) < Number(campaign.max_attempts || 1);
    const nextStatus = campaign.status === 'stopped'
      ? 'stopped'
      : isSuccessful
        ? (outcome === 'converted' ? 'converted' : 'completed')
        : finalStatus === 'canceled' && campaign.status === 'paused'
          ? 'pending'
        : policyStopped && campaign.status === 'paused'
          ? 'pending'
        : stillRunning && attemptsRemain
          ? 'pending'
          : finalStatus === 'no_answer' ? 'no_answer' : 'failed';
    const patch: Record<string, any> = {
      status: nextStatus,
      last_finalized_call_id: callId,
      last_outcome: outcome,
      updated_at: now.toISOString(),
    };
    if (nextStatus === 'pending') {
      patch.next_attempt_at = new Date(now.getTime() + (finalStatus === 'canceled' ? 0 : Number(campaign.follow_up_days || 7) * 86400000)).toISOString();
    }
    let update = this.db.from('call_campaign_contacts').update(patch).eq('id', contact.id);
    update = contact.last_finalized_call_id
      ? update.eq('last_finalized_call_id', contact.last_finalized_call_id)
      : update.is('last_finalized_call_id', null);
    const { data: finalized, error: finalizeError } = await update.select('id').maybeSingle();
    if (finalizeError) throw toError(finalizeError, 'Could not finalize the campaign contact.');
    if (!finalized) return;
    await this.maybeComplete(campaign.id, call.user_id);
  }

  async queueDueContacts(limit = 10): Promise<number> {
    if (!(await isFeatureEnabled('calling_ui'))) return 0;
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: campaigns, error } = await this.db.from('call_campaigns').select('*')
      .eq('status', 'running').order('updated_at', { ascending: true }).limit(25);
    if (error) throw toError(error, 'Could not load running call campaigns.');
    let queued = 0;
    for (const campaign of campaigns || []) {
      if (queued >= limit) break;
      if (!(await isFeatureEnabled('calling_ui', campaign.user_id))) continue;
      const [guard, preferences] = await Promise.all([
        getSubscriptionGuard(campaign.user_id, this.db as any),
        this.db.from('outreach_preferences').select('do_not_call').eq('user_id', campaign.user_id).maybeSingle(),
      ]);
      if (preferences.error || preferences.data?.do_not_call || !['pro', 'pro_plus'].includes(guard.plan) || !['active', 'trialing'].includes(guard.status)) {
        await this.db.from('call_campaigns').update({
          status: 'paused',
          failure_reason: preferences.error ? 'preferences_check_failed' : preferences.data?.do_not_call ? 'do_not_call_enabled' : 'subscription_inactive',
          updated_at: nowIso,
        }).eq('id', campaign.id).eq('status', 'running');
        continue;
      }

      const { count: dailyCount, error: dailyError } = await this.db.from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', campaign.user_id).eq('campaign_id', campaign.id)
        .gte('created_at', new Date(now.getTime() - 86400000).toISOString())
        .neq('status', 'canceled');
      if (dailyError) throw toError(dailyError, 'Could not enforce the campaign daily limit.');
      const remaining = Number(campaign.daily_limit || 1) - Number(dailyCount || 0);
      if (remaining <= 0) continue;

      const { data: contacts, error: contactsError } = await this.db.from('call_campaign_contacts').select('*')
        .eq('campaign_id', campaign.id).eq('user_id', campaign.user_id)
        .in('status', ['pending', 'scheduling']).lte('next_attempt_at', nowIso)
        .order('next_attempt_at', { ascending: true }).limit(Math.min(remaining, limit - queued, 10));
      if (contactsError) throw toError(contactsError, 'Could not load due campaign contacts.');

      let queuedForCampaign = 0;
      for (const candidate of contacts || []) {
        if (queued >= limit || queuedForCampaign >= remaining) break;
        const { data: claimed, error: claimError } = await this.db.from('call_campaign_contacts').update({
          status: 'scheduling',
          next_attempt_at: new Date(now.getTime() + 5 * 60000).toISOString(),
          updated_at: nowIso,
        }).eq('id', candidate.id).eq('status', candidate.status).select('*').maybeSingle();
        if (claimError || !claimed) continue;
        try {
          const didQueue = await this.queueContact(campaign, claimed, now);
          if (didQueue) {
            queued++;
            queuedForCampaign++;
          }
        } catch (queueError: any) {
          console.warn(`[CallCampaign] Could not queue a contact for campaign ${campaign.id}: ${String(queueError?.code || 'queue_error')}`);
          await this.db.from('call_campaign_contacts').update({
            status: 'pending',
            next_attempt_at: new Date(Date.now() + 5 * 60000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', candidate.id).eq('status', 'scheduling');
        }
      }
      await this.maybeComplete(campaign.id, campaign.user_id);
    }
    return queued;
  }

  private async queueContact(campaign: any, contact: any, now: Date): Promise<boolean> {
    if (!contact.call_consent || !contact.consent_confirmed || !contact.lead_id) {
      await this.blockContact(contact, 'call_consent_missing');
      return false;
    }
    const phone = normalizePhoneE164(contact.phone_e164);
    if (!phone) {
      await this.blockContact(contact, 'invalid_phone');
      return false;
    }
    const { data: suppression, error: suppressionError } = await this.db.from('call_suppressions').select('id')
      .eq('user_id', campaign.user_id).eq('phone_e164', phone).maybeSingle();
    if (suppressionError) throw suppressionError;
    if (suppression) {
      await this.db.from('call_campaign_contacts').update({
        status: 'opted_out',
        call_consent: false,
        last_outcome: 'do_not_call_suppression',
        updated_at: now.toISOString(),
      }).eq('id', contact.id);
      return false;
    }

    const { data: lead, error: leadError } = await this.db.from('agent_leads')
      .select('id,phone,phone_number,contact_phone,call_consent,country,country_code')
      .eq('id', contact.lead_id).eq('user_id', campaign.user_id).maybeSingle();
    if (leadError) throw leadError;
    const leadPhone = normalizePhoneE164(lead?.phone || lead?.phone_number || lead?.contact_phone);
    if (!lead || lead.call_consent !== true || leadPhone !== phone) {
      await this.blockContact(contact, 'lead_consent_or_phone_changed');
      return false;
    }

    if (!isValidTimezone(contact.time_zone)) {
      await this.blockContact(contact, 'invalid_contact_timezone');
      return false;
    }
    if (!isWithinCallWindow(contact.time_zone, campaign.calling_start_hour, campaign.calling_end_hour, now)) {
      const nextAt = nextCallWindowStart(contact.time_zone, campaign.calling_start_hour, campaign.calling_end_hour, now);
      await this.db.from('call_campaign_contacts').update({
        status: 'scheduling',
        next_attempt_at: nextAt.toISOString(),
        last_outcome: 'waiting_for_local_call_window',
        updated_at: now.toISOString(),
      }).eq('id', contact.id);
      return false;
    }

    const { data: activeCall, error: activeError } = await this.db.from('call_logs').select('id')
      .eq('user_id', campaign.user_id).eq('campaign_contact_id', contact.id)
      .in('status', ACTIVE_CALL_STATUSES).maybeSingle();
    if (activeError) throw activeError;
    if (activeCall) {
      await this.db.from('call_campaign_contacts').update({
        status: 'queued',
        last_call_id: activeCall.id,
        updated_at: now.toISOString(),
      }).eq('id', contact.id);
      return false;
    }

    const { data: call, error: callError } = await this.db.from('call_logs').insert({
      user_id: campaign.user_id,
      lead_id: contact.lead_id,
      strategy_id: campaign.strategy_id,
      campaign_id: campaign.id,
      campaign_contact_id: contact.id,
      consent_confirmed: true,
      status: 'queued',
      summary: {
        source: 'call_campaign',
        campaign_name: campaign.name,
        requested_goal: campaign.goal,
        product_name: campaign.product_name,
        product_description: campaign.product_description,
        product_price: campaign.product_price,
        call_plan: campaign.generated_strategy?.autonomous_calls || {},
        country_code: lead.country_code || lead.country || null,
      },
    }).select('id').single();
    if (callError) throw callError;
    const { error: updateError } = await this.db.from('call_campaign_contacts').update({
      status: 'queued',
      last_call_id: call.id,
      updated_at: now.toISOString(),
    }).eq('id', contact.id).eq('status', 'scheduling');
    if (updateError) throw updateError;
    return true;
  }

  private async blockContact(contact: any, reason: string) {
    await this.db.from('call_campaign_contacts').update({
      status: 'blocked',
      last_outcome: reason,
      updated_at: new Date().toISOString(),
    }).eq('id', contact.id);
  }

  private async maybeComplete(campaignId: string, userId: string) {
    const { data: campaign } = await this.db.from('call_campaigns').select('status')
      .eq('id', campaignId).eq('user_id', userId).maybeSingle();
    if (campaign?.status !== 'running') return;
    const { data: contacts } = await this.db.from('call_campaign_contacts').select('status')
      .eq('campaign_id', campaignId).eq('user_id', userId).limit(1000);
    if (!contacts?.length || contacts.some((contact: any) => !TERMINAL_CONTACT_STATUSES.includes(contact.status))) return;
    await this.db.from('call_campaigns').update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', campaignId).eq('user_id', userId).eq('status', 'running');
  }
}

export const callCampaignService = new CallCampaignService();
