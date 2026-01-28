import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';

export default function SettingsScreen() {
  const { signOut, user } = useAuthStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  return (
    <View className="flex-1 bg-white p-4">
      <Text className="text-2xl font-bold text-blue-800 mb-6">Settings</Text>
      
      <View className="mb-6 p-4 bg-gray-50 rounded-lg">
        <Text className="text-gray-500 text-sm mb-1">Signed in as</Text>
        <Text className="text-gray-900 font-medium">{user?.email}</Text>
      </View>

      <View className="mb-6">
        <Text className="text-lg font-bold text-gray-800 mb-3">Integrations</Text>
        <TouchableOpacity 
          onPress={() => navigation.navigate('FacebookConfig')}
          className="bg-blue-50 p-4 rounded-lg flex-row justify-between items-center border border-blue-100"
        >
          <View>
            <Text className="text-blue-900 font-medium">Facebook Ads</Text>
            <Text className="text-blue-600 text-xs mt-1">Configure Ad Account & Page</Text>
          </View>
          <Text className="text-blue-800 font-bold">→</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity 
        onPress={handleSignOut}
        className="bg-red-50 p-4 rounded-lg items-center border border-red-100 mt-auto"
      >
        <Text className="text-red-600 font-medium">Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
