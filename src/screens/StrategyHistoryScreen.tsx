import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Play, Clock, CheckCircle, Image as ImageIcon, Video } from 'lucide-react-native';
import { supabase } from '../services/supabase';
import { Strategy } from '../types/agent';

interface StrategyHistoryItem {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  type: 'FREE' | 'PAID';
  assets: any[]; // JSONB
}

export default function StrategyHistoryScreen() {
  const navigation = useNavigation();
  const [history, setHistory] = useState<StrategyHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setHistory(data as any);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const renderAssetPreview = (assets: any[]) => {
    if (!assets || assets.length === 0) return null;
    return (
      <View className="flex-row mt-3 space-x-2">
        {assets.map((asset, idx) => (
          <View key={idx} className="relative">
            <Image 
              source={{ uri: asset.url }} 
              className="w-16 h-16 rounded-lg border border-adroom-neon/20"
            />
            <View className="absolute bottom-0 right-0 bg-black/60 p-1 rounded-tl-md">
                {asset.type === 'VIDEO' ? <Video size={10} color="white" /> : <ImageIcon size={10} color="white" />}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderItem = ({ item }: { item: StrategyHistoryItem }) => (
    <View className="bg-adroom-card p-5 rounded-xl mb-4 border border-adroom-neon/10">
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-white font-bold text-lg mb-1">{item.title}</Text>
          <Text className="text-adroom-text-muted text-xs mb-2">{item.description}</Text>
          
          <View className="flex-row items-center space-x-3">
             <View className={`px-2 py-1 rounded-md ${item.type === 'PAID' ? 'bg-purple-500/20' : 'bg-green-500/20'}`}>
                <Text className={`text-xs font-bold ${item.type === 'PAID' ? 'text-purple-400' : 'text-green-400'}`}>
                    {item.type}
                </Text>
             </View>
             <View className="flex-row items-center">
                <Clock size={12} color="#64748B" />
                <Text className="text-adroom-text-muted text-xs ml-1">
                    {new Date(item.created_at).toLocaleDateString()}
                </Text>
             </View>
          </View>
        </View>
        
        <View className="items-end">
           {item.status === 'active' || (item as any).is_active ? (
               <View className="flex-row items-center bg-green-500/10 px-2 py-1 rounded-full border border-green-500/30">
                   <Play size={10} color="#4ADE80" />
                   <Text className="text-green-400 text-xs font-bold ml-1 uppercase">Live</Text>
               </View>
           ) : (
               <View className="flex-row items-center bg-gray-500/10 px-2 py-1 rounded-full">
                   <CheckCircle size={10} color="#94A3B8" />
                   <Text className="text-gray-400 text-xs font-bold ml-1 uppercase">Ended</Text>
               </View>
           )}
        </View>
      </View>

      {/* Real-time Assets Viewer */}
      {renderAssetPreview(item.assets)}
      
      {/* Real-time Monitor Indicator */}
      {(item.status === 'active' || (item as any).is_active) && (
          <View className="mt-4 pt-3 border-t border-adroom-neon/10 flex-row items-center">
              <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse mr-2" />
              <Text className="text-adroom-neon text-xs">AI Monitor Active: Analyzing performance...</Text>
          </View>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark">
      <View className="px-4 py-4 border-b border-adroom-neon/20 flex-row items-center mb-2">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3">
          <ArrowLeft color="#E2E8F0" size={24} />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Strategy History</Text>
      </View>

      <FlatList 
        data={history}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchHistory} tintColor="#00F0FF" />
        }
        ListEmptyComponent={
            <View className="items-center justify-center mt-20">
                <Text className="text-adroom-text-muted">No strategies found.</Text>
            </View>
        }
      />
    </SafeAreaView>
  );
}
