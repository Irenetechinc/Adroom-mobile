import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Image, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import { useEnergyStore } from '../store/energyStore';
import { CreativeAsset } from '../types/agent';
import { Zap, AlertTriangle, X } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'StrategyApproval'>;

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

function friendlyAction(action: string): string {
  return action
    .replace(/\b(SALESMAN|AWARENESS|PROMOTION|LAUNCH|IPE|orchestrat\w+|protocol\w*|agent\w*)\b/gi, '')
    .replace(/\bconnection protocols?\b/gi, 'platform setup')
    .replace(/\binitiating\b/gi, 'Starting')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function StrategyApprovalScreen({ navigation }: Props) {
  const { generatedStrategies, setActiveStrategy } = useAgentStore();
  const { account, fetchEnergy } = useEnergyStore();
  const [launching, setLaunching] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditModalData, setCreditModalData] = useState<{
    balance: number; estimatedCost: number; durationWeeks: number; isExhausted: boolean;
  } | null>(null);

  useEffect(() => { fetchEnergy(); }, []);

  if (!generatedStrategies) {
    return <View className="flex-1 bg-adroom-dark" />;
  }

  const activeStrategy = generatedStrategies?.strategy ?? null;

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

  if (!activeStrategy) return <View className="flex-1 bg-adroom-dark" />;

  const schedule: any[] = Array.isArray(activeStrategy.schedule) ? activeStrategy.schedule : [];
  const first7Days = schedule.filter((s: any) => s.day >= 1 && s.day <= 7);

  const actions: string[] = Array.isArray(activeStrategy.actions)
    ? activeStrategy.actions
    : Array.isArray(activeStrategy.organic_leverage_points)
    ? activeStrategy.organic_leverage_points
    : [];

  const platforms: string[] = Array.isArray(activeStrategy.platforms) ? activeStrategy.platforms : [];

  return (
    <View className="flex-1 bg-adroom-dark">
      <View className="bg-adroom-card px-4 py-3 border-b border-adroom-neon/20">
        <Text className="text-adroom-neon text-center font-bold uppercase tracking-widest">Strategy Preview</Text>
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

            <TouchableOpacity
              onPress={() => setShowCreditModal(false)}
              style={{ alignItems: 'center', paddingVertical: 10 }}
            >
              <Text style={{ color: '#475569', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView className="flex-1 p-4">

        {/* Header */}
        <View className="bg-adroom-card rounded-xl p-5 mb-4 shadow-lg shadow-adroom-neon/10 border border-adroom-neon/20">
          <Text className="text-2xl font-bold text-white mb-1 uppercase tracking-wide">{activeStrategy.title}</Text>
          <Text className="text-adroom-text-muted mb-3">{activeStrategy.description || activeStrategy.rationale}</Text>

          <View className="flex-row flex-wrap">
            {activeStrategy.targetAudience ? (
              <View className="bg-adroom-neon/10 px-3 py-1 rounded-md mr-2 mb-2 border border-adroom-neon/30">
                <Text className="text-xs text-adroom-neon">🎯 {activeStrategy.targetAudience}</Text>
              </View>
            ) : null}
            {activeStrategy.brandVoice ? (
              <View className="bg-adroom-purple/10 px-3 py-1 rounded-md mr-2 mb-2 border border-adroom-purple/30">
                <Text className="text-xs text-adroom-purple">📢 {activeStrategy.brandVoice}</Text>
              </View>
            ) : null}
            {activeStrategy.lifespanWeeks ? (
              <View className="bg-adroom-card px-3 py-1 rounded-md mb-2 border border-white/20">
                <Text className="text-xs text-white">⏱️ {activeStrategy.lifespanWeeks} Weeks</Text>
              </View>
            ) : null}
            {platforms.map((p: string) => (
              <View key={p} className="bg-adroom-card px-3 py-1 rounded-md mr-2 mb-2 border border-white/10">
                <Text className="text-xs text-white">{PLATFORM_ICONS[p.toLowerCase()] || '📱'} {p.charAt(0).toUpperCase() + p.slice(1)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 7-Day Content Calendar */}
        {first7Days.length > 0 && (
          <View className="mb-4">
            <Text className="text-lg font-bold text-adroom-neon mb-3 uppercase tracking-wider">First 7 Days</Text>
            {first7Days.map((item: any, idx: number) => {
              const platform = (item.platform || '').toLowerCase();
              const contentType = (item.content_type || 'post').toLowerCase();
              return (
                <View
                  key={idx}
                  className="bg-adroom-card rounded-xl p-4 mb-3 border border-adroom-neon/10 flex-row items-start"
                >
                  <View className="w-10 h-10 rounded-full bg-adroom-neon/10 border border-adroom-neon/30 items-center justify-center mr-3 mt-0.5">
                    <Text className="text-adroom-neon font-bold text-sm">D{item.day}</Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center mb-1 flex-wrap">
                      <Text className="text-xs text-adroom-text-muted mr-2">
                        {PLATFORM_ICONS[platform] || '📱'} {(item.platform || '').charAt(0).toUpperCase() + (item.platform || '').slice(1)}
                      </Text>
                      <View className="bg-adroom-neon/10 px-2 py-0.5 rounded mr-2">
                        <Text className="text-xs text-adroom-neon">
                          {CONTENT_TYPE_ICONS[contentType] || '📝'} {item.content_type}
                        </Text>
                      </View>
                      {item.time ? (
                        <Text className="text-xs text-adroom-text-muted">🕐 {item.time}</Text>
                      ) : null}
                    </View>
                    <Text className="text-white text-sm font-semibold mb-0.5">{item.topic}</Text>
                    {item.reason ? (
                      <Text className="text-xs text-adroom-text-muted italic">{item.reason}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Generated Assets */}
        {Array.isArray(activeStrategy.assets) && activeStrategy.assets.length > 0 && (
          <View className="mb-4">
            <Text className="text-lg font-bold text-adroom-neon mb-3 uppercase tracking-wider">Generated Assets</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {activeStrategy.assets.map((asset: CreativeAsset) => (
                <View key={asset.id} className="mr-4 bg-adroom-card rounded-xl overflow-hidden shadow-sm w-64 border border-adroom-neon/20">
                  <Image source={{ uri: asset.url }} className="w-full h-40" resizeMode="cover" />
                  <View className="p-3">
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-xs font-bold text-adroom-dark bg-adroom-neon px-2 py-0.5 rounded">
                        {asset.type}
                      </Text>
                      <Text className="text-xs text-adroom-text-muted uppercase">{asset.purpose}</Text>
                    </View>
                    <Text className="text-xs text-adroom-text italic" numberOfLines={2}>
                      "{asset.prompt}"
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Execution Plan */}
        {actions.length > 0 && (
          <View className="bg-adroom-card rounded-xl p-5 mb-4 shadow-sm border border-adroom-neon/10">
            <Text className="text-lg font-bold text-adroom-neon mb-3 uppercase tracking-wider">What Your AI Will Do</Text>
            {actions.map((action: string, idx: number) => {
              const clean = friendlyAction(action);
              if (!clean) return null;
              return (
                <View key={idx} className="flex-row items-start mb-2">
                  <View className="w-6 h-6 rounded-full bg-green-500/20 items-center justify-center mr-3 mt-0.5 border border-green-500/50">
                    <Text className="text-green-400 text-xs">✓</Text>
                  </View>
                  <Text className="text-adroom-text flex-1">{clean}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Projections */}
        {activeStrategy.estimatedReach || activeStrategy.estimated_outcomes ? (
          <View className="bg-adroom-card rounded-xl p-5 mb-6 shadow-sm border border-adroom-neon/20">
            <Text className="text-lg font-bold text-adroom-neon mb-3 uppercase tracking-wider">Projected Results</Text>
            <View className="flex-row justify-between flex-wrap">
              {activeStrategy.estimatedReach ? (
                <View className="mb-2 mr-4">
                  <Text className="text-xs text-adroom-text-muted uppercase font-bold">Est. Reach</Text>
                  <Text className="text-lg font-bold text-white">{activeStrategy.estimatedReach}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.reach ? (
                <View className="mb-2 mr-4">
                  <Text className="text-xs text-adroom-text-muted uppercase font-bold">Reach</Text>
                  <Text className="text-lg font-bold text-white">{Number(activeStrategy.estimated_outcomes.reach).toLocaleString()}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.engagement ? (
                <View className="mb-2 mr-4">
                  <Text className="text-xs text-adroom-text-muted uppercase font-bold">Engagement</Text>
                  <Text className="text-lg font-bold text-white">{Number(activeStrategy.estimated_outcomes.engagement).toLocaleString()}</Text>
                </View>
              ) : null}
              {activeStrategy.estimated_outcomes?.paid_equivalent_value_usd ? (
                <View className="mb-2">
                  <Text className="text-xs text-adroom-text-muted uppercase font-bold">Paid Ad Equivalent</Text>
                  <Text className="text-lg font-bold text-adroom-neon">${Number(activeStrategy.estimated_outcomes.paid_equivalent_value_usd).toLocaleString()}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={handleApprove}
          disabled={launching}
          className="w-full bg-adroom-neon py-4 rounded-xl items-center shadow-lg shadow-adroom-neon/50 mb-8"
          style={launching ? { opacity: 0.7 } : undefined}
        >
          {launching ? (
            <ActivityIndicator color="#0B0F19" />
          ) : (
            <Text className="text-adroom-dark font-bold text-lg uppercase tracking-widest">Approve & Launch</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
