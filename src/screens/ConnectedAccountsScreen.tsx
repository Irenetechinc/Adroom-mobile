import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, Facebook, LogOut, Instagram, Linkedin, Twitter, Video } from 'lucide-react-native';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';

export default function ConnectedAccountsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configs, setConfigs] = useState<Record<string, any>>({});

  const loadConfigs = useCallback(async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setConfigs({});
        return;
      }

      const { data, error } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      
      const configMap: Record<string, any> = {};
      data?.forEach(c => {
          configMap[c.platform || 'facebook'] = c;
      });
      setConfigs(configMap);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleConnect = (platform: string) => {
    const routeParams: any = {};
    if (platform === 'facebook') routeParams.connectFacebook = true;
    if (platform === 'instagram') routeParams.connectInstagram = true;
    if (platform === 'tiktok') routeParams.connectTikTok = true;
    if (platform === 'linkedin') routeParams.connectLinkedIn = true;
    if (platform === 'twitter') routeParams.connectTwitter = true;
    
    navigation.navigate('AgentChat', routeParams);
  };

  const handleDisconnect = (platform: string) => {
    Alert.alert(
      `Disconnect ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      `This will stop publishing and engagement automation for this ${platform === 'facebook' ? 'Page' : 'Account'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { data: { user }, error: userError } = await supabase.auth.getUser();
              if (userError) throw userError;
              if (!user) return;
              const { error } = await supabase.from('ad_configs').delete().match({ user_id: user.id, platform: platform });
              if (error) throw error;
              await loadConfigs();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to disconnect.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const PlatformCard = ({ platform, icon: Icon, color, label }: any) => {
    const config = configs[platform];
    return (
      <View className="bg-adroom-card rounded-2xl border border-adroom-neon/20 overflow-hidden mb-6">
        <View className="p-4 flex-row items-center justify-between border-b border-adroom-neon/5" style={{ backgroundColor: `${color}10` }}>
          <View className="flex-row items-center">
            <Icon color={color} size={24} fill={color} />
            <Text className="text-white font-bold ml-3 text-lg">{label}</Text>
          </View>
          <View className={`px-3 py-1 rounded-full ${config ? 'bg-green-500/20' : 'bg-slate-700'}`}>
            <Text className={`text-xs font-bold ${config ? 'text-green-400' : 'text-slate-400'}`}>
              {config ? 'CONNECTED' : 'NOT LINKED'}
            </Text>
          </View>
        </View>

        {config ? (
          <View className="p-5">
            <Text className="text-white font-bold text-base">{config.page_name || `${label} Account`}</Text>
            <Text className="text-adroom-text-muted text-xs mt-1">ID: {config.page_id || config.ad_account_id}</Text>
            <TouchableOpacity
              onPress={() => handleDisconnect(platform)}
              className="mt-5 bg-red-500/10 border border-red-500/30 px-4 py-3 rounded-xl items-center flex-row justify-center"
            >
              <LogOut color="#EF4444" size={16} />
              <Text className="text-red-400 font-bold ml-2">Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="p-5 items-center">
            <TouchableOpacity
              onPress={() => handleConnect(platform)}
              className="w-full py-3 rounded-xl flex-row items-center justify-center"
              style={{ backgroundColor: color }}
              disabled={refreshing}
            >
              <Text className="text-white font-bold">CONNECT {platform.toUpperCase()}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark">
      <View className="px-4 py-4 border-b border-adroom-neon/10 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
          <ChevronLeft color="#00F0FF" size={28} />
        </TouchableOpacity>
        <Text className="text-white font-bold text-xl">Connected Accounts</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        {loading ? (
          <View className="mt-12 items-center">
            <ActivityIndicator size="large" color="#00F0FF" />
          </View>
        ) : (
          <>
            <PlatformCard platform="facebook" icon={Facebook} color="#1877F2" label="Facebook Page" />
            <PlatformCard platform="instagram" icon={Instagram} color="#E4405F" label="Instagram Account" />
            <PlatformCard platform="tiktok" icon={Video} color="#000000" label="TikTok Account" />
            <PlatformCard platform="linkedin" icon={Linkedin} color="#0A66C2" label="LinkedIn Page" />
            <PlatformCard platform="twitter" icon={Twitter} color="#1DA1F2" label="X (Twitter) Account" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
