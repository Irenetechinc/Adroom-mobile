import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Image, Dimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import { Strategy, CreativeAsset } from '../types/agent';
import { AutonomousService } from '../services/autonomous';

type Props = NativeStackScreenProps<RootStackParamList, 'StrategyApprovalScreen'>;

const { width } = Dimensions.get('window');

export default function StrategyApprovalScreen({ navigation }: Props) {
  const { generatedStrategies, resetAgent, setActiveStrategy } = useAgentStore();
  const [selectedTab, setSelectedTab] = useState<'FREE' | 'PAID'>('PAID');

  const activeStrategy = generatedStrategies.find(s => s.type === selectedTab) || generatedStrategies[0];

  const handleApprove = async () => {
    if (!activeStrategy) return;

    Alert.alert(
      'Activate Strategy',
      `Confirm activation of ${activeStrategy.title}. This will start the ${activeStrategy.type.toLowerCase()} campaign immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Approve & Start', 
          onPress: async () => {
            try {
              // 1. Set as Active Strategy in Store (Persist)
              setActiveStrategy(activeStrategy);

              // 2. Execute Immediate Actions (e.g. Create Campaign)
              // Pass the first generated asset image as the product image
              const productImage = activeStrategy.assets[0]?.url;
              await AutonomousService.executeStrategy(activeStrategy, productImage);
              
              // 3. Reset Chat State but keep Active Strategy
              resetAgent();
              
              navigation.navigate('Main');
              Alert.alert('Success', 'Strategy activated successfully. AdRoom is now running autonomously.');
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          }
        }
      ]
    );
  };

  if (!activeStrategy) return <View className="flex-1 bg-white" />;

  return (
    <View className="flex-1 bg-gray-50">
      <View className="bg-white px-4 py-3 flex-row justify-center border-b border-gray-200">
        <TouchableOpacity 
          onPress={() => setSelectedTab('FREE')}
          className={`px-6 py-2 rounded-l-lg border border-blue-800 ${selectedTab === 'FREE' ? 'bg-blue-800' : 'bg-white'}`}
        >
          <Text className={`${selectedTab === 'FREE' ? 'text-white' : 'text-blue-800'} font-bold`}>Free Strategy</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => setSelectedTab('PAID')}
          className={`px-6 py-2 rounded-r-lg border border-blue-800 ${selectedTab === 'PAID' ? 'bg-blue-800' : 'bg-white'}`}
        >
          <Text className={`${selectedTab === 'PAID' ? 'text-white' : 'text-blue-800'} font-bold`}>Paid Strategy</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 p-4">
        {/* Header Section */}
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm">
          <Text className="text-2xl font-bold text-gray-900 mb-1">{activeStrategy.title}</Text>
          <Text className="text-gray-500 mb-3">{activeStrategy.description}</Text>
          
          <View className="flex-row flex-wrap">
            <View className="bg-gray-100 px-3 py-1 rounded-md mr-2 mb-2">
              <Text className="text-xs text-gray-600">🎯 {activeStrategy.targetAudience}</Text>
            </View>
            <View className="bg-gray-100 px-3 py-1 rounded-md mr-2 mb-2">
              <Text className="text-xs text-gray-600">📢 {activeStrategy.brandVoice}</Text>
            </View>
            <View className="bg-gray-100 px-3 py-1 rounded-md mb-2">
              <Text className="text-xs text-gray-600">⏱️ {activeStrategy.lifespanWeeks} Weeks</Text>
            </View>
          </View>
        </View>

        {/* Creatives Section */}
        <View className="mb-4">
          <Text className="text-lg font-bold text-gray-800 mb-3">Generated Creatives & Assets</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {activeStrategy.assets.map((asset: CreativeAsset) => (
              <View key={asset.id} className="mr-4 bg-white rounded-xl overflow-hidden shadow-sm w-64">
                <Image source={{ uri: asset.url }} className="w-full h-40" resizeMode="cover" />
                <View className="p-3">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {asset.type}
                    </Text>
                    <Text className="text-xs text-gray-400 uppercase">{asset.purpose}</Text>
                  </View>
                  <Text className="text-xs text-gray-500 italic" numberOfLines={2}>
                    Prompt: "{asset.prompt}"
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Action Plan */}
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm">
          <Text className="text-lg font-bold text-gray-800 mb-3">Execution Plan</Text>
          {activeStrategy.actions.map((action, idx) => (
            <View key={idx} className="flex-row items-center mb-2">
              <View className="w-6 h-6 rounded-full bg-green-100 items-center justify-center mr-3">
                <Text className="text-green-600 text-xs">✓</Text>
              </View>
              <Text className="text-gray-700">{action}</Text>
            </View>
          ))}
        </View>

        {/* Projections */}
        <View className="bg-white rounded-xl p-5 mb-6 shadow-sm flex-row justify-between">
          <View>
            <Text className="text-xs text-gray-400 uppercase font-bold">Est. Reach</Text>
            <Text className="text-lg font-bold text-gray-900">{activeStrategy.estimatedReach}</Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-gray-400 uppercase font-bold">Cost</Text>
            <Text className="text-lg font-bold text-gray-900">{activeStrategy.cost}</Text>
          </View>
        </View>

        <TouchableOpacity 
          onPress={handleApprove}
          className="w-full bg-blue-800 py-4 rounded-xl items-center shadow-md mb-8"
        >
          <Text className="text-white font-bold text-lg">Approve & Launch Strategy</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
