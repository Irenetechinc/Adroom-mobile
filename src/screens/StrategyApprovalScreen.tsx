import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import { CreativeAsset } from '../types/agent';

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

  if (!generatedStrategies) {
    return <View className="flex-1 bg-adroom-dark" />;
  }

  const activeStrategy: any = (generatedStrategies as any)?.strategy || null;

  const handleApprove = async () => {
    if (!activeStrategy) return;

    Alert.alert(
      'Activate Strategy',
      `Confirm activation of "${activeStrategy.title}". Your AI will begin executing this plan automatically.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve & Launch',
          onPress: async () => {
            try {
              await setActiveStrategy(activeStrategy);
              navigation.navigate('AgentChat', { fromStrategyApproval: true } as any);
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
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
          className="w-full bg-adroom-neon py-4 rounded-xl items-center shadow-lg shadow-adroom-neon/50 mb-8"
        >
          <Text className="text-adroom-dark font-bold text-lg uppercase tracking-widest">Approve & Launch</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
