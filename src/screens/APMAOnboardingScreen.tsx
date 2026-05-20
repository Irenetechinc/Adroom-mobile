import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  Modal, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store/authStore';
import { ArrowLeft, Check, ChevronDown, Globe, Target, Clock, Flag, Users, Hash } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string) || '';

type Props = NativeStackScreenProps<RootStackParamList, 'APMAOnboarding'>;

type Step =
  | 'welcome'
  | 'name'
  | 'country'
  | 'campaign_type'
  | 'campaign_subtype'
  | 'duration'
  | 'goal'
  | 'targets'
  | 'keywords'
  | 'platforms'
  | 'review'
  | 'launching';

interface FormState {
  clientName: string;
  country: string;
  countryName: string;
  campaignType: string;
  campaignSubtype: string;
  durationMonths: number;
  goal: 'improve' | 'damage';
  targetEntities: string[];
  targetInput: string;
  keywords: string[];
  keywordInput: string;
  platforms: string[];
}

const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' }, { code: 'GH', name: 'Ghana' }, { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' }, { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' }, { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' }, { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'PH', name: 'Philippines' }, { code: 'ID', name: 'Indonesia' }, { code: 'EG', name: 'Egypt' },
  { code: 'TR', name: 'Turkey' }, { code: 'UA', name: 'Ukraine' }, { code: 'PK', name: 'Pakistan' },
];

const CAMPAIGN_TYPES = [
  { value: 'presidential', label: 'Presidential', icon: '🏛️' },
  { value: 'gubernatorial', label: 'Gubernatorial', icon: '🗺️' },
  { value: 'senate', label: 'Senate', icon: '⚖️' },
  { value: 'house', label: 'House of Reps', icon: '🏠' },
  { value: 'city_council', label: 'City Council', icon: '🏙️' },
  { value: 'mayoral', label: 'Mayoral', icon: '🌆' },
  { value: 'public_perception', label: 'Public Perception', icon: '📊' },
];

const SUBTYPES_ELECTORAL = [
  { value: 'build', label: 'Build Support', desc: 'Grow your base and positive sentiment' },
  { value: 'defend', label: 'Defend Position', desc: 'Counter attacks and protect your narrative' },
];
const SUBTYPES_PERCEPTION = [
  { value: 'offensive', label: 'Offensive', desc: 'Aggressively shift narrative against targets' },
  { value: 'defensive', label: 'Defensive', desc: 'Protect reputation from negative campaigns' },
];

const PLATFORM_OPTIONS = [
  { value: 'twitter', label: 'Twitter / X', color: '#1DA1F2' },
  { value: 'facebook', label: 'Facebook', color: '#1877F2' },
  { value: 'reddit', label: 'Reddit', color: '#FF4500' },
  { value: 'telegram', label: 'Telegram', color: '#0088CC' },
];

