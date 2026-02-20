
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Clock, Zap, Calendar, TrendingUp } from 'lucide-react-native';
import { ProductService } from '../../services/product';
import { StrategyService } from '../../services/strategy';

const DURATIONS = [
  { days: 7, label: '7 Days', description: 'Quick test. Best for flash sales or validating a new idea.', icon: Zap, color: '#F59E0B' },
  { days: 14, label: '14 Days', description: 'Standard duration. Good balance of data gathering and results.', icon: Calendar, color: '#3B82F6' },
  { days: 30, label: '30 Days', description: 'Comprehensive campaign. Allows for full optimization and scaling.', icon: TrendingUp, color: '#10B981' },
];

export default function DurationSelectionScreen() {
  const navigation = useNavigation<any>();
  const { productData, selectedGoal, selectedDuration, setSelectedDuration, setGeneratedStrategies } = useStrategyCreationStore();
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const handleGenerate = async () => {
    if (!selectedDuration) {
      Alert.alert('Selection Required', 'Please select a campaign duration.');
      return;
    }

    setLoading(true);
    setLoadingMessage('Saving product details...');

    try {
      // 1. Save Product
      const productId = await ProductService.saveProduct(productData);

      // 2. Generate Strategy
      setLoadingMessage('AI Brain is generating your strategies...');
      const strategies = await StrategyService.generateStrategies(productId, selectedGoal!, selectedDuration);
      
      setGeneratedStrategies(strategies);
      
      // 3. Navigate
      navigation.navigate('StrategyWizard_Comparison');
      
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate strategy. Please try again.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="px-6 py-4 border-b border-slate-900 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Step 3: Duration</Text>
      </View>

      <ScrollView className="flex-1 px-6 py-4">
        <Text className="text-slate-400 mb-6">How long should this campaign run?</Text>
        
        <View className="space-y-4">
          {DURATIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = selectedDuration === option.days;
            
            return (
              <TouchableOpacity
                key={option.days}
                onPress={() => setSelectedDuration(option.days)}
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
                    {option.label}
                  </Text>
                  <Text className="text-slate-500 text-sm mt-1">{option.description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom Duration Input could go here */}
      </ScrollView>

      {/* Loading Overlay */}
      {loading && (
        <View className="absolute inset-0 bg-slate-950/90 items-center justify-center z-50">
          <ActivityIndicator size="large" color="#00F0FF" />
          <Text className="text-white text-lg font-bold mt-6 text-center px-8">{loadingMessage}</Text>
          <Text className="text-slate-400 text-sm mt-2">Analyzing market data & trends...</Text>
        </View>
      )}

      {/* Footer */}
      <View className="p-6 border-t border-slate-900 bg-slate-950">
        <TouchableOpacity 
          onPress={handleGenerate}
          disabled={!selectedDuration || loading}
          className={`py-4 rounded-xl flex-row justify-center items-center ${
            selectedDuration ? 'bg-cyan-500 shadow-lg shadow-cyan-500/20' : 'bg-slate-800'
          }`}
        >
          {loading ? (
             <Text className="font-bold text-lg text-slate-950">Processing...</Text>
          ) : (
            <>
              <Text className={`font-bold text-lg mr-2 ${selectedDuration ? 'text-slate-950' : 'text-slate-500'}`}>
                Generate Strategies
              </Text>
              <Zap size={20} color={selectedDuration ? '#020617' : '#64748B'} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
