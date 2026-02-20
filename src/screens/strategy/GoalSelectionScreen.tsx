
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, DollarSign, Eye, Tag, Rocket, MapPin, RefreshCw, Users } from 'lucide-react-native';

const GOALS = [
  { id: 'sales', name: 'Sales & Conversions', icon: DollarSign, description: 'Drive direct purchases of your product.', color: '#10B981' },
  { id: 'awareness', name: 'Brand Awareness', icon: Eye, description: 'Get maximum visibility for your product.', color: '#3B82F6' },
  { id: 'promotional', name: 'Promotional Offer', icon: Tag, description: 'Promote a special offer or discount.', color: '#F59E0B' },
  { id: 'launch', name: 'Product Launch', icon: Rocket, description: 'Launch a new product to market.', color: '#8B5CF6' },
  { id: 'local', name: 'Local Traffic', icon: MapPin, description: 'Target customers in specific locations.', color: '#EF4444' },
  { id: 'retargeting', name: 'Retargeting', icon: RefreshCw, description: 'Re-engage people who showed interest.', color: '#EC4899' },
  { id: 'leads', name: 'Lead Generation', icon: Users, description: 'Collect emails or signups.', color: '#06B6D4' },
];

export default function GoalSelectionScreen() {
  const navigation = useNavigation<any>();
  const { selectedGoal, setSelectedGoal } = useStrategyCreationStore();

  const handleNext = () => {
    if (!selectedGoal) {
      Alert.alert('Selection Required', 'Please select a goal for your campaign.');
      return;
    }
    navigation.navigate('StrategyWizard_DurationSelection');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="px-6 py-4 border-b border-slate-900 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Step 2: Select Goal</Text>
      </View>

      <ScrollView className="flex-1 px-6 py-4">
        <Text className="text-slate-400 mb-6">What is the primary objective for this campaign?</Text>
        
        <View className="space-y-4">
          {GOALS.map((goal) => {
            const Icon = goal.icon;
            const isSelected = selectedGoal === goal.id;
            
            return (
              <TouchableOpacity
                key={goal.id}
                onPress={() => setSelectedGoal(goal.id)}
                className={`p-4 rounded-xl border-2 flex-row items-center ${
                  isSelected 
                    ? 'bg-slate-900 border-cyan-500 shadow-lg shadow-cyan-500/10' 
                    : 'bg-slate-900/50 border-slate-800'
                }`}
              >
                <View className={`w-12 h-12 rounded-full items-center justify-center mr-4 bg-slate-800`}>
                  <Icon size={24} color={isSelected ? '#00F0FF' : '#94A3B8'} />
                </View>
                <View className="flex-1">
                  <Text className={`font-bold text-lg ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                    {goal.name}
                  </Text>
                  <Text className="text-slate-500 text-sm mt-1">{goal.description}</Text>
                </View>
                {isSelected && (
                  <View className="w-6 h-6 rounded-full bg-cyan-500 items-center justify-center ml-2">
                    <ArrowRight size={14} color="#000" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        <View className="h-8" /> 
      </ScrollView>

      {/* Footer */}
      <View className="p-6 border-t border-slate-900 bg-slate-950">
        <TouchableOpacity 
          onPress={handleNext}
          disabled={!selectedGoal}
          className={`py-4 rounded-xl flex-row justify-center items-center ${
            selectedGoal ? 'bg-cyan-500 shadow-lg shadow-cyan-500/20' : 'bg-slate-800'
          }`}
        >
          <Text className={`font-bold text-lg mr-2 ${selectedGoal ? 'text-slate-950' : 'text-slate-500'}`}>
            Continue to Duration
          </Text>
          <ArrowRight size={20} color={selectedGoal ? '#020617' : '#64748B'} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
