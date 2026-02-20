
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, TrendingUp, DollarSign, Clock, Target, AlertTriangle, ShieldCheck, Rocket } from 'lucide-react-native';

const { width } = Dimensions.get('window');

export default function StrategyComparisonScreen() {
  const navigation = useNavigation<any>();
  const { generatedStrategies } = useStrategyCreationStore();
  const [activeTab, setActiveTab] = useState<'free' | 'paid'>('free');

  if (!generatedStrategies) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950 items-center justify-center">
        <Text className="text-white text-lg">No strategies generated.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} className="mt-4 bg-cyan-500 px-6 py-3 rounded-lg">
          <Text className="text-black font-bold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const strategy = activeTab === 'free' ? generatedStrategies.free : generatedStrategies.paid;
  const comparison = generatedStrategies.comparison;

  const handleSelect = (type: 'free' | 'paid') => {
    Alert.alert(
      `Confirm ${type === 'free' ? 'Free' : 'Paid'} Strategy`,
      `Are you sure you want to launch the ${type} strategy? ${type === 'paid' ? 'Budget will be allocated.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Launch', 
          onPress: () => {
            // API call to activate strategy happens in Agent Chat flow now.
            // This screen is deprecated in favor of AgentChat flow but kept for direct access if needed.
            navigation.navigate('Main', { screen: 'Dashboard' });
          } 
        }
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="px-6 py-4 border-b border-slate-900 flex-row items-center justify-between">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Choose Strategy</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tabs */}
      <View className="flex-row mx-6 mt-6 bg-slate-900 rounded-xl p-1">
        <TouchableOpacity 
          onPress={() => setActiveTab('free')}
          className={`flex-1 py-3 rounded-lg items-center ${activeTab === 'free' ? 'bg-cyan-500/20' : ''}`}
        >
          <Text className={`font-bold ${activeTab === 'free' ? 'text-cyan-400' : 'text-slate-500'}`}>FREE (Organic)</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => setActiveTab('paid')}
          className={`flex-1 py-3 rounded-lg items-center ${activeTab === 'paid' ? 'bg-cyan-500/20' : ''}`}
        >
          <Text className={`font-bold ${activeTab === 'paid' ? 'text-cyan-400' : 'text-slate-500'}`}>PAID (Ads)</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-6 mt-6">
        {/* Comparison Summary */}
        <View className="bg-slate-900 rounded-xl p-4 mb-6 border border-slate-800">
          <View className="flex-row items-center mb-2">
            <Target size={20} color="#F59E0B" />
            <Text className="text-amber-500 font-bold ml-2">AI Recommendation</Text>
          </View>
          <Text className="text-slate-300 leading-6">{comparison?.recommendation || "Both strategies have strong potential."}</Text>
        </View>

        {/* Strategy Details */}
        <View className="mb-24">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-2xl font-bold text-white capitalize">{activeTab} Strategy</Text>
            <View className={`px-3 py-1 rounded-full ${activeTab === 'free' ? 'bg-green-500/20' : 'bg-purple-500/20'}`}>
              <Text className={`${activeTab === 'free' ? 'text-green-400' : 'text-purple-400'} font-bold text-xs uppercase`}>
                {activeTab === 'free' ? 'Zero Cost' : 'Accelerated'}
              </Text>
            </View>
          </View>

          {/* Stats Grid */}
          <View className="flex-row flex-wrap justify-between mb-6">
            <View className="w-[48%] bg-slate-900 p-4 rounded-xl mb-4 border border-slate-800">
              <Text className="text-slate-500 text-xs mb-1">Est. Reach</Text>
              <Text className="text-white font-bold text-lg">{strategy?.expected_outcomes?.reach || 'N/A'}</Text>
            </View>
            <View className="w-[48%] bg-slate-900 p-4 rounded-xl mb-4 border border-slate-800">
              <Text className="text-slate-500 text-xs mb-1">Est. Conversions</Text>
              <Text className="text-white font-bold text-lg">{strategy?.expected_outcomes?.conversions || 'N/A'}</Text>
            </View>
            <View className="w-[48%] bg-slate-900 p-4 rounded-xl mb-4 border border-slate-800">
              <Text className="text-slate-500 text-xs mb-1">Risk Level</Text>
              <Text className={`font-bold text-lg ${strategy?.risk === 'High' ? 'text-red-400' : 'text-green-400'}`}>
                {strategy?.risk || 'Low'}
              </Text>
            </View>
            <View className="w-[48%] bg-slate-900 p-4 rounded-xl mb-4 border border-slate-800">
              <Text className="text-slate-500 text-xs mb-1">Budget</Text>
              <Text className="text-white font-bold text-lg">{activeTab === 'free' ? '$0' : `$${strategy?.budget_recommendation || 0}`}</Text>
            </View>
          </View>

          {/* Platforms */}
          <Text className="text-white font-bold text-lg mb-3">Platforms</Text>
          <View className="flex-row flex-wrap mb-6">
            {strategy?.platforms?.map((p: string, i: number) => (
              <View key={i} className="bg-slate-800 px-4 py-2 rounded-full mr-2 mb-2">
                <Text className="text-slate-300 capitalize">{p}</Text>
              </View>
            ))}
          </View>

          {/* Content Plan */}
          <Text className="text-white font-bold text-lg mb-3">Content Plan</Text>
          <View className="bg-slate-900 rounded-xl p-4 border border-slate-800 mb-6">
            {strategy?.content_plan?.pillars?.map((pillar: any, i: number) => (
               <View key={i} className="mb-3 last:mb-0">
                 <Text className="text-cyan-400 font-bold mb-1">• {pillar.title || pillar.name}</Text>
                 <Text className="text-slate-400 text-sm">{pillar.description}</Text>
               </View>
            ))}
             {!strategy?.content_plan?.pillars && <Text className="text-slate-500">AI Generated Content Plan</Text>}
          </View>

          {/* Key Actions */}
           <Text className="text-white font-bold text-lg mb-3">Key Actions</Text>
            <View className="bg-slate-900 rounded-xl p-4 border border-slate-800 mb-6">
                {activeTab === 'free' ? (
                    <Text className="text-slate-400">
                        • Daily engagement (15 mins){'\n'}
                        • Community building in groups{'\n'}
                        • Consistent posting schedule
                    </Text>
                ) : (
                    <Text className="text-slate-400">
                        • Ad creative testing (A/B){'\n'}
                        • Audience targeting refinement{'\n'}
                        • Budget scaling based on ROAS
                    </Text>
                )}
            </View>

        </View>
      </ScrollView>

      {/* Footer */}
      <View className="absolute bottom-0 left-0 right-0 p-6 border-t border-slate-900 bg-slate-950/95">
        <TouchableOpacity 
          onPress={() => handleSelect(activeTab)}
          className={`py-4 rounded-xl flex-row justify-center items-center ${
            activeTab === 'free' ? 'bg-green-500 shadow-lg shadow-green-500/20' : 'bg-cyan-500 shadow-lg shadow-cyan-500/20'
          }`}
        >
          <Text className="text-slate-950 font-bold text-lg mr-2">
            Launch {activeTab === 'free' ? 'Free' : 'Paid'} Strategy
          </Text>
          <Rocket size={20} color="#020617" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

import { Rocket } from 'lucide-react-native';
