import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInUp, FadeInRight, FadeInLeft, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';

// Typing Indicator Component
const TypingIndicator = () => {
  return (
    <View className="flex-row items-center space-x-1 p-2">
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse" />
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse delay-75" />
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse delay-150" />
    </View>
  );
};

// Custom UI Components for Chat
const FacebookConnectButton = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity 
    onPress={onPress}
    className="bg-[#1877F2] py-3 px-6 rounded-xl flex-row items-center justify-center mt-2 shadow-lg"
  >
    <Text className="text-white font-bold text-base mr-2">f</Text>
    <Text className="text-white font-bold text-base">Connect Facebook</Text>
  </TouchableOpacity>
);

const SelectionList = ({ items, onSelect, type }: { items: any[], onSelect: (item: any) => void, type: 'page' | 'ad_account' }) => (
  <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden">
    {items.map((item, index) => (
      <TouchableOpacity 
        key={item.id}
        onPress={() => onSelect(item)}
        className={`p-4 border-b border-adroom-neon/10 flex-row justify-between items-center ${index === items.length - 1 ? 'border-b-0' : ''}`}
      >
        <View>
          <Text className="text-white font-bold text-base">{item.name}</Text>
          <Text className="text-adroom-text-muted text-xs">
            {type === 'page' ? item.category : `ID: ${item.account_id}`}
          </Text>
        </View>
        <Text className="text-adroom-neon text-lg">›</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const CompletionCard = ({ onDashboard }: { onDashboard: () => void }) => (
  <View className="mt-2 bg-adroom-card p-5 rounded-xl border border-green-500/50 items-center">
    <View className="w-12 h-12 bg-green-500/20 rounded-full items-center justify-center mb-3">
      <Text className="text-green-400 text-2xl">✓</Text>
    </View>
    <Text className="text-white font-bold text-lg mb-1">Campaign Launched</Text>
    <Text className="text-adroom-text-muted text-center mb-4">Your strategy is now active and running autonomously.</Text>
    
    <TouchableOpacity 
      onPress={onDashboard}
      className="bg-adroom-neon w-full py-3 rounded-lg items-center"
    >
      <Text className="text-adroom-dark font-bold uppercase">Go to Dashboard</Text>
    </TouchableOpacity>
  </View>
);

type Props = NativeStackScreenProps<RootStackParamList, 'AgentChat'>;

export default function AgentChatScreen({ navigation, route }: Props) {
  const { 
    messages, addMessage, isTyping, setTyping, generateStrategies, updateProductDetails, 
    initiateFacebookConnection, handleFacebookLogin, handlePageSelection, handleAdAccountSelection,
    connectionState
  } = useAgentStore();
  
  const { user } = useAuthStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [init, setInit] = useState(false);

  // Check if we came from Strategy Approval
  useEffect(() => {
    if (route.params?.fromStrategyApproval && connectionState === 'IDLE') {
        initiateFacebookConnection();
    }
  }, [route.params]);

  useEffect(() => {
    if (!init && messages.length === 0 && user) {
      setInit(true);
      setTyping(true);
      const userName = user.email?.split('@')[0] || 'User';
      
      setTimeout(() => {
        addMessage(`Hello ${userName}, welcome to AdRoom. I am your autonomous marketing agent. To get started, please upload a photo of your product or service.`, 'agent');
        setTyping(false);
      }, 1500);
    }
  }, [init, messages.length, user]);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const userText = inputText;
    setInputText('');
    addMessage(userText, 'user');

    processAgentResponse(userText);
  };

  const handleImageUpload = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      alert("Permission to access camera roll is required!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const selectedImage = result.assets[0].uri;
      
      addMessage('Uploading visual data...', 'user', selectedImage);
      updateProductDetails({ baseImageUri: selectedImage });
      
      setTyping(true);
      setTimeout(() => {
        addMessage("Visual data received. Scanning for product attributes...", 'agent');
        setTimeout(() => {
          addMessage("Analysis complete. High-fidelity product detected. Please identify the product name.", 'agent');
          setTyping(false);
        }, 2000);
      }, 1000);
    }
  };

  const processAgentResponse = (userText: string) => {
    // If we are in a specific flow, we might want to block standard text response
    if (connectionState !== 'IDLE' && connectionState !== 'COMPLETED') {
        return; // Wait for UI interaction
    }

    setTyping(true);
    
    // Simple state machine for conversation flow
    const lastAgentMsg = [...messages].reverse().find(m => m.sender === 'agent')?.text || '';

    setTimeout(() => {
      if (lastAgentMsg.includes('product name') || lastAgentMsg.includes('identify the product')) {
        updateProductDetails({ name: userText });
        addMessage(`Acknowledged. Target detected: ${userText}. Define the target demographic.`, 'agent');
      } else if (lastAgentMsg.includes('target demographic') || lastAgentMsg.includes('ideal customer')) {
        updateProductDetails({ targetAudience: userText });
        addMessage("Parameters set. Initiating strategy generation protocols (Organic & Paid). Generating creative assets...", 'agent');
        
        generateStrategies().then(() => {
           navigation.navigate('StrategyApproval');
        });
      } else {
        // Fallback
         addMessage("Input received. Please provide more context.", 'agent');
      }
      setTyping(false);
    }, 1500);
  };

  const renderMessage = ({ item }: { item: any }) => (
    <Animated.View 
      entering={item.sender === 'user' ? FadeInRight : FadeInLeft}
      layout={Layout.springify()}
      className={`mb-4 flex-row ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {item.sender === 'agent' && (
        <View className="w-8 h-8 rounded-full bg-adroom-card border border-adroom-neon items-center justify-center mr-2 shadow-lg shadow-adroom-neon/50">
          <Text className="text-xs font-bold text-adroom-neon">AI</Text>
        </View>
      )}
      <View 
        className={`px-4 py-3 rounded-2xl max-w-[85%] border ${
          item.sender === 'user' 
            ? 'bg-adroom-neon/10 border-adroom-neon rounded-tr-none' 
            : 'bg-adroom-card border-adroom-border rounded-tl-none'
        }`}
      >
        {item.imageUri ? (
          <Image 
            source={{ uri: item.imageUri }} 
            className="w-48 h-32 rounded-lg mb-2 border border-adroom-neon/30" 
            resizeMode="cover"
          />
        ) : null}
        
        <Text className={`${item.sender === 'user' ? 'text-adroom-neon' : 'text-adroom-text'}`}>
          {item.text}
        </Text>

        {/* Custom UI Rendering */}
        {item.uiType === 'facebook_connect' && (
            <FacebookConnectButton onPress={handleFacebookLogin} />
        )}
        
        {item.uiType === 'page_selection' && item.uiData?.pages && (
            <SelectionList 
                items={item.uiData.pages} 
                type="page" 
                onSelect={handlePageSelection} 
            />
        )}

        {item.uiType === 'ad_account_selection' && item.uiData?.adAccounts && (
            <SelectionList 
                items={item.uiData.adAccounts} 
                type="ad_account" 
                onSelect={handleAdAccountSelection} 
            />
        )}

        {item.uiType === 'completion_card' && (
            <CompletionCard onDashboard={() => navigation.navigate('Main')} />
        )}

      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark" edges={['top']}>
      {/* Header */}
      <View className="px-4 py-3 border-b border-adroom-neon/20 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
          <Text className="text-adroom-text font-bold text-lg tracking-wider">ADROOM <Text className="text-adroom-neon">AGENT</Text></Text>
        </View>
        <Text className="text-adroom-text-muted text-xs">ONLINE</Text>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 px-4 pt-4">
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={isTyping ? <TypingIndicator /> : null}
          />
        </View>

        <View className="p-4 border-t border-adroom-neon/10 bg-adroom-dark/90">
          <View className="flex-row items-center space-x-2">
            <TouchableOpacity 
              onPress={handleImageUpload}
              className="w-10 h-10 bg-adroom-card border border-adroom-neon/50 rounded-full items-center justify-center"
            >
              <Text className="text-adroom-neon text-xl">📷</Text>
            </TouchableOpacity>
            
            <TextInput
              className="flex-1 bg-adroom-card border border-adroom-neon/30 rounded-full px-4 py-3 text-adroom-text placeholder:text-gray-500 focus:border-adroom-neon"
              placeholder="Enter command..."
              placeholderTextColor="#64748B"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
            />
            
            <TouchableOpacity 
              onPress={handleSend}
              className="w-12 h-12 bg-adroom-neon rounded-full items-center justify-center shadow-lg shadow-adroom-neon/30"
            >
              <Text className="text-adroom-dark font-bold text-xl">➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
