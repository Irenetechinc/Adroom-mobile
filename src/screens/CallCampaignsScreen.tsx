import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
  ContactRound,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Users,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import { OutreachService } from '../services/outreach';
import { supabase } from '../services/supabase';
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
  product_image_url: '',
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
  const [importConsentConfirmed, setImportConsentConfirmed] = useState(false);
  const [defaultCountryCode, setDefaultCountryCode] = useState('');
  const [deviceContacts, setDeviceContacts] = useState<any[]>([]);
  const [selectedDeviceContactIds, setSelectedDeviceContactIds] = useState<string[]>([]);
  const [deviceContactsVisible, setDeviceContactsVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [contactEdit, setContactEdit] = useState({ name: '', email: '', company: '', notes: '', time_zone: '' });
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

  useEffect(() => {
    let disposed = false;
    let channel: any = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const startRealtime = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (disposed || !session?.user?.id) return;
      const userId = session.user.id;
      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void loadBase();
          if (selectedId) void loadContacts(selectedId);
        }, 250);
      };
      channel = supabase
        .channel(`call_campaigns_live_${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'call_campaigns', filter: `user_id=eq.${userId}` }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'call_campaign_contacts', filter: `user_id=eq.${userId}` }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs', filter: `user_id=eq.${userId}` }, scheduleRefresh)
        .subscribe();
    };
    void startRealtime();
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
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

  const loadPhoneContacts = async () => {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Contacts permission needed', 'Allow contact access to select specific phone contacts for this draft campaign.');
        return;
      }
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Company],
        pageSize: 250,
      });
      const mapped = result.data
        .filter((contact: any) => contact.phoneNumbers?.some((entry: any) => entry.number))
        .map((contact: any, index: number) => ({
          id: String(contact.id || `${contact.name || 'contact'}-${index}`),
          name: String(contact.name || contact.firstName || 'Phone contact'),
          phone: String(contact.phoneNumbers?.find((entry: any) => entry.number)?.number || ''),
          email: String(contact.emails?.find((entry: any) => entry.email)?.email || ''),
          company: String(contact.company || ''),
        }));
      setDeviceContacts(mapped);
      setSelectedDeviceContactIds([]);
      setDeviceContactsVisible(true);
    } catch (error: any) {
      Alert.alert('Could not read phone contacts', error?.message || 'Try again or import a CSV/XLSX contact file.');
    }
  };

  const toggleDeviceContact = (contactId: string) => {
    setSelectedDeviceContactIds((current) => current.includes(contactId)
      ? current.filter((id) => id !== contactId)
      : current.length >= 200 ? current : [...current, contactId]);
  };

  const importPhoneContacts = async () => {
    if (!selectedCampaign || !importConsentConfirmed) {
      Alert.alert('Consent confirmation required', 'Confirm that every selected person explicitly agreed to automated AI calls that may be recorded.');
      return;
    }
    const selected = deviceContacts
      .filter((contact) => selectedDeviceContactIds.includes(contact.id))
      .map(({ id: _id, ...contact }) => contact);
    if (!selected.length) return;
    setBusy(true);
    try {
      const result = await OutreachService.importCallCampaignContacts(
        selectedCampaign.id,
        selected,
        importConsentConfirmed,
        defaultCountryCode,
      );
      setDeviceContactsVisible(false);
      setSelectedDeviceContactIds([]);
      await loadBase();
      await loadContacts(selectedCampaign.id);
      Alert.alert('Phone contacts imported', `${result.added || 0} added; ${result.duplicates_skipped || 0} duplicates skipped.`);
    } catch (error: any) {
      Alert.alert('Could not import phone contacts', error?.message || 'Check phone number formats and try again.');
    } finally {
      setBusy(false);
    }
  };

  const importContactFile = async () => {
    if (!selectedCampaign || !importConsentConfirmed) {
      Alert.alert('Consent confirmation required', 'Confirm that every person in the file explicitly agreed to automated AI calls that may be recorded.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setBusy(true);
      const asset = result.assets[0];
      const imported = await OutreachService.importCallCampaignFile(
        selectedCampaign.id,
        { uri: asset.uri, name: asset.name, type: asset.mimeType || undefined },
        importConsentConfirmed,
        defaultCountryCode,
      );
      await loadBase();
      await loadContacts(selectedCampaign.id);
      Alert.alert('File imported', `${imported.added || 0} added; ${imported.duplicates_skipped || 0} duplicates skipped.`);
    } catch (error: any) {
      Alert.alert('Could not import file', error?.message || 'Use a CSV or XLSX file with name and phone columns.');
    } finally {
      setBusy(false);
    }
  };

  const beginEditContact = (contact: any) => {
    setEditingContact(contact);
    setContactEdit({
      name: String(contact.name || ''),
      email: String(contact.email || ''),
      company: String(contact.company || ''),
      notes: String(contact.notes || ''),
      time_zone: String(contact.time_zone || ''),
    });
  };

  const saveContactEdit = async () => {
    if (!selectedCampaign || !editingContact || busy) return;
    setBusy(true);
    try {
      await OutreachService.updateCallCampaignContact(selectedCampaign.id, editingContact.id, contactEdit);
      setEditingContact(null);
      await loadBase();
      await loadContacts(selectedCampaign.id);
    } catch (error: any) {
      Alert.alert('Could not update contact', error?.message || 'The contact could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const removeCampaignContact = (contact: any) => {
    if (!selectedCampaign) return;
    Alert.alert('Remove contact?', `${contact.name} will be removed from this draft campaign. Their lead record and consent history will remain.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void (async () => {
          setBusy(true);
          try {
            await OutreachService.removeCallCampaignContact(selectedCampaign.id, contact.id);
            if (editingContact?.id === contact.id) setEditingContact(null);
            await loadBase();
            await loadContacts(selectedCampaign.id);
          } catch (error: any) {
            Alert.alert('Could not remove contact', error?.message || 'The contact could not be removed.');
          } finally {
            setBusy(false);
          }
        })(),
      },
    ]);
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
  const callPlan = selectedCampaign?.generated_strategy?.autonomous_calls || {};

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
            <Text style={styles.subtitle}>Use an existing strategy as context. Saving generates a call-specific AI plan and charges the CMA-selected strategy credits. Calls remain drafts until you review and approve them.</Text>
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Consent and call limits</Text>
              <Text style={styles.noticeText}>Only add people whose explicit consent to automated calls is recorded. The AI identifies itself and announces recording. Each provider attempt uses one call credit.</Text>
            </View>
            <CampaignField label="Campaign name" value={form.name} onChangeText={(value) => updateForm('name', value)} placeholder="Product follow-up" />
            <CampaignField label="Call objective" value={form.goal} onChangeText={(value) => updateForm('goal', value)} placeholder="Learn whether the customer wants a product demo" multiline />
            <CampaignField label="Product or offer" value={form.product_name} onChangeText={(value) => updateForm('product_name', value)} placeholder="Offer name" />
            <CampaignField label="Product details the AI may use" value={form.product_description} onChangeText={(value) => updateForm('product_description', value)} placeholder="Only include confirmed, factual details" multiline />
            <CampaignField label="Price or pricing context (optional)" value={form.product_price} onChangeText={(value) => updateForm('product_price', value)} placeholder="Leave blank if unknown" />
            <CampaignField label="Product image URL (optional, HTTPS)" value={form.product_image_url} onChangeText={(value) => updateForm('product_image_url', value)} placeholder="https://example.com/product.jpg" />

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
              {!!callPlan.audience && <Text style={styles.meta}>AI-selected audience: {callPlan.audience}</Text>}
              {!!callPlan.opening_line && <Text style={styles.meta}>AI call opener: “{callPlan.opening_line}”</Text>}
              {Array.isArray(callPlan.discovery_questions) && callPlan.discovery_questions.length > 0 ? (
                <Text style={styles.meta}>Discovery: {callPlan.discovery_questions.join(' · ')}</Text>
              ) : null}
              {!!selectedCampaign.generated_strategy?.cma_credits && (
                <Text style={styles.meta}>Strategy generated with {selectedCampaign.generated_strategy.cma_credits} AI credits ({selectedCampaign.generated_strategy.cma_model || 'CMA-routed model'}).</Text>
              )}
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
                <View style={styles.consentCard}>
                  <Text style={styles.consentText}>Import CSV/XLSX contacts or choose specific contacts from this device. Importing also adds them to Leads. Only people who explicitly agreed to automated recorded AI calls may be imported.</Text>
                  <View style={styles.switchRow}>
                    <Text style={styles.consentText}>I confirm every person I import has explicitly agreed to these calls.</Text>
                    <Switch value={importConsentConfirmed} onValueChange={setImportConsentConfirmed} trackColor={{ false: '#334155', true: `${colors.cyan}88` }} thumbColor={importConsentConfirmed ? colors.cyan : '#CBD5E1'} />
                  </View>
                  <CampaignField label="Country calling code for local phone numbers (optional)" value={defaultCountryCode} onChangeText={setDefaultCountryCode} placeholder="+234" />
                  <View style={styles.actionRow}>
                    <TouchableOpacity disabled={busy || !importConsentConfirmed} onPress={() => void importContactFile()} style={[styles.secondaryButton, (busy || !importConsentConfirmed) && styles.disabledButton]}>
                      <Text style={styles.secondaryButtonText}>Import CSV / XLSX</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy || !importConsentConfirmed} onPress={() => void loadPhoneContacts()} style={[styles.secondaryButton, (busy || !importConsentConfirmed) && styles.disabledButton]}>
                      <ContactRound color={colors.cyan} size={16} />
                      <Text style={styles.secondaryButtonText}>Choose phone contacts</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.helper}>Files need a header row with name and phone columns. E.164 numbers are preferred. Local numbers use the country code above. Up to 200 contacts per import.</Text>
                </View>
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
                  {selectedCampaign.status === 'draft' ? (
                    <View style={styles.contactActions}>
                      <TouchableOpacity onPress={() => beginEditContact(contact)} accessibilityLabel={`Edit ${contact.name}`}>
                        <Pencil color={colors.cyan} size={17} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeCampaignContact(contact)} accessibilityLabel={`Remove ${contact.name}`}>
                        <Trash2 color={colors.red} size={17} />
                      </TouchableOpacity>
                    </View>
                  ) : <Text style={[styles.status, { color: statusColor(contact.status) }]}>{String(contact.status).replace(/_/g, ' ')}</Text>}
                </View>
                {editingContact?.id === contact.id ? (
                  <View style={styles.editPanel}>
                    <CampaignField label="Name" value={contactEdit.name} onChangeText={(name) => setContactEdit((current) => ({ ...current, name }))} />
                    <CampaignField label="Email" value={contactEdit.email} onChangeText={(email) => setContactEdit((current) => ({ ...current, email }))} />
                    <CampaignField label="Company" value={contactEdit.company} onChangeText={(company) => setContactEdit((current) => ({ ...current, company }))} />
                    <CampaignField label="Notes" value={contactEdit.notes} onChangeText={(notes) => setContactEdit((current) => ({ ...current, notes }))} multiline />
                    <CampaignField label="IANA time zone" value={contactEdit.time_zone} onChangeText={(time_zone) => setContactEdit((current) => ({ ...current, time_zone }))} placeholder="Africa/Lagos" />
                    <Text style={styles.helper}>Phone numbers are locked because consent applies to a specific number. Remove and re-import the contact to change it.</Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity disabled={busy} onPress={() => void saveContactEdit()} style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>Save changes</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={busy} onPress={() => setEditingContact(null)} style={styles.secondaryButton}>
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <>
                    <Text style={styles.meta}>{contact.attempt_count || 0} attempts · {contact.time_zone}{contact.email ? ` · ${contact.email}` : ''}</Text>
                    {contact.company ? <Text style={styles.meta}>{contact.company}</Text> : null}
                    {contact.last_outcome ? <Text style={styles.meta}>Last result: {String(contact.last_outcome).replace(/_/g, ' ')}</Text> : null}
                  </>
                )}
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
        <Modal visible={deviceContactsVisible} transparent animationType="slide" onRequestClose={() => setDeviceContactsVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.campaignHeading}>
                <Text style={styles.sectionTitle}>Choose phone contacts</Text>
                <Text style={styles.meta}>{selectedDeviceContactIds.length}/200</Text>
              </View>
              <Text style={styles.helper}>Select specific people only. Their explicit permission to receive recorded AI calls is still required.</Text>
              <FlatList
                data={deviceContacts}
                keyExtractor={(item) => item.id}
                style={styles.contactPickerList}
                renderItem={({ item }) => {
                  const checked = selectedDeviceContactIds.includes(item.id);
                  return (
                    <TouchableOpacity onPress={() => toggleDeviceContact(item.id)} style={styles.leadRow}>
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <Check color="#04121A" size={15} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.leadName}>{item.name}</Text>
                        <Text style={styles.meta}>{item.phone}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity onPress={() => setDeviceContactsVisible(false)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy || !selectedDeviceContactIds.length || !importConsentConfirmed} onPress={() => void importPhoneContacts()} style={[styles.primaryButton, (busy || !selectedDeviceContactIds.length || !importConsentConfirmed) && styles.disabledButton]}>
                  <Text style={styles.primaryButtonText}>{busy ? 'Importing…' : `Import ${selectedDeviceContactIds.length}`}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
  contactActions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 3 },
  editPanel: { marginTop: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000B' },
  modalSheet: { maxHeight: '85%', backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.border },
  contactPickerList: { maxHeight: 420, marginTop: 10 },
  empty: { alignItems: 'center', paddingVertical: 55, gap: 10 },
  emptyText: { color: colors.muted, lineHeight: 19, textAlign: 'center', marginVertical: 8 },
});
