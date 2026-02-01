import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { AnalyticsService } from '../services/analytics';
import { OptimizationService } from '../services/optimization';
import { InsightMetrics, OptimizationAction } from '../types/analytics';
import { useSettingsStore } from '../store/settingsStore';

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { facebookConfig } = useSettingsStore();
  
  const [metrics, setMetrics] = useState<InsightMetrics | null>(null);
  const [actions, setActions] = useState<OptimizationAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [botStatus, setBotStatus] = useState('Idle');

  const fetchData = async () => {
    if (!facebookConfig) return;
    
    setLoading(true);
    setBotStatus('Gathering Insights...');
    try {
      // 1. Get Account Metrics
      const data = await AnalyticsService.getAccountInsights();
      setMetrics(data);

      // 2. Run Optimization Loop (Simulated for dashboard view)
      setBotStatus('Analyzing Performance...');
      const optActions = await OptimizationService.runOptimizationLoop();
      setActions(optActions);
      
      setBotStatus('Monitoring Active Campaigns');
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      setBotStatus('Error Connecting');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [facebookConfig]);

  const MetricCard = ({ title, value, subtext }: { title: string, value: string, subtext?: string }) => (
    <View className="bg-adroom-card p-4 rounded-xl border border-adroom-neon/20 flex-1 m-1 shadow-sm">
      <Text className="text-adroom-neon text-xs uppercase font-bold mb-1">{title}</Text>
      <Text className="text-2xl font-bold text-white">{value}</Text>
      {subtext && <Text className="text-adroom-text-muted text-xs mt-1">{subtext}</Text>}
    </View>
  );

  const ActionItem = ({ action }: { action: OptimizationAction }) => (
    <View className="flex-row items-center py-3 border-b border-adroom-neon/10">
      <View className="w-2 h-2 rounded-full bg-adroom-purple mr-3" />
      <View className="flex-1">
        <Text className="text-adroom-text text-sm font-medium">
          {action.type.replace('_', ' ')}
        </Text>
        <Text className="text-adroom-text-muted text-xs">{action.reason}</Text>
      </View>
      <Text className="text-adroom-text-muted text-xs">
        {new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );

  if (!facebookConfig) {
    return (
      <View className="flex-1 items-center justify-center bg-adroom-dark p-6">
        <Text className="text-xl font-bold text-white mb-2 uppercase tracking-wider">Welcome to AdRoom</Text>
        <Text className="text-adroom-text-muted text-center mb-6">
          Connect your Facebook account to start autonomous marketing.
        </Text>
        <TouchableOpacity 
          onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: true })}
          className="bg-adroom-neon px-6 py-3 rounded-lg"
        >
          <Text className="text-adroom-dark font-bold uppercase">Connect Facebook</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView 
      className="flex-1 bg-adroom-dark"
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={fetchData} tintColor="#00F0FF" />
      }
    >
      {/* Header / Status */}
      <View className="bg-adroom-card p-6 pt-12 pb-8 rounded-b-3xl shadow-lg shadow-adroom-neon/10 border-b border-adroom-neon/20">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-white text-2xl font-bold tracking-widest">AdRoom <Text className="text-adroom-neon">AI</Text></Text>
          <View className="bg-adroom-neon/10 px-3 py-1 rounded-full border border-adroom-neon/50">
            <Text className="text-adroom-neon text-xs font-bold uppercase tracking-wider">
              Autonomous
            </Text>
          </View>
        </View>
        
        <View className="flex-row items-center">
          <View className={`w-3 h-3 rounded-full mr-2 ${loading ? 'bg-yellow-400' : 'bg-green-400'} animate-pulse`} />
          <Text className="text-adroom-text font-medium">{botStatus}</Text>
        </View>
      </View>

      <View className="px-4 -mt-6">
        {/* Quick Actions */}
        <View className="flex-row mb-4">
          <TouchableOpacity 
            onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: false })}
            className="flex-1 bg-adroom-card p-4 rounded-xl shadow-sm mr-2 flex-row items-center justify-center border border-adroom-neon/50"
          >
            <Text className="text-adroom-neon font-bold mr-2 text-lg">+</Text>
            <Text className="text-white font-bold uppercase tracking-wide">New Campaign</Text>
          </TouchableOpacity>
        </View>

        {/* Metrics Grid */}
        <View className="flex-row mb-2">
          <MetricCard 
            title="Total Spend" 
            value={metrics ? `$${metrics.spend.toFixed(2)}` : '$0.00'} 
          />
          <MetricCard 
            title="Conversions" 
            value={metrics ? metrics.conversions.toString() : '0'} 
          />
        </View>
        <View className="flex-row mb-6">
          <MetricCard 
            title="Impressions" 
            value={metrics ? metrics.impressions.toLocaleString() : '0'} 
          />
          <MetricCard 
            title="CTR" 
            value={metrics ? `${(metrics.ctr).toFixed(2)}%` : '0.00%'} 
            subtext={metrics ? `$${metrics.cpc.toFixed(2)} CPC` : '$0.00 CPC'}
          />
        </View>

        {/* Recent Actions / Optimization Log */}
        <View className="bg-adroom-card p-5 rounded-xl shadow-sm border border-adroom-neon/10 mb-6">
          <Text className="text-white font-bold text-lg mb-4 uppercase tracking-wide">Autonomous Actions</Text>
          {actions.length > 0 ? (
            actions.map(action => <ActionItem key={action.id} action={action} />)
          ) : (
            <View className="py-4 items-center">
              <Text className="text-adroom-text-muted text-sm">No optimization actions taken yet.</Text>
              <Text className="text-adroom-text-muted/50 text-xs mt-1">AI is monitoring performance...</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
