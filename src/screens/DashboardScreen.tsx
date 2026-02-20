
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { Zap, AlertTriangle, TrendingUp, Plus, Activity } from 'lucide-react-native';

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuthStore();
  
  const [activeStrategies, setActiveStrategies] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!session?.user) return;
    
    setLoading(true);
    try {
      // 1. Fetch Active Strategies
      const { data: strategies, error: strategyError } = await supabase
        .from('strategy_memory')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (strategyError) console.error('Error fetching strategies:', strategyError);
      setActiveStrategies(strategies || []);

      // 2. Fetch Recent IPE Alerts
      // We assume IPE logs are global or filtered by user relevance in a real app
      // For now, let's fetch high priority logs
      const { data: ipeLogs, error: ipeError } = await supabase
        .from('ipe_intelligence_log')
        .select('*')
        .gte('priority', 1) // Priority 1 & 2
        .order('timestamp', { ascending: false })
        .limit(5);

      if (ipeError) console.error('Error fetching IPE logs:', ipeError);
      setAlerts(ipeLogs || []);

    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [session]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const StrategyCard = ({ strategy }: { strategy: any }) => (
    <View className="bg-slate-900 p-4 rounded-xl border border-slate-800 mb-4">
      <View className="flex-row justify-between items-start mb-2">
        <View>
          <Text className="text-white font-bold text-lg">{strategy.strategy_name}</Text>
          <Text className="text-slate-400 text-xs uppercase mt-1">
            {strategy.goal} • {strategy.strategy_version}
          </Text>
        </View>
        <View className={`px-2 py-1 rounded-full ${strategy.strategy_version === 'paid' ? 'bg-purple-500/20' : 'bg-green-500/20'}`}>
          <Text className={`text-xs font-bold ${strategy.strategy_version === 'paid' ? 'text-purple-400' : 'text-green-400'}`}>
            {strategy.strategy_version.toUpperCase()}
          </Text>
        </View>
      </View>
      
      {/* Mini Stats */}
      <View className="flex-row mt-3 pt-3 border-t border-slate-800">
        <View className="flex-1">
          <Text className="text-slate-500 text-xs">Reach</Text>
          <Text className="text-white font-bold">{strategy.total_impressions || 0}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-slate-500 text-xs">Clicks</Text>
          <Text className="text-white font-bold">{strategy.total_clicks || 0}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-slate-500 text-xs">Conv.</Text>
          <Text className="text-white font-bold">{strategy.total_conversions || 0}</Text>
        </View>
      </View>
    </View>
  );

  const AlertItem = ({ alert }: { alert: any }) => (
    <View className="flex-row items-start py-3 border-b border-slate-800">
      <AlertTriangle size={16} color="#F59E0B" style={{ marginTop: 2, marginRight: 10 }} />
      <View className="flex-1">
        <Text className="text-white font-medium text-sm">{alert.summary}</Text>
        <Text className="text-slate-500 text-xs mt-1">
          {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {alert.platform}
        </Text>
      </View>
    </View>
  );

  return (
    <ScrollView 
      className="flex-1 bg-slate-950"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />
      }
    >
      {/* Header */}
      <View className="p-6 pt-12 pb-6 bg-slate-900 rounded-b-3xl border-b border-slate-800 shadow-lg">
        <Text className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">AdRoom AI</Text>
        <Text className="text-white text-3xl font-bold">Dashboard</Text>
        
        <View className="flex-row items-center mt-2">
          <Activity size={14} color={loading ? "#FBBF24" : "#10B981"} />
          <Text className="text-slate-400 text-sm ml-2">
            {loading ? 'Syncing with AI Brain...' : 'System Operational'}
          </Text>
        </View>
      </View>

      <View className="p-6">
        {/* Quick Actions */}
        <TouchableOpacity 
          onPress={() => navigation.navigate('AgentChat')}
          className="bg-cyan-500 p-4 rounded-xl flex-row items-center justify-center mb-8 shadow-lg shadow-cyan-500/20"
        >
          <Plus size={24} color="#020617" />
          <Text className="text-slate-950 font-bold text-lg ml-2">Create New Strategy</Text>
        </TouchableOpacity>

        {/* Active Strategies */}
        <View className="mb-8">
          <View className="flex-row items-center mb-4">
            <Zap size={20} color="#00F0FF" />
            <Text className="text-white font-bold text-lg ml-2">Active Strategies</Text>
          </View>
          
          {activeStrategies.length > 0 ? (
            activeStrategies.map(strategy => (
              <StrategyCard key={strategy.strategy_id} strategy={strategy} />
            ))
          ) : (
            <View className="bg-slate-900 p-6 rounded-xl border border-slate-800 items-center">
              <Text className="text-slate-400 text-center">No active strategies running.</Text>
              <Text className="text-slate-600 text-sm text-center mt-1">Create one to get started!</Text>
            </View>
          )}
        </View>

        {/* AI Intelligence Feed */}
        <View className="mb-8">
          <View className="flex-row items-center mb-4">
            <TrendingUp size={20} color="#F59E0B" />
            <Text className="text-white font-bold text-lg ml-2">Platform Intelligence</Text>
          </View>
          
          <View className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            {alerts.length > 0 ? (
              alerts.map(alert => <AlertItem key={alert.id} alert={alert} />)
            ) : (
              <Text className="text-slate-500 text-sm text-center py-2">No urgent alerts detected.</Text>
            )}
          </View>
        </View>

      </View>
    </ScrollView>
  );
}
