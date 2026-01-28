import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useSettingsStore } from '../store/settingsStore';

type Props = NativeStackScreenProps<RootStackParamList, 'FacebookConfig'>;

export default function FacebookConfigScreen({ navigation }: Props) {
  const { facebookConfig, saveConfig, fetchConfig, isLoading } = useSettingsStore();
  
  const [adAccountId, setAdAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pageId, setPageId] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (facebookConfig) {
      setAdAccountId(facebookConfig.ad_account_id);
      setAccessToken(facebookConfig.access_token);
      setPageId(facebookConfig.page_id);
    }
  }, [facebookConfig]);

  const handleSave = async () => {
    if (!adAccountId || !accessToken || !pageId) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    // Basic format validation
    if (!adAccountId.startsWith('act_')) {
      Alert.alert('Invalid Format', 'Ad Account ID should usually start with "act_"');
      // We don't return here, just a warning, as some might not have it
    }

    try {
      await saveConfig({
        ad_account_id: adAccountId,
        access_token: accessToken,
        page_id: pageId,
      });
      Alert.alert('Success', 'Facebook configuration saved successfully!');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Configuration Failed', error.message || 'Could not validate or save credentials');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView className="flex-1 p-6">
        <View className="mb-8">
          <Text className="text-2xl font-bold text-blue-800 mb-2">Facebook Configuration</Text>
          <Text className="text-gray-500">
            Enter your Facebook Marketing API credentials to connect your ad account.
          </Text>
        </View>

        <View className="mb-6">
          <Text className="text-gray-700 mb-2 font-medium">Ad Account ID</Text>
          <TextInput
            className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-800"
            placeholder="e.g. act_123456789"
            value={adAccountId}
            onChangeText={setAdAccountId}
            autoCapitalize="none"
          />
          <Text className="text-xs text-gray-400 mt-1">Found in your Business Manager URL</Text>
        </View>

        <View className="mb-6">
          <Text className="text-gray-700 mb-2 font-medium">Access Token</Text>
          <TextInput
            className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-800"
            placeholder="Your Graph API User Access Token"
            value={accessToken}
            onChangeText={setAccessToken}
            autoCapitalize="none"
            secureTextEntry // Hide token for security
          />
          <Text className="text-xs text-gray-400 mt-1">Requires ads_management and pages_read_engagement permissions</Text>
        </View>

        <View className="mb-8">
          <Text className="text-gray-700 mb-2 font-medium">Page ID</Text>
          <TextInput
            className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-800"
            placeholder="e.g. 10001234567890"
            value={pageId}
            onChangeText={setPageId}
            keyboardType="numeric"
          />
        </View>

        <TouchableOpacity 
          onPress={handleSave}
          disabled={isLoading}
          className={`w-full bg-blue-800 p-4 rounded-lg items-center mb-4 ${isLoading ? 'opacity-70' : ''}`}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Verify & Save</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          disabled={isLoading}
          className="items-center p-4"
        >
          <Text className="text-gray-500 font-medium">Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
