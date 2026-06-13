import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert,
  Image, ActivityIndicator, Modal, StyleSheet, Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import { useEnergyStore } from '../store/energyStore';
import { CreativeAsset } from '../types/agent';
import { Zap, AlertTriangle, ImageIcon, Sparkles } from 'lucide-react-native';
import { supabase } from '../config/supabase';

type Props = NativeStackScreenProps<RootStackParamList, 'StrategyApproval'>;

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || '';

const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘',
  instagram: '📸',
  tiktok: '🎵',
  linkedin: '💼',
  x: '✖️',
  twitter: '✖️',
  youtube: '▶️',
};

const CONTENT_TYPE_ICONS: Record<string, string> = {
  video: '🎬',
  reel: '📱',
  story: '⏰',
  carousel: '🖼️',
  post: '📝',
  image: '🖼️',
  article: '📰',
  live: '🔴',
};

const GOAL_COLORS: Record<string, string> = {
  SALESMAN: '#10B981',
  AWARENESS: '#00F0FF',
  PROMOTION: '#F59E0B',
  LAUNCH: '#8B5CF6',
};

interface PreviewAsset {
  day: number;
  platform: string;
  taskType: string;
  headline: string;
  body: string;
  hashtags: string[];
  hook?: string;
  tiktokScript?: any;
  imageUrl?: string;
  designStyle?: string;
  fingerprint?: string;
  error?: string;
}

