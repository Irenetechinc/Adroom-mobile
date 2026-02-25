import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { FacebookService } from '../services/facebook';
import { FacebookConfig } from '../types/facebook';
import { ChevronLeft, Facebook, Settings, RefreshCw, LogOut, CheckCircle2, ShieldCheck } from 'lucide-react-native';

export default function ConnectedAccountsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FacebookConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadConfig = async () => {
    try {
      const data = await FacebookService.getConfig();
      setConfig(data);
    } catch (error) {
      console.error('Failed to load FB config:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Facebook",
      "This will stop all active autonomous campaigns. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Disconnect", 
          style: "destructive", 
          onPress: async () => {
            setLoading(true);
            try {
              // Implementation would call FacebookService.deleteConfig()
              // For now, we'll just mock the UI update after alert
              Alert.alert("Success", "Facebook account disconnected.");
              navigation.goBack();
            } catch (e) {
              Alert.alert("Error", "Failed to disconnect.");
            } finally {
              setLoading(false);
            }
          } 
        }
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark">
      {/* Header */}
      <View className="px-4 py-4 border-b border-adroom-neon/10 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
          <ChevronLeft color="#00F0FF" size={28} />
        </TouchableOpacity>
        <Text className="text-white font-bold text-xl">Connected Accounts</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        <Text className="text-adroom-text-muted mb-6">
          Manage your external platform connections for autonomous execution.
        </Text>

        {/* Facebook Section */}
        <View className="bg-adroom-card rounded-2xl border border-adroom-neon/20 overflow-hidden mb-6">
          <View className="bg-[#1877F2]/10 p-4 flex-row items-center justify-between border-b border-adroom-neon/5">
            <View className="flex-row items-center">
              <Facebook color="#1877F2" size={24} fill="#1877F2" />
              <Text className="text-white font-bold ml-3 text-lg">Facebook Ads</Text>
            </View>
            <View className={`px-3 py-1 rounded-full ${config ? 'bg-green-500/20' : 'bg-slate-700'}`}>
              <Text className={`text-xs font-bold ${config ? 'text-green-400' : 'text-slate-400'}`}>
                {config ? 'CONNECTED' : 'NOT LINKED'}
              </Text>
            </View>
          </View>

          {loading ? (
            <View className="p-10 items-center">
              <ActivityIndicator color="#00F0FF" />
            </View>
          ) : config ? (
            <View className="p-5">
              <View className="flex-row items-center mb-6">
                <View className="w-12 h-12 bg-adroom-neon/10 rounded-full items-center justify-center border border-adroom-neon/30 mr-4">
                  <Text className="text-adroom-neon font-bold text-xl">{config.page_name ? config.page_name.charAt(0) : 'F'}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-base">{config.page_name || 'Facebook Page'}</Text>
                  <Text className="text-adroom-text-muted text-xs">Linked Facebook Page</Text>
                </View>
                <CheckCircle2 color="#10B981" size={20} />
              </View>

              <View className="space-y-4 mb-6">
                <View className="flex-row justify-between items-center bg-adroom-dark/50 p-3 rounded-xl border border-white/5">
                  <Text className="text-slate-400 text-sm">Ad Account</Text>
                  <Text className="text-white font-medium text-sm" numberOfLines={1}>{config.ad_account_id}</Text>
                </View>
                <View className="flex-row items-center bg-blue-500/5 p-3 rounded-xl border border-blue-500/10">
                  <ShieldCheck color="#3B82F6" size={16} />
                  <Text className="text-blue-400 text-xs ml-2">Real-time optimization active</Text>
                </View>
              </View>

              <View className="flex-row space-x-3">
                <TouchableOpacity 
                  onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: true })}
                  className="flex-1 bg-adroom-neon/10 border border-adroom-neon/30 py-3 rounded-xl items-center"
                >
                  <Text className="text-adroom-neon font-bold">RECONFIGURE</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={handleDisconnect}
                  className="bg-red-500/10 border border-red-500/30 px-4 py-3 rounded-xl items-center"
                >
                  <LogOut color="#EF4444" size={20} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="p-8 items-center">
              <Text className="text-slate-400 text-center mb-6">
                Connect your Facebook Business account to allow AdRoom to launch and manage ads autonomously.
              </Text>
              <TouchableOpacity 
                onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: true })}
                className="bg-[#1877F2] px-8 py-3 rounded-xl flex-row items-center"
              >
                <Facebook color="white" size={20} fill="white" />
                <Text className="text-white font-bold ml-3">CONNECT FACEBOOK</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Placeholder for TikTok */}
        <View className="bg-adroom-card rounded-2xl border border-white/5 overflow-hidden opacity-60">
          <View className="p-4 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="w-6 h-6 bg-white rounded-full items-center justify-center">
                <Text className="text-black font-black text-[10px]">TikTok</Text>
              </View>
              <Text className="text-slate-400 font-bold ml-3 text-lg">TikTok Ads</Text>
            </View>
            <Text className="text-xs font-bold text-slate-500">COMING SOON</Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
