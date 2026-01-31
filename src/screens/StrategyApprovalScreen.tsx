import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Image, Dimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import { Strategy, CreativeAsset } from '../types/agent';
import { AutonomousService } from '../services/autonomous';

type Props = NativeStackScreenProps<RootStackParamList, 'StrategyApproval'>;

const { width } = Dimensions.get('window');

export default function StrategyApprovalScreen({ navigation }: Props) {
  const { generatedStrategies, setActiveStrategy } = useAgentStore();
  const [selectedTab, setSelectedTab] = useState<'FREE' | 'PAID'>('PAID');

  const activeStrategy = generatedStrategies.find(s => s.type === selectedTab) || generatedStrategies[0];

  const handleApprove = async () => {
    if (!activeStrategy) return;

    Alert.alert(
      'Activate Strategy',
      `Confirm activation of ${activeStrategy.title}. This will initiate the connection protocols.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Approve & Proceed', 
          onPress: async () => {
            try {
              // 1. Set as Active Strategy in Store (Persist)
              await setActiveStrategy(activeStrategy);

              // 2. Instead of executing immediately, we now navigate back to Chat
              // to trigger the Guided Facebook Connection Flow
              navigation.navigate('AgentChat', { fromStrategyApproval: true } as any);
              
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          }
        }
      ]
    );
  };

  if (!activeStrategy) return <View className="flex-1 bg-adroom-dark" />;

  return (
    <View className="flex-1 bg-adroom-dark">
      <View className="bg-adroom-card px-4 py-3 flex-row justify-center border-b border-adroom-neon/20">
        <TouchableOpacity 
          onPress={() => setSelectedTab('FREE')}
          className={`px-6 py-2 rounded-l-lg border border-adroom-neon ${selectedTab === 'FREE' ? 'bg-adroom-neon' : 'bg-transparent'}`}
        >
          <Text className={`${selectedTab === 'FREE' ? 'text-adroom-dark' : 'text-adroom-neon'} font-bold uppercase`}>Free Strategy</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => setSelectedTab('PAID')}
          className={`px-6 py-2 rounded-r-lg border border-adroom-neon ${selectedTab === 'PAID' ? 'bg-adroom-neon' : 'bg-transparent'}`}
        >
          <Text className={`${selectedTab === 'PAID' ? 'text-adroom-dark' : 'text-adroom-neon'} font-bold uppercase`}>Paid Strategy</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 p-4">
        {/* Header Section */}
        <View className="bg-adroom-card rounded-xl p-5 mb-4 shadow-lg shadow-adroom-neon/10 border border-adroom-neon/20">
          <Text className="text-2xl font-bold text-white mb-1 uppercase tracking-wide">{activeStrategy.title}</Text>
          <Text className="text-adroom-text-muted mb-3">{activeStrategy.description}</Text>
          
          <View className="flex-row flex-wrap">
            <View className="bg-adroom-neon/10 px-3 py-1 rounded-md mr-2 mb-2 border border-adroom-neon/30">
              <Text className="text-xs text-adroom-neon">🎯 {activeStrategy.targetAudience}</Text>
            </View>
            <View className="bg-adroom-purple/10 px-3 py-1 rounded-md mr-2 mb-2 border border-adroom-purple/30">
              <Text className="text-xs text-adroom-purple">📢 {activeStrategy.brandVoice}</Text>
            </View>
            <View className="bg-adroom-card px-3 py-1 rounded-md mb-2 border border-white/20">
              <Text className="text-xs text-white">⏱️ {activeStrategy.lifespanWeeks} Weeks</Text>
            </View>
          </View>
        </View>

        {/* Creatives Section */}
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

        {/* Action Plan */}
        <View className="bg-adroom-card rounded-xl p-5 mb-4 shadow-sm border border-adroom-neon/10">
          <Text className="text-lg font-bold text-adroom-neon mb-3 uppercase tracking-wider">Execution Plan</Text>
          {activeStrategy.actions.map((action, idx) => (
            <View key={idx} className="flex-row items-center mb-2">
              <View className="w-6 h-6 rounded-full bg-green-500/20 items-center justify-center mr-3 border border-green-500/50">
                <Text className="text-green-400 text-xs">✓</Text>
              </View>
              <Text className="text-adroom-text">{action}</Text>
            </View>
          ))}
        </View>

        {/* Projections */}
        <View className="bg-adroom-card rounded-xl p-5 mb-6 shadow-sm flex-row justify-between border border-adroom-neon/20">
          <View>
            <Text className="text-xs text-adroom-text-muted uppercase font-bold">Est. Reach</Text>
            <Text className="text-lg font-bold text-white">{activeStrategy.estimatedReach}</Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-adroom-text-muted uppercase font-bold">Cost</Text>
            <Text className="text-lg font-bold text-white">{activeStrategy.cost}</Text>
          </View>
        </View>

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
