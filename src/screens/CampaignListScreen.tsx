import React, { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useCampaignStore } from '../store/campaignStore';

export default function CampaignListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { campaigns, isLoading, fetchCampaigns } = useCampaignStore();

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const onRefresh = () => {
    fetchCampaigns();
  };

  const renderItem = ({ item }: { item: any }) => (
    <View className="bg-gray-50 p-4 rounded-lg mb-3 border border-gray-100">
      <View className="flex-row justify-between items-start mb-2">
        <Text className="text-lg font-bold text-gray-800 flex-1 mr-2">{item.name}</Text>
        <View className={`px-2 py-1 rounded text-xs ${item.status === 'ACTIVE' ? 'bg-green-100' : 'bg-yellow-100'}`}>
          <Text className={`${item.status === 'ACTIVE' ? 'text-green-800' : 'text-yellow-800'} text-xs font-bold`}>
            {item.status}
          </Text>
        </View>
      </View>
      <Text className="text-gray-500 text-sm mb-3">{item.objective.replace('OUTCOME_', '').replace('_', ' ')}</Text>
      <Text className="text-gray-400 text-xs">ID: {item.facebook_campaign_id}</Text>
    </View>
  );

  return (
    <View className="flex-1 bg-white p-4">
      <View className="flex-row justify-between items-center mb-6 mt-2">
        <Text className="text-2xl font-bold text-blue-800">Campaigns</Text>
        <TouchableOpacity 
          onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: false })}
          className="bg-blue-800 px-4 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">+ New Campaign</Text>
        </TouchableOpacity>
      </View>
      
      {isLoading && campaigns.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#1E40AF" />
        </View>
      ) : (
        <FlatList
          data={campaigns}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#1E40AF" />
          }
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center mt-20">
              <Text className="text-gray-400 text-lg mb-2">No campaigns found</Text>
              <Text className="text-gray-400 text-center px-10">
                Ask AdRoom Agent to create your first campaign.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