export default function APMAOnboardingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { session } = useAuthStore();
  const [step, setStep] = useState<Step>('welcome');
  const [form, setForm] = useState<FormState>({
    clientName: '',
    country: 'NG',
    countryName: 'Nigeria',
    campaignType: '',
    campaignSubtype: '',
    durationMonths: 12,
    goal: 'improve',
    targetEntities: [],
    targetInput: '',
    keywords: [],
    keywordInput: '',
    platforms: ['twitter', 'facebook', 'reddit'],
  });
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<TextInput>(null);

  const goBack = useCallback(() => {
    const order: Step[] = ['welcome', 'name', 'country', 'campaign_type', 'campaign_subtype', 'duration', 'goal', 'targets', 'keywords', 'platforms', 'review'];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]);
    else navigation.goBack();
  }, [step, navigation]);

  const next = useCallback((nextStep: Step) => {
    setError('');
    setStep(nextStep);
  }, []);

  const togglePlatform = (p: string) => {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }));
  };

  const addTarget = () => {
    const v = form.targetInput.trim();
    if (v && !form.targetEntities.includes(v)) {
      setForm(f => ({ ...f, targetEntities: [...f.targetEntities, v], targetInput: '' }));
    }
  };

  const addKeyword = () => {
    const v = form.keywordInput.trim();
    if (v && !form.keywords.includes(v)) {
      setForm(f => ({ ...f, keywords: [...f.keywords, v], keywordInput: '' }));
    }
  };

  const handleLaunch = async () => {
    if (!form.keywords.length) { setError('Add at least one keyword'); return; }
    if (!form.platforms.length) { setError('Select at least one platform'); return; }
    setStep('launching');
    try {
      const token = session?.access_token;
      const resp = await fetch(`${BACKEND_URL}/api/apma/mobile/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.clientName,
          country: form.country,
          goal: form.goal,
          target_entities: form.targetEntities,
          campaign_type: form.campaignType,
          campaign_subtype: form.campaignSubtype || 'general',
          duration_months: form.durationMonths,
          platforms: form.platforms,
          keywords: form.keywords,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Setup failed');

      await AsyncStorage.setItem('apma_api_key', data.api_key);
      await AsyncStorage.setItem('apma_client_id', data.client.id);
      await AsyncStorage.setItem('apma_client_name', data.client.name);

      navigation.replace('APMADashboard', { clientId: data.client.id, clientName: data.client.name });
    } catch (e: any) {
      setStep('review');
      setError(e.message || 'Failed to launch campaign');
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'welcome':
        return (
          <View style={s.centeredContent}>
            <Text style={s.bigEmoji}>🗳️</Text>
            <Text style={s.heroTitle}>APMA</Text>
            <Text style={s.heroSubtitle}>Autonomous Political{'\n'}Marketing Agent</Text>
            <Text style={s.heroDesc}>
              Set up an AI-driven campaign that autonomously manages public narrative across all social platforms — 24/7.
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => next('name')}>
              <Text style={s.primaryBtnText}>Begin Campaign Setup</Text>
            </TouchableOpacity>
          </View>
        );

      case 'name':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Candidate / Client Name</Text>
            <Text style={s.stepDesc}>Enter the full name of the political candidate or client this campaign represents.</Text>
            <TextInput
              ref={inputRef}
              style={s.textInput}
              value={form.clientName}
              onChangeText={v => setForm(f => ({ ...f, clientName: v }))}
              placeholder="e.g. Governor John Smith"
              placeholderTextColor="#475569"
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => form.clientName.trim() && next('country')}
            />
            <TouchableOpacity
              style={[s.primaryBtn, !form.clientName.trim() && s.disabled]}
              onPress={() => form.clientName.trim() && next('country')}
              disabled={!form.clientName.trim()}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'country':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Country</Text>
            <Text style={s.stepDesc}>Select the country where this campaign operates.</Text>
            <TouchableOpacity style={s.selectRow} onPress={() => setCountryModalVisible(true)}>
              <Globe size={18} color="#00F0FF" />
              <Text style={s.selectRowText}>{form.countryName}</Text>
              <ChevronDown size={16} color="#64748B" />
            </TouchableOpacity>
            <Modal visible={countryModalVisible} transparent animationType="slide" onRequestClose={() => setCountryModalVisible(false)}>
              <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCountryModalVisible(false)}>
                <View style={s.modalSheet}>
                  <Text style={s.modalTitle}>Select Country</Text>
                  <ScrollView>
                    {COUNTRIES.map(c => (
                      <TouchableOpacity
                        key={c.code}
                        style={[s.modalOption, c.code === form.country && s.modalOptionSelected]}
                        onPress={() => { setForm(f => ({ ...f, country: c.code, countryName: c.name })); setCountryModalVisible(false); }}
                      >
                        <Text style={[s.modalOptionText, c.code === form.country && { color: '#00F0FF' }]}>{c.name}</Text>
                        {c.code === form.country && <Check size={14} color="#00F0FF" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
            <TouchableOpacity style={s.primaryBtn} onPress={() => next('campaign_type')}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'campaign_type':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Campaign Type</Text>
            <Text style={s.stepDesc}>What type of political campaign is this?</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {CAMPAIGN_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.value}
                  style={[s.optionCard, form.campaignType === ct.value && s.optionCardSelected]}
                  onPress={() => setForm(f => ({ ...f, campaignType: ct.value }))}
                >
                  <Text style={s.optionIcon}>{ct.icon}</Text>
                  <Text style={[s.optionLabel, form.campaignType === ct.value && { color: '#00F0FF' }]}>{ct.label}</Text>
                  {form.campaignType === ct.value && <Check size={16} color="#00F0FF" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[s.primaryBtn, !form.campaignType && s.disabled]}
              onPress={() => form.campaignType && next('campaign_subtype')}
              disabled={!form.campaignType}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'campaign_subtype': {
        const subtypes = form.campaignType === 'public_perception' ? SUBTYPES_PERCEPTION : SUBTYPES_ELECTORAL;
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Campaign Strategy</Text>
            <Text style={s.stepDesc}>What is the primary strategic approach for this campaign?</Text>
            {subtypes.map(st => (
              <TouchableOpacity
                key={st.value}
                style={[s.optionCard, form.campaignSubtype === st.value && s.optionCardSelected]}
                onPress={() => setForm(f => ({ ...f, campaignSubtype: st.value }))}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionLabel, form.campaignSubtype === st.value && { color: '#00F0FF' }]}>{st.label}</Text>
                  <Text style={s.optionDesc}>{st.desc}</Text>
                </View>
                {form.campaignSubtype === st.value && <Check size={16} color="#00F0FF" />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.primaryBtn, !form.campaignSubtype && s.disabled]}
              onPress={() => form.campaignSubtype && next('duration')}
              disabled={!form.campaignSubtype}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );
      }

      case 'duration':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Campaign Duration</Text>
            <Text style={s.stepDesc}>How long should APMA run this campaign?</Text>
            {([6, 12, 18, 24] as const).map(d => (
              <TouchableOpacity
                key={d}
                style={[s.optionCard, form.durationMonths === d && s.optionCardSelected]}
                onPress={() => setForm(f => ({ ...f, durationMonths: d }))}
              >
                <Clock size={18} color={form.durationMonths === d ? '#00F0FF' : '#475569'} />
                <Text style={[s.optionLabel, form.durationMonths === d && { color: '#00F0FF' }]}>{d} Months</Text>
                {form.durationMonths === d && <Check size={16} color="#00F0FF" style={{ marginLeft: 'auto' }} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.primaryBtn} onPress={() => next('goal')}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'goal':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Campaign Goal</Text>
            <Text style={s.stepDesc}>What is the primary objective for the AI agent?</Text>
            {[
              { value: 'improve' as const, label: 'Improve Narrative', desc: 'Build positive public sentiment and support for the client', icon: '📈' },
              { value: 'damage' as const, label: 'Counter Opposition', desc: 'Shift public narrative against rival candidates or targets', icon: '⚔️' },
            ].map(g => (
              <TouchableOpacity
                key={g.value}
                style={[s.optionCard, form.goal === g.value && s.optionCardSelected]}
                onPress={() => setForm(f => ({ ...f, goal: g.value }))}
              >
                <Text style={s.optionIcon}>{g.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionLabel, form.goal === g.value && { color: '#00F0FF' }]}>{g.label}</Text>
                  <Text style={s.optionDesc}>{g.desc}</Text>
                </View>
                {form.goal === g.value && <Check size={16} color="#00F0FF" />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.primaryBtn} onPress={() => next('targets')}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'targets':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Target Entities</Text>
            <Text style={s.stepDesc}>Add rival candidates or entities the agent should counter (optional).</Text>
            <View style={s.inputRow}>
              <TextInput
                style={[s.textInput, { flex: 1, marginBottom: 0 }]}
                value={form.targetInput}
                onChangeText={v => setForm(f => ({ ...f, targetInput: v }))}
                placeholder="e.g. Rival Candidate Name"
                placeholderTextColor="#475569"
                returnKeyType="done"
                onSubmitEditing={addTarget}
              />
              <TouchableOpacity style={s.addBtn} onPress={addTarget}>
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            <View style={s.tagList}>
              {form.targetEntities.map(t => (
                <TouchableOpacity key={t} style={s.tag} onPress={() => setForm(f => ({ ...f, targetEntities: f.targetEntities.filter(x => x !== t) }))}>
                  <Text style={s.tagText}>{t} ×</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.primaryBtn} onPress={() => next('keywords')}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'keywords':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Campaign Keywords</Text>
            <Text style={s.stepDesc}>Add policy topics and keywords for the AI to monitor and amplify.</Text>
            <View style={s.inputRow}>
              <TextInput
                style={[s.textInput, { flex: 1, marginBottom: 0 }]}
                value={form.keywordInput}
                onChangeText={v => setForm(f => ({ ...f, keywordInput: v }))}
                placeholder="e.g. healthcare, economy, security"
                placeholderTextColor="#475569"
                returnKeyType="done"
                onSubmitEditing={addKeyword}
              />
              <TouchableOpacity style={s.addBtn} onPress={addKeyword}>
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            <View style={s.tagList}>
              {form.keywords.map(k => (
                <TouchableOpacity key={k} style={[s.tag, { backgroundColor: 'rgba(0,240,255,0.08)', borderColor: 'rgba(0,240,255,0.25)' }]} onPress={() => setForm(f => ({ ...f, keywords: f.keywords.filter(x => x !== k) }))}>
                  <Text style={[s.tagText, { color: '#00F0FF' }]}># {k} ×</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[s.primaryBtn, !form.keywords.length && s.disabled]}
              onPress={() => form.keywords.length && next('platforms')}
              disabled={!form.keywords.length}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        );

      case 'platforms':
        return (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Active Platforms</Text>
            <Text style={s.stepDesc}>Select the social platforms for autonomous publishing and monitoring.</Text>
            {PLATFORM_OPTIONS.map(p => {
              const selected = form.platforms.includes(p.value);
              return (
                <TouchableOpacity
                  key={p.value}
                  style={[s.optionCard, selected && { borderColor: p.color, backgroundColor: 'rgba(0,240,255,0.05)' }]}
                  onPress={() => togglePlatform(p.value)}
                >
                  <View style={[s.platformDot, { backgroundColor: p.color }]} />
                  <Text style={[s.optionLabel, selected && { color: '#E2E8F0' }]}>{p.label}</Text>
                  {selected && <Check size={16} color={p.color} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[s.primaryBtn, !form.platforms.length && s.disabled]}
              onPress={() => form.platforms.length && next('review')}
              disabled={!form.platforms.length}
            >
              <Text style={s.primaryBtnText}>Review Campaign</Text>
            </TouchableOpacity>
          </View>
        );

      case 'review':
        return (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Review & Launch</Text>
              <View style={s.reviewCard}>
                {[
                  ['Client', form.clientName],
                  ['Country', form.countryName],
                  ['Campaign Type', CAMPAIGN_TYPES.find(c => c.value === form.campaignType)?.label ?? form.campaignType],
                  ['Strategy', form.campaignSubtype],
                  ['Duration', `${form.durationMonths} months`],
                  ['Goal', form.goal === 'improve' ? 'Improve Narrative' : 'Counter Opposition'],
                  ['Targets', form.targetEntities.join(', ') || 'None'],
                  ['Keywords', form.keywords.join(', ')],
                  ['Platforms', form.platforms.join(', ')],
                ].map(([label, value]) => (
                  <View key={label} style={s.reviewRow}>
                    <Text style={s.reviewLabel}>{label}</Text>
                    <Text style={s.reviewValue}>{value}</Text>
                  </View>
                ))}
              </View>
              {error ? <Text style={s.errorText}>{error}</Text> : null}
              <TouchableOpacity style={[s.primaryBtn, { marginTop: 8 }]} onPress={handleLaunch}>
                <Text style={s.primaryBtnText}>🚀 Launch APMA Campaign</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        );

      case 'launching':
        return (
          <View style={s.centeredContent}>
            <ActivityIndicator size="large" color="#00F0FF" />
            <Text style={s.launchingText}>Launching APMA...</Text>
            <Text style={s.launchingSubtext}>Creating agents and seeding personas for {form.countryName}</Text>
          </View>
        );

      default:
        return null;
    }
  };

  const showBack = step !== 'welcome' && step !== 'launching';
  const stepLabels: Record<Step, string> = {
    welcome: '', name: 'Client Name', country: 'Country', campaign_type: 'Type',
    campaign_subtype: 'Strategy', duration: 'Duration', goal: 'Goal',
    targets: 'Targets', keywords: 'Keywords', platforms: 'Platforms',
    review: 'Review', launching: 'Launching',
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.header, { paddingTop: 8 }]}>
          {showBack ? (
            <TouchableOpacity style={s.backBtn} onPress={goBack}>
              <ArrowLeft size={20} color="#E2E8F0" />
            </TouchableOpacity>
          ) : <View style={{ width: 36 }} />}
          <Text style={s.headerTitle}>
            {step === 'welcome' ? 'APMA Setup' : stepLabels[step]}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          {renderStep()}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 16 },
  centeredContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  bigEmoji: { fontSize: 64, marginBottom: 16 },
  heroTitle: { color: '#00F0FF', fontSize: 36, fontWeight: '900', letterSpacing: 4, marginBottom: 4 },
  heroSubtitle: { color: '#E2E8F0', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16, lineHeight: 26 },
  heroDesc: { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  stepContent: { flex: 1, paddingTop: 24 },
  stepTitle: { color: '#E2E8F0', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  stepDesc: { color: '#94A3B8', fontSize: 14, lineHeight: 20, marginBottom: 24 },
  textInput: { backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#E2E8F0', fontSize: 15, marginBottom: 20 },
  primaryBtn: { backgroundColor: '#00F0FF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.4 },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 20 },
  selectRowText: { flex: 1, color: '#E2E8F0', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#151B2B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  modalTitle: { color: '#00F0FF', fontWeight: '800', fontSize: 14, letterSpacing: 1, marginBottom: 12 },
  modalOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  modalOptionSelected: { backgroundColor: 'rgba(0,240,255,0.06)' },
  modalOptionText: { color: '#E2E8F0', fontSize: 15 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10 },
  optionCardSelected: { borderColor: '#00F0FF', backgroundColor: 'rgba(0,240,255,0.05)' },
  optionIcon: { fontSize: 22 },
  optionLabel: { color: '#94A3B8', fontWeight: '600', fontSize: 15 },
  optionDesc: { color: '#475569', fontSize: 12, marginTop: 2 },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  addBtn: { backgroundColor: 'rgba(0,240,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center' },
  addBtnText: { color: '#00F0FF', fontWeight: '700', fontSize: 14 },
  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tag: { backgroundColor: 'rgba(129,140,248,0.1)', borderWidth: 1, borderColor: 'rgba(129,140,248,0.25)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: '#818CF8', fontSize: 13, fontWeight: '600' },
  reviewCard: { backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 16, marginBottom: 16 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  reviewLabel: { color: '#64748B', fontSize: 13 },
  reviewValue: { color: '#E2E8F0', fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 12 },
  errorText: { color: '#F87171', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  launchingText: { color: '#E2E8F0', fontSize: 20, fontWeight: '800', marginTop: 24 },
  launchingSubtext: { color: '#64748B', fontSize: 14, marginTop: 8, textAlign: 'center' },
});
