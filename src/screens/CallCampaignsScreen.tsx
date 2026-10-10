import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Check,
  Clock3,
  Megaphone,
  Pause,
  Play,
  Plus,
  Square,
  Users,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OutreachService } from '../services/outreach';
import FeatureGate from '../components/FeatureGate';

const colors = {
  bg: '#0B0F19',
  card: '#151B2B',
  border: '#1E293B',
  text: '#E2E8F0',
  muted: '#94A3B8',
  cyan: '#00F0FF',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
};

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const initialForm = {
  name: '',
  goal: '',
  product_name: '',
  product_description: '',
  product_price: '',
  strategy_id: '',
  default_timezone: localTimezone,
  calling_start_hour: '9',
  calling_end_hour: '17',
  daily_limit: '10',
  max_attempts: '2',
  follow_up_days: '7',
};

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function statusColor(status: string) {
  if (['running', 'completed', 'approved'].includes(status)) return colors.green;
  if (['stopped', 'failed'].includes(status)) return colors.red;
  if (['paused', 'draft', 'awaiting_approval'].includes(status)) return colors.amber;
  return colors.muted;
}

function CampaignField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.multilineInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize="sentences"
      />
    </View>
  );
}

export default function CallCampaignsScreen() {
  const navigation = useNavigation<any>();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [options, setOptions] = useState<{ strategies: any[]; leads: any[] }>({ strategies: [], leads: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId) || null;
  const existingPhones = useMemo(() => new Set(contacts.map((contact) => contact.phone_e164)), [contacts]);
  const availableLeads = useMemo(
    () => options.leads.filter((lead) => !existingPhones.has(lead.phone_e164)),
    [options.leads, existingPhones],
  );

  const loadBase = useCallback(async () => {
    try {
      const [campaignResult, optionResult] = await Promise.all([
        OutreachService.getCallCampaigns(),
        OutreachService.getCallCampaignOptions(),
      ]);
      setCampaigns(Array.isArray(campaignResult) ? campaignResult : campaignResult.campaigns || []);
      setOptions({
        strategies: optionResult.strategies || [],
        leads: optionResult.leads || [],
      });
    } catch (error: any) {
      Alert.alert('Could not load calls', error?.message || 'Call campaigns could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async (campaignId: string) => {
    setContactsLoading(true);
    try {
      const result = await OutreachService.getCallCampaignContacts(campaignId);
      setContacts(Array.isArray(result) ? result : result.contacts || []);
    } catch (error: any) {
      Alert.alert('Could not load contacts', error?.message || 'Campaign contacts could not be loaded.');
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void loadBase();
    if (selectedId) void loadContacts(selectedId);
  }, [loadBase, loadContacts, selectedId]));

  const refresh = useCallback(async () => {
    await loadBase();
    if (selectedId) await loadContacts(selectedId);
  }, [loadBase, loadContacts, selectedId]);

  const updateForm = (key: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const createCampaign = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await OutreachService.createCallCampaign({
        ...form,
        calling_start_hour: Number(form.calling_start_hour),
        calling_end_hour: Number(form.calling_end_hour),
        daily_limit: Number(form.daily_limit),
        max_attempts: Number(form.max_attempts),
        follow_up_days: Number(form.follow_up_days),
      });
      await loadBase();
      setForm(initialForm);
      setFormVisible(false);
      setSelectedId(result.id);
      await loadContacts(result.id);
    } catch (error: any) {
      Alert.alert('Could not create campaign', error?.message || 'Review the campaign details and try again.');
    } finally {
      setBusy(false);
    }
  };

  const addContacts = async () => {
    if (!selectedCampaign || busy || !selectedLeadIds.length) return;
    setBusy(true);
    try {
      await OutreachService.addCallCampaignContacts(selectedCampaign.id, selectedLeadIds, consentConfirmed);
      setSelectedLeadIds([]);
      setConsentConfirmed(false);
      await loadContacts(selectedCampaign.id);
      await loadBase();
      Alert.alert('Contacts added', 'Consent and phone numbers will be checked again before each call.');
    } catch (error: any) {
      Alert.alert('Could not add contacts', error?.message || 'The selected contacts could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const performAction = async (action: () => Promise<any>, successMessage?: string) => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      await action();
      await loadBase();
      await loadContacts(selectedCampaign.id);
      setApprovalConfirmed(false);
      if (successMessage) Alert.alert('Campaign updated', successMessage);
    } catch (error: any) {
      Alert.alert('Campaign not updated', error?.message || 'The requested campaign action failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopCampaign = () => {
    if (!selectedCampaign) return;
    Alert.alert(
      'Stop this campaign?',
      'No future calls will be placed. A call already in progress will end at its next voice check.',
      [
        { text: 'Keep campaign', style: 'cancel' },
        {
          text: 'Stop campaign',
          style: 'destructive',
          onPress: () => void performAction(
            () => OutreachService.stopCallCampaign(selectedCampaign.id),
            'The campaign has been stopped.',
          ),
        },
      ],
    );
  };

  const toggleLead = (leadId: string) => {
    setSelectedLeadIds((current) => current.includes(leadId)
      ? current.filter((id) => id !== leadId)
      : [...current, leadId]);
  };

  const goBack = () => {
    if (selectedId) {
      setSelectedId(null);
      setContacts([]);
      setSelectedLeadIds([]);
      setConsentConfirmed(false);
      return;
    }
    if (formVisible) {
      setFormVisible(false);
      return;
    }
    navigation.goBack();
  };

  const statusCounts = selectedCampaign?.contact_counts || {};
  const pendingCount = Number(statusCounts.pending || 0) + Number(statusCounts.scheduling || 0) + Number(statusCounts.queued || 0);
  const completedCount = Number(statusCounts.completed || 0) + Number(statusCounts.converted || 0);

  return (
    <FeatureGate flag="calling_ui" message="This area is currently unavailable.">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} accessibilityLabel="Go back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>{formVisible ? 'New call campaign' : selectedCampaign ? 'Campaign details' : 'Call Campaigns'}</Text>
          {!formVisible && !selectedCampaign ? (
            <TouchableOpacity onPress={() => setFormVisible(true)} accessibilityLabel="Create campaign">
              <Plus color={colors.cyan} size={23} />
            </TouchableOpacity>
          ) : <Megaphone color={colors.cyan} size={21} />}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.cyan} style={{ marginTop: 42 }} />
        ) : formVisible ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.subtitle}>Use an existing strategy. Calls remain drafts until contacts are added and you approve the campaign.</Text>
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Consent and call limits</Text>
              <Text style={styles.noticeText}>Only add people whose explicit consent to automated calls is recorded. The AI identifies itself and announces recording. Each provider attempt uses one call credit.</Text>
            </View>
            <CampaignField label="Campaign name" value={form.name} onChangeText={(value) => updateForm('name', value)} placeholder="Product follow-up" />
            <CampaignField label="Call objective" value={form.goal} onChangeText={(value) => updateForm('goal', value)} placeholder="Learn whether the customer wants a product demo" multiline />
            <CampaignField label="Product or offer" value={form.product_name} onChangeText={(value) => updateForm('product_name', value)} placeholder="Offer name" />
            <CampaignField label="Product details the AI may use" value={form.product_description} onChangeText={(value) => updateForm('product_description', value)} placeholder="Only include confirmed, factual details" multiline />
            <CampaignField label="Price or pricing context (optional)" value={form.product_price} onChangeText={(value) => updateForm('product_price', value)} placeholder="Leave blank if unknown" />

            <Text style={styles.fieldLabel}>Existing strategy</Text>
            {options.strategies.length ? (
              <View style={styles.strategyList}>
                {options.strategies.map((strategy) => (
                  <TouchableOpacity
                    key={strategy.id}
                    onPress={() => updateForm('strategy_id', strategy.id)}
                    style={[styles.strategyChip, form.strategy_id === strategy.id && styles.strategyChipSelected]}
                  >
                    <Text style={[styles.strategyChipText, form.strategy_id === strategy.id && styles.strategyChipTextSelected]} numberOfLines={2}>
                      {strategy.goal || `Strategy ${String(strategy.id).slice(0, 8)}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.helper}>Create and activate a strategy before building a call campaign.</Text>
            )}

            <CampaignField label="IANA time zone" value={form.default_timezone} onChangeText={(value) => updateForm('default_timezone', value)} placeholder="Africa/Lagos" />
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <CampaignField label="Call from (hour)" value={form.calling_start_hour} onChangeText={(value) => updateForm('calling_start_hour', value)} keyboardType="number-pad" placeholder="9" />
              </View>
              <View style={styles.column}>
                <CampaignField label="Call until (hour)" value={form.calling_end_hour} onChangeText={(value) => updateForm('calling_end_hour', value)} keyboardType="number-pad" placeholder="17" />
              </View>
            </View>
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <CampaignField label="Daily call limit (1–25)" value={form.daily_limit} onChangeText={(value) => updateForm('daily_limit', value)} keyboardType="number-pad" placeholder="10" />
              </View>
              <View style={styles.column}>
                <CampaignField label="Attempts per person (1–3)" value={form.max_attempts} onChangeText={(value) => updateForm('max_attempts', value)} keyboardType="number-pad" placeholder="2" />
              </View>
            </View>
            <CampaignField label="Days between follow-ups (1–90)" value={form.follow_up_days} onChangeText={(value) => updateForm('follow_up_days', value)} keyboardType="number-pad" placeholder="7" />
            <TouchableOpacity
              disabled={busy || !options.strategies.length}
              onPress={() => void createCampaign()}
              style={[styles.primaryButton, (busy || !options.strategies.length) && styles.disabledButton]}
            >
              {busy ? <ActivityIndicator color="#04121A" /> : <Text style={styles.primaryButtonText}>Save draft</Text>}
            </TouchableOpacity>
          </ScrollView>
        ) : selectedCampaign ? (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={loading || contactsLoading} onRefresh={() => void refresh()} tintColor={colors.cyan} />}
          >
            <View style={styles.card}>
              <View style={styles.campaignHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.campaignName}>{selectedCampaign.name}</Text>
                  <Text style={styles.goal}>{selectedCampaign.goal}</Text>
                </View>
                <Text style={[styles.status, { color: statusColor(selectedCampaign.status) }]}>{String(selectedCampaign.status).replace(/_/g, ' ')}</Text>
              </View>
              <Text style={styles.meta}>{selectedCampaign.product_name}: {selectedCampaign.product_description}</Text>
              <View style={styles.ruleRow}>
                <Clock3 color={colors.cyan} size={15} />
                <Text style={styles.meta}>
                  {formatHour(selectedCampaign.calling_start_hour)}–{formatHour(selectedCampaign.calling_end_hour)} · {selectedCampaign.default_timezone}
                </Text>
              </View>
              <Text style={styles.meta}>
                Daily limit {selectedCampaign.daily_limit} · Up to {selectedCampaign.max_attempts} attempts · Follow up after {selectedCampaign.follow_up_days} days
              </Text>
              <Text style={styles.progressText}>{pendingCount} pending · {completedCount} completed · {contacts.length} total contacts</Text>
              {selectedCampaign.failure_reason ? <Text style={styles.failure}>Paused: {String(selectedCampaign.failure_reason).replace(/_/g, ' ')}</Text> : null}
            </View>

            {selectedCampaign.status === 'draft' ? (
              <>
                <View style={styles.sectionTitleRow}>
                  <Users color={colors.cyan} size={18} />
                  <Text style={styles.sectionTitle}>Add consented contacts</Text>
                </View>
                <Text style={styles.helper}>Only leads with recorded consent and a valid international phone number appear here. Numbers on the do-not-call list are excluded.</Text>
                {availableLeads.length ? availableLeads.map((lead) => {
                  const checked = selectedLeadIds.includes(lead.id);
                  return (
                    <TouchableOpacity key={lead.id} onPress={() => toggleLead(lead.id)} style={styles.leadRow}>
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <Check color="#04121A" size={15} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.leadName}>{lead.name}</Text>
                        <Text style={styles.meta}>{lead.phone_e164}{lead.time_zone ? ` · ${lead.time_zone}` : ''}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }) : <Text style={styles.emptyText}>No eligible leads. Record consent and an E.164 phone number on a lead first.</Text>}
                {selectedLeadIds.length > 0 ? (
                  <View style={styles.consentCard}>
                    <View style={styles.switchRow}>
                      <Text style={styles.consentText}>I confirm each selected person explicitly agreed to receive automated AI calls that may be recorded.</Text>
                      <Switch value={consentConfirmed} onValueChange={setConsentConfirmed} trackColor={{ false: '#334155', true: `${colors.cyan}88` }} thumbColor={consentConfirmed ? colors.cyan : '#CBD5E1'} />
                    </View>
                    <TouchableOpacity
                      disabled={busy || !consentConfirmed}
                      onPress={() => void addContacts()}
                      style={[styles.primaryButton, (busy || !consentConfirmed) && styles.disabledButton]}
                    >
                      {busy ? <ActivityIndicator color="#04121A" /> : <Text style={styles.primaryButtonText}>Add {selectedLeadIds.length} selected</Text>}
                    </TouchableOpacity>
                  </View>
                ) : null}
                {contacts.length ? (
                  <View style={styles.consentCard}>
                    <Text style={styles.helper}>Approving authorizes the scheduler to place calls within the selected local hours and daily limit.</Text>
                    <View style={styles.switchRow}>
                      <Text style={styles.consentText}>I reviewed the campaign and confirm the selected contacts have recorded consent.</Text>
                      <Switch value={approvalConfirmed} onValueChange={setApprovalConfirmed} trackColor={{ false: '#334155', true: `${colors.cyan}88` }} thumbColor={approvalConfirmed ? colors.cyan : '#CBD5E1'} />
                    </View>
                    <TouchableOpacity
                      disabled={busy || !approvalConfirmed}
                      onPress={() => void performAction(
                        () => OutreachService.approveCallCampaign(selectedCampaign.id, approvalConfirmed),
                        'Campaign approved. Start it when you are ready.',
                      )}
                      style={[styles.primaryButton, (busy || !approvalConfirmed) && styles.disabledButton]}
                    >
                      <Text style={styles.primaryButtonText}>Approve campaign</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}

            {selectedCampaign.status === 'approved' || selectedCampaign.status === 'paused' ? (
              <View style={styles.actionRow}>
                <TouchableOpacity disabled={busy} onPress={() => void performAction(
                  () => OutreachService.startCallCampaign(selectedCampaign.id),
                  'The campaign scheduler will place eligible calls during their local call windows.',
                )} style={styles.primaryButton}>
                  <Play color="#04121A" size={16} />
                  <Text style={styles.primaryButtonText}>{selectedCampaign.status === 'paused' ? 'Resume campaign' : 'Start campaign'}</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={stopCampaign} style={styles.dangerButton}>
                  <Square color={colors.red} size={15} />
                  <Text style={styles.dangerButtonText}>Stop</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {selectedCampaign.status === 'running' ? (
              <View style={styles.actionRow}>
                <TouchableOpacity disabled={busy} onPress={() => void performAction(
                  () => OutreachService.pauseCallCampaign(selectedCampaign.id),
                  'The campaign is paused. Resume it to continue placing calls.',
                )} style={styles.secondaryButton}>
                  <Pause color={colors.text} size={16} />
                  <Text style={styles.secondaryButtonText}>Pause</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={stopCampaign} style={styles.dangerButton}>
                  <Square color={colors.red} size={15} />
                  <Text style={styles.dangerButtonText}>Stop</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.sectionTitleRow}>
              <Users color={colors.cyan} size={18} />
              <Text style={styles.sectionTitle}>Campaign contacts</Text>
            </View>
            {contactsLoading ? <ActivityIndicator color={colors.cyan} /> : contacts.length ? contacts.map((contact) => (
              <View key={contact.id} style={styles.contactCard}>
                <View style={styles.campaignHeading}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leadName}>{contact.name}</Text>
                    <Text style={styles.meta}>{contact.phone_e164}</Text>
                  </View>
                  <Text style={[styles.status, { color: statusColor(contact.status) }]}>{String(contact.status).replace(/_/g, ' ')}</Text>
                </View>
                <Text style={styles.meta}>{contact.attempt_count || 0} attempts · {contact.time_zone}</Text>
                {contact.last_outcome ? <Text style={styles.meta}>Last result: {String(contact.last_outcome).replace(/_/g, ' ')}</Text> : null}
              </View>
            )) : <Text style={styles.emptyText}>No contacts have been added.</Text>}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.cyan} />}>
            <Text style={styles.subtitle}>Scheduled calls use your existing strategies and call history. Every contact is rechecked for consent before dialing.</Text>
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Before you start</Text>
              <Text style={styles.noticeText}>Calls are AI-disclosed and recorded. Local calling hours, the daily limit, consent, and do-not-call suppressions are enforced automatically.</Text>
            </View>
            {campaigns.length ? campaigns.map((campaign) => {
              const counts = campaign.contact_counts || {};
              const pending = Number(counts.pending || 0) + Number(counts.scheduling || 0) + Number(counts.queued || 0);
              const done = Number(counts.completed || 0) + Number(counts.converted || 0);
              return (
                <TouchableOpacity key={campaign.id} style={styles.card} onPress={() => {
                  setContacts([]);
                  setSelectedId(campaign.id);
                  setApprovalConfirmed(false);
                  void loadContacts(campaign.id);
                }}>
                  <View style={styles.campaignHeading}>
                    <Text style={styles.campaignName}>{campaign.name}</Text>
                    <Text style={[styles.status, { color: statusColor(campaign.status) }]}>{String(campaign.status).replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={styles.goal}>{campaign.goal}</Text>
                  <Text style={styles.meta}>{campaign.product_name} · {pending} pending · {done} completed</Text>
                </TouchableOpacity>
              );
            }) : (
              <View style={styles.empty}>
                <Megaphone color={colors.muted} size={30} />
                <Text style={styles.emptyText}>No call campaigns yet</Text>
              </View>
            )}
            <TouchableOpacity onPress={() => setFormVisible(true)} style={styles.primaryButton}>
              <Plus color="#04121A" size={18} />
              <Text style={styles.primaryButtonText}>Create a campaign</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </FeatureGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 48 },
  subtitle: { color: colors.muted, lineHeight: 20, marginBottom: 16 },
  notice: { backgroundColor: `${colors.cyan}0D`, borderColor: `${colors.cyan}35`, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  noticeTitle: { color: colors.cyan, fontWeight: '800', marginBottom: 5 },
  noticeText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  field: { marginBottom: 13 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 12, paddingVertical: 10 },
  multilineInput: { minHeight: 88 },
  strategyList: { gap: 8, marginVertical: 8 },
  strategyChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card, padding: 11 },
  strategyChipSelected: { borderColor: colors.cyan, backgroundColor: `${colors.cyan}13` },
  strategyChipText: { color: colors.muted, fontSize: 13 },
  strategyChipTextSelected: { color: colors.cyan, fontWeight: '700' },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 15, marginBottom: 12 },
  campaignHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  campaignName: { flex: 1, color: colors.text, fontWeight: '800', fontSize: 16 },
  goal: { color: colors.text, lineHeight: 19, marginTop: 8 },
  status: { textTransform: 'capitalize', fontWeight: '800', fontSize: 12 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  progressText: { color: colors.cyan, fontWeight: '700', fontSize: 12, marginTop: 12 },
  failure: { color: colors.red, fontSize: 12, marginTop: 7 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 9 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 11, padding: 12, marginBottom: 8 },
  checkbox: { width: 22, height: 22, borderWidth: 1, borderColor: '#64748B', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  leadName: { color: colors.text, fontWeight: '700' },
  consentCard: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 13, padding: 13, marginTop: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  consentText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.cyan, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10 },
  primaryButtonText: { color: '#04121A', fontWeight: '900', textAlign: 'center' },
  disabledButton: { opacity: 0.45 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  secondaryButton: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 },
  secondaryButtonText: { color: colors.text, fontWeight: '800' },
  dangerButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: `${colors.red}77`, borderRadius: 10, paddingHorizontal: 13 },
  dangerButtonText: { color: colors.red, fontWeight: '800' },
  contactCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13, marginBottom: 8 },
  empty: { alignItems: 'center', paddingVertical: 55, gap: 10 },
  emptyText: { color: colors.muted, lineHeight: 19, textAlign: 'center', marginVertical: 8 },
});
