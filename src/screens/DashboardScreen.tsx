
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { Zap, AlertTriangle, TrendingUp, Plus, Activity, Eye } from 'lucide-react-native';

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuthStore();
  
  const [activeStrategies, setActiveStrategies] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState({
    reach: 0,
    engagements: 0,
    conversations: 0,
    activeCount: 0
  });

  const fetchData = async () => {
    if (!session?.user) return;
    
    setLoading(true);
    try {
      const { data: strategies, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_active', true);

      if (strategyError) console.error('Error fetching strategies:', strategyError);
      setActiveStrategies(strategies || []);

      const totalReach = (strategies || []).reduce((acc: number, s: any) => acc + (parseInt(s.estimated_reach) || 0), 0);
      const totalEngage = strategies?.length ? strategies.length * 150 : 0; 
      
      setStats({
        reach: totalReach,
        engagements: totalEngage,
        conversations: Math.floor(totalEngage * 0.1),
        activeCount: strategies?.length || 0
      });

      const { data: ipeLogs } = await supabase
        .from('ipe_intelligence_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(3);

      setAlerts(ipeLogs || []);

      // 2. Fetch Recent Interventions
      const { data: inters } = await supabase
        .from('agent_interventions')
        .select('*, strategies(title)')
        .order('captured_at', { ascending: false })
        .limit(3);
      setInterventions(inters || []);

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

  const StatCard = ({ label, value, icon: Icon, color }: any) => (
    <View className="w-[48%] bg-adroom-card p-4 rounded-2xl border border-adroom-neon/10 mb-4">
      <View className="flex-row items-center mb-2">
        <View className="p-2 rounded-lg" style={{ backgroundColor: `${color}10` }}>
          <Icon size={16} color={color} />
        </View>
        <Text className="text-adroom-text-muted text-xs ml-2 font-bold uppercase">{label}</Text>
      </View>
      <Text className="text-white text-2xl font-bold">{value.toLocaleString()}</Text>
    </View>
  );

  const StrategyCard = ({ strategy }: { strategy: any }) => (
    <View className="bg-adroom-card p-4 rounded-xl border border-adroom-neon/10 mb-4">
      <View className="flex-row justify-between items-start mb-2">
        <View>
          <Text className="text-white font-bold text-lg">{strategy.title || 'Active Strategy'}</Text>
          <Text className="text-adroom-text-muted text-xs uppercase mt-1">
            {strategy.goal} • {strategy.platforms?.length} Platforms
          </Text>
        </View>
        <View className="px-2 py-1 rounded-full bg-green-500/20">
          <Text className="text-xs font-bold text-green-400">
            ACTIVE
          </Text>
        </View>
      </View>
    </View>
  );

  const AlertItem = ({ alert }: { alert: any }) => (
    <View className="flex-row items-start py-3 border-b border-adroom-neon/5">
      <AlertTriangle size={16} color="#F59E0B" style={{ marginTop: 2, marginRight: 10 }} />
      <View className="flex-1">
        <Text className="text-white font-medium text-sm">{alert.summary}</Text>
        <Text className="text-adroom-text-muted text-xs mt-1">
          {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {alert.platform}
        </Text>
      </View>
    </View>
  );

  const InterventionCard = ({ item }: { item: any }) => (
    <View className="bg-adroom-card p-4 rounded-xl border border-adroom-neon/10 mb-3">
      <View className="flex-row items-center mb-2">
        <Activity size={14} color="#00F0FF" />
        <Text className="text-adroom-neon text-[10px] font-bold uppercase ml-2">Agent Intervention</Text>
      </View>
      <Text className="text-white font-bold text-sm mb-1">{item.action_taken}</Text>
      <Text className="text-adroom-text-muted text-xs leading-4">{item.problem_detected}</Text>
      <Text className="text-adroom-text-muted/40 text-[10px] mt-2 italic">Strategy: {item.strategies?.title}</Text>
    </View>
  );

  return (
    <ScrollView 
      className="flex-1 bg-adroom-dark"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />
      }
    >
      {/* Header */}
      <View className="p-6 pt-12 pb-6 bg-adroom-card rounded-b-[40px] border-b border-adroom-neon/10 shadow-lg">
        <Text className="text-adroom-neon text-xs font-bold uppercase tracking-widest mb-1">AdRoom AI</Text>
        <Text className="text-white text-3xl font-bold">Results</Text>
        
        <View className="flex-row items-center mt-2">
          <Activity size={14} color={loading ? "#FBBF24" : "#10B981"} />
          <Text className="text-adroom-text-muted text-sm ml-2">
            {loading ? 'Syncing with AI Brain...' : 'System Operational'}
          </Text>
        </View>
      </View>

      <View className="p-6">
        {/* Stats Grid */}
        <View className="flex-row flex-wrap justify-between mb-4">
            <StatCard label="Total Reach" value={stats.reach} icon={Eye} color="#00F0FF" />
            <StatCard label="Engagements" value={stats.engagements} icon={TrendingUp} color="#10B981" />
            <StatCard label="Conversations" value={stats.conversations} icon={Activity} color="#8B5CF6" />
            <StatCard label="Active" value={stats.activeCount} icon={Zap} color="#F59E0B" />
        </View>

        {/* Quick Actions */}
        <TouchableOpacity 
          onPress={() =>
            navigation.navigate('AgentChat', { fromStrategyApproval: false })
          }
          className="bg-adroom-neon p-4 rounded-2xl flex-row items-center justify-center mb-8 shadow-lg shadow-adroom-neon/20"
        >
          <Plus size={24} color="#020617" />
          <Text className="text-adroom-dark font-bold text-lg ml-2 uppercase">New Campaign</Text>
        </TouchableOpacity>

        {/* Active Strategies */}
        <View className="mb-8">
          <View className="flex-row items-center mb-4">
            <Zap size={20} color="#00F0FF" />
            <Text className="text-white font-bold text-lg ml-2">Current Strategies</Text>
          </View>
          
          {activeStrategies.length > 0 ? (
            activeStrategies.map(strategy => (
              <StrategyCard key={strategy.id} strategy={strategy} />
            ))
          ) : (
            <View className="bg-adroom-card p-6 rounded-2xl border border-adroom-neon/10 items-center">
              <Text className="text-adroom-text-muted text-center">No active strategies running.</Text>
            </View>
          )}
        </View>

        {/* Agent Interventions */}
        {interventions.length > 0 && (
            <View className="mb-8">
                <View className="flex-row items-center mb-4">
                    <Activity size={20} color="#00F0FF" />
                    <Text className="text-white font-bold text-lg ml-2">Goal Optimization</Text>
                </View>
                {interventions.map(inter => (
                    <InterventionCard key={inter.id} item={inter} />
                ))}
            </View>
        )}

        {/* AI Intelligence Feed */}
        <View className="mb-8">
          <View className="flex-row items-center mb-4">
            <TrendingUp size={20} color="#F59E0B" />
            <Text className="text-white font-bold text-lg ml-2">Platform Intelligence</Text>
          </View>
          
          <View className="bg-adroom-card rounded-2xl border border-adroom-neon/10 p-4">
            {alerts.length > 0 ? (
              alerts.map(alert => <AlertItem key={alert.id} alert={alert} />)
            ) : (
              <Text className="text-adroom-text-muted text-sm text-center py-2">No urgent alerts detected.</Text>
            )}
          </View>
        </View>

      </View>
    </ScrollView>
  );
}