function friendlyAction(action: string): string {
  return action
    .replace(/\b(SALESMAN|AWARENESS|PROMOTION|LAUNCH|IPE|orchestrat\w+|protocol\w*|agent\w*)\b/gi, '')
    .replace(/\bconnection protocols?\b/gi, 'platform setup')
    .replace(/\binitiating\b/gi, 'Starting')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function AssetSkeleton() {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{ opacity: anim, width: 200, height: 140, backgroundColor: '#1E293B', borderRadius: 12, marginRight: 12, borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center' }}>
      <ImageIcon size={32} color="#334155" />
      <Text style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>Generating…</Text>
    </Animated.View>
  );
}

export default function StrategyApprovalScreen({ navigation }: Props) {
  const { generatedStrategies, setActiveStrategy } = useAgentStore();
  const { account, fetchEnergy } = useEnergyStore();
  const [launching, setLaunching] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditModalData, setCreditModalData] = useState<{
    balance: number; estimatedCost: number; durationWeeks: number; isExhausted: boolean;
  } | null>(null);

  // Real generated preview assets state
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assetsGenerated, setAssetsGenerated] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => { fetchEnergy(); }, []);

  const activeStrategy = generatedStrategies?.strategy ?? null;

  // Fetch real AI-generated preview assets for the first 7 days
  useEffect(() => {
    if (!activeStrategy || fetchedRef.current || assetsGenerated) return;
    fetchedRef.current = true;

    const schedule: any[] = Array.isArray(activeStrategy.schedule) ? activeStrategy.schedule : [];
    const first7Days = schedule.filter((s: any) => s.day >= 1 && s.day <= 7);
    if (!first7Days.length) return;

    const weekPreview = first7Days.map((item: any) => ({
      day: item.day,
      platform: item.platform || 'instagram',
      task_type: item.content_type || item.task_type || 'POST_CONTENT',
      headline: item.topic || item.headline || item.title || '',
      body: item.reason || item.caption || item.body || '',
      hashtags: item.hashtags || [],
      hook: item.hook,
      tiktok_script: item.tiktok_script,
    }));

    const generateAssets = async () => {
      setAssetsLoading(true);
      setAssetsError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const resp = await fetch(`${BACKEND_URL}/api/ai/generate-preview-assets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            strategyId: activeStrategy.strategyId || activeStrategy.id,
            productId: generatedStrategies?.productId,
            goal: activeStrategy.goal || activeStrategy.agentType || 'AWARENESS',
            weekPreview,
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.message || err.error || 'Failed to generate preview assets');
        }

        const { assets } = await resp.json();
        setPreviewAssets(assets || []);
        setAssetsGenerated(true);
      } catch (e: any) {
        console.warn('[StrategyApproval] Preview assets error (non-blocking):', e.message);
        setAssetsError(e.message);
      } finally {
        setAssetsLoading(false);
      }
    };

    generateAssets();
  }, [activeStrategy]);

  if (!generatedStrategies) {
    return <View style={{ flex: 1, backgroundColor: '#0B0F19' }} />;
  }

  if (!activeStrategy) {
    return <View style={{ flex: 1, backgroundColor: '#0B0F19' }} />;
  }

  const schedule: any[] = Array.isArray(activeStrategy.schedule) ? activeStrategy.schedule : [];
  const first7Days = schedule.filter((s: any) => s.day >= 1 && s.day <= 7);

  const actions: string[] = Array.isArray(activeStrategy.actions)
    ? activeStrategy.actions
    : Array.isArray(activeStrategy.organic_leverage_points)
    ? activeStrategy.organic_leverage_points
    : [];

  const platforms: string[] = Array.isArray(activeStrategy.platforms) ? activeStrategy.platforms : [];
  const goal: string = (activeStrategy.goal || activeStrategy.agentType || 'AWARENESS').toUpperCase();
  const goalColor = GOAL_COLORS[goal] || '#00F0FF';

  const doLaunch = async () => {
    setShowCreditModal(false);
    setLaunching(true);
    try {
      await setActiveStrategy(activeStrategy);
      navigation.navigate('AgentChat', { fromStrategyApproval: true });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLaunching(false);
    }
  };

  const handleApprove = async () => {
    if (!activeStrategy) return;
    const balance = parseFloat(String(account?.balance_credits ?? '0'));
    const durationWeeks = activeStrategy.lifespanWeeks || activeStrategy.duration || 4;
    const estimatedCost = Math.ceil(durationWeeks * 7 * 3);
    if (balance <= 0 || balance < estimatedCost) {
      setCreditModalData({ balance, estimatedCost, durationWeeks, isExhausted: balance <= 0 });
      setShowCreditModal(true);
      return;
    }
    await doLaunch();
  };

  // Map day index → previewAsset for overlay display
  const assetByDay: Record<number, PreviewAsset> = {};
  for (const a of previewAssets) {
    assetByDay[a.day] = a;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0F19' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#0F1623', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.2)' }}>
        <Text style={{ color: '#00F0FF', textAlign: 'center', fontWeight: '800', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase' }}>Strategy Preview</Text>
      </View>

      {/* Credit Check Modal */}
      <Modal visible={showCreditModal} transparent animationType="fade" onRequestClose={() => setShowCreditModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#151B2B', borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: creditModalData?.isExhausted ? '#EF4444' : '#F59E0B' }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: creditModalData?.isExhausted ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <AlertTriangle size={28} color={creditModalData?.isExhausted ? '#EF4444' : '#F59E0B'} />
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
                {creditModalData?.isExhausted ? 'No Energy Credits' : 'Low Energy Warning'}
              </Text>
            </View>
            <View style={{ backgroundColor: '#0B0F19', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: '#64748B', fontSize: 13 }}>Your Balance</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Zap size={13} color="#00F0FF" />
                  <Text style={{ color: '#00F0FF', fontWeight: '700', fontSize: 13 }}>{creditModalData?.balance.toFixed(1)} credits</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: '#64748B', fontSize: 13 }}>Estimated Cost ({creditModalData?.durationWeeks}wks)</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Zap size={13} color="#F59E0B" />
                  <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 13 }}>~{creditModalData?.estimatedCost} credits</Text>
                </View>
              </View>
              <View style={{ height: 1, backgroundColor: '#1E293B', marginVertical: 8 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#64748B', fontSize: 13 }}>Credits Needed</Text>
                <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 13 }}>
                  +{Math.max(0, (creditModalData?.estimatedCost ?? 0) - (creditModalData?.balance ?? 0)).toFixed(0)} credits
                </Text>
              </View>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 19 }}>
              {creditModalData?.isExhausted
                ? 'You have no credits. Top up to activate your strategy.'
                : 'Your strategy may pause mid-campaign if credits run out. Top up for uninterrupted execution.'}
            </Text>
            <TouchableOpacity
              onPress={() => { setShowCreditModal(false); (navigation as any).navigate('Subscription', { tab: 'topup' }); }}
              style={{ backgroundColor: '#00F0FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
            >
              <Text style={{ color: '#0B0F19', fontWeight: '800', fontSize: 15 }}>Top Up Credits</Text>
            </TouchableOpacity>
            {!creditModalData?.isExhausted && (
              <TouchableOpacity
                onPress={doLaunch}
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
              >
                <Text style={{ color: '#94A3B8', fontWeight: '700', fontSize: 15 }}>Continue Anyway (Skip)</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowCreditModal(false)} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: '#475569', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>

        {/* Strategy Header */}
        <View style={{ backgroundColor: '#0F1623', borderRadius: 16, padding: 20, marginTop: 16, marginBottom: 16, borderWidth: 1, borderColor: `${goalColor}30` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ backgroundColor: `${goalColor}20`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: `${goalColor}50` }}>
              <Text style={{ color: goalColor, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{goal} MODE</Text>
            </View>
            {activeStrategy.lifespanWeeks ? (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ color: '#94A3B8', fontSize: 11, fontWeight: '600' }}>⏱ {activeStrategy.lifespanWeeks} weeks</Text>
              </View>
            ) : null}
          </View>

          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginBottom: 6, letterSpacing: 0.5 }}>{activeStrategy.title}</Text>
          <Text style={{ color: '#94A3B8', fontSize: 14, lineHeight: 20, marginBottom: 12 }}>{activeStrategy.description || activeStrategy.rationale}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {activeStrategy.targetAudience ? (
              <View style={{ backgroundColor: `${goalColor}15`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: `${goalColor}30` }}>
                <Text style={{ color: goalColor, fontSize: 12 }}>🎯 {activeStrategy.targetAudience}</Text>
              </View>
            ) : null}
            {activeStrategy.brandVoice ? (
              <View style={{ backgroundColor: 'rgba(139,92,246,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)' }}>
                <Text style={{ color: '#A78BFA', fontSize: 12 }}>📢 {activeStrategy.brandVoice}</Text>
              </View>
            ) : null}
            {platforms.map((p: string) => (
              <View key={p} style={{ backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ color: '#CBD5E1', fontSize: 12 }}>{PLATFORM_ICONS[p.toLowerCase()] || '📱'} {p.charAt(0).toUpperCase() + p.slice(1)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── FIRST 7 DAYS: Content Calendar + Real AI Graphics ── */}
        {first7Days.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: goalColor, fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', flex: 1 }}>First 7 Days</Text>
              {assetsLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color={goalColor} />
                  <Text style={{ color: '#64748B', fontSize: 11 }}>Generating graphics…</Text>
                </View>
              )}
              {assetsGenerated && !assetsLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Sparkles size={13} color={goalColor} />
                  <Text style={{ color: goalColor, fontSize: 11, fontWeight: '600' }}>AI graphics ready</Text>
                </View>
              )}
            </View>

            {first7Days.map((item: any, idx: number) => {
              const platform = (item.platform || '').toLowerCase();
              const contentType = (item.content_type || 'post').toLowerCase();
              const asset = assetByDay[item.day];

              return (
                <View
                  key={idx}
                  style={{ backgroundColor: '#0F1623', borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: asset?.imageUrl ? `${goalColor}30` : 'rgba(255,255,255,0.06)', overflow: 'hidden' }}
                >
                  {/* Real AI graphic if available */}
                  {assetsLoading && !asset?.imageUrl ? (
                    <View style={{ height: 150, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator size="small" color="#334155" />
                      <Text style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>Generating Day {item.day} graphic…</Text>
                    </View>
                  ) : asset?.imageUrl ? (
                    <View style={{ position: 'relative' }}>
                      <Image
                        source={{ uri: asset.imageUrl }}
                        style={{ width: '100%', height: 180 }}
                        resizeMode="cover"
                      />
                      {/* Day badge overlay */}
                      <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: '#0B0F19CC', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: `${goalColor}60` }}>
                        <Text style={{ color: goalColor, fontWeight: '800', fontSize: 13 }}>Day {item.day}</Text>
                      </View>
                      {/* Design style badge */}
                      {asset.designStyle && (
                        <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: '#0B0F19CC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                          <Text style={{ color: '#94A3B8', fontSize: 10 }}>{asset.designStyle}</Text>
                        </View>
                      )}
                      {/* Platform icon overlay */}
                      <View style={{ position: 'absolute', bottom: 10, right: 10, backgroundColor: '#0B0F19CC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                        <Text style={{ fontSize: 16 }}>{PLATFORM_ICONS[platform] || '📱'}</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Content info */}
                  <View style={{ padding: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      {!asset?.imageUrl && (
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${goalColor}15`, borderWidth: 1, borderColor: `${goalColor}40`, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                          <Text style={{ color: goalColor, fontWeight: '800', fontSize: 12 }}>D{item.day}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <Text style={{ color: '#64748B', fontSize: 12 }}>
                            {PLATFORM_ICONS[platform] || '📱'} {(item.platform || '').charAt(0).toUpperCase() + (item.platform || '').slice(1)}
                          </Text>
                          <View style={{ backgroundColor: `${goalColor}15`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: `${goalColor}30` }}>
                            <Text style={{ color: goalColor, fontSize: 11 }}>
                              {CONTENT_TYPE_ICONS[contentType] || '📝'} {item.content_type}
                            </Text>
                          </View>
                          {item.time ? (
                            <Text style={{ color: '#475569', fontSize: 11 }}>🕐 {item.time}</Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                    <Text style={{ color: '#F1F5F9', fontSize: 14, fontWeight: '700', marginBottom: 4 }}>{item.topic}</Text>
                    {asset?.hook || item.hook ? (
                      <Text style={{ color: '#94A3B8', fontSize: 12, marginBottom: 3, fontStyle: 'italic' }}>
                        🪝 {asset?.hook || item.hook}
                      </Text>
                    ) : null}
                    {item.reason ? (
                      <Text style={{ color: '#64748B', fontSize: 12 }}>{item.reason}</Text>
                    ) : null}
                    {asset?.hashtags?.length ? (
                      <Text style={{ color: `${goalColor}99`, fontSize: 11, marginTop: 6 }} numberOfLines={1}>
                        {asset.hashtags.slice(0, 5).map((h: string) => `#${h}`).join(' ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Legacy Assets (if returned from strategy, fallback) */}
        {Array.isArray(activeStrategy.assets) && activeStrategy.assets.length > 0 && previewAssets.length === 0 && !assetsLoading && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: goalColor, fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>Generated Assets</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {activeStrategy.assets.map((asset: CreativeAsset) => (
                <View key={asset.id} style={{ marginRight: 14, backgroundColor: '#0F1623', borderRadius: 14, overflow: 'hidden', width: 220, borderWidth: 1, borderColor: `${goalColor}25` }}>
                  <Image source={{ uri: asset.url }} style={{ width: '100%', height: 140 }} resizeMode="cover" />
                  <View style={{ padding: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#0B0F19', fontWeight: '800', fontSize: 11, backgroundColor: goalColor, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 }}>
                        {asset.type}
                      </Text>
                      <Text style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase' }}>{asset.purpose}</Text>
                    </View>
                    <Text style={{ color: '#94A3B8', fontSize: 11, fontStyle: 'italic' }} numberOfLines={2}>
                      "{asset.prompt}"
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* What AdRoom AI Will Do */}
        {actions.length > 0 && (
          <View style={{ backgroundColor: '#0F1623', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ color: goalColor, fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>What AdRoom AI Will Do</Text>
            {actions.map((action: string, idx: number) => {
              const clean = friendlyAction(action);
              if (!clean) return null;
              return (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)' }}>
                    <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '700' }}>✓</Text>
                  </View>
                  <Text style={{ color: '#CBD5E1', flex: 1, fontSize: 14, lineHeight: 20 }}>{clean}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Projected Results */}
        {(activeStrategy.estimatedReach || activeStrategy.estimated_outcomes) ? (
          <View style={{ backgroundColor: '#0F1623', borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: `${goalColor}20` }}>
            <Text style={{ color: goalColor, fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>Projected Results</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {activeStrategy.estimatedReach ? (
                <View style={{ marginBottom: 12, marginRight: 16 }}>
                  <Text style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 2 }}>Est. Reach</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{activeStrategy.estimatedReach}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.reach ? (
                <View style={{ marginBottom: 12, marginRight: 16 }}>
                  <Text style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 2 }}>Reach</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{Number(activeStrategy.estimated_outcomes.reach).toLocaleString()}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.engagement ? (
                <View style={{ marginBottom: 12, marginRight: 16 }}>
                  <Text style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 2 }}>Engagement</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{Number(activeStrategy.estimated_outcomes.engagement).toLocaleString()}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.paid_equivalent_value_usd ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 2 }}>Paid Ad Equivalent</Text>
                  <Text style={{ color: goalColor, fontSize: 20, fontWeight: '800' }}>${Number(activeStrategy.estimated_outcomes.paid_equivalent_value_usd).toLocaleString()}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Approve & Launch CTA */}
        <TouchableOpacity
          onPress={handleApprove}
          disabled={launching}
          style={{
            width: '100%',
            backgroundColor: goalColor,
            paddingVertical: 18,
            borderRadius: 16,
            alignItems: 'center',
            marginBottom: 36,
            opacity: launching ? 0.7 : 1,
            shadowColor: goalColor,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 8,
          }}
        >
          {launching ? (
            <ActivityIndicator color="#0B0F19" />
          ) : (
            <Text style={{ color: '#0B0F19', fontWeight: '900', fontSize: 16, letterSpacing: 2, textTransform: 'uppercase' }}>
              Approve & Launch
            </Text>
          )}
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}
