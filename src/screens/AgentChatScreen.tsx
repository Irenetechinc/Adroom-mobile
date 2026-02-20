
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInUp, FadeInRight, FadeInLeft, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { DrawerActions } from '@react-navigation/native';
import { Menu, Edit2, Check, Upload, DollarSign, Eye, Tag, Rocket, MapPin, RefreshCw, Users, Zap, Calendar, TrendingUp } from 'lucide-react-native';
import { IntegrityService } from '../services/integrity';
import { VisionService } from '../services/vision';

// --- Interactive Cards ---

const ProductIntakeCard = ({ onUpload, onManual }: { onUpload: () => void, onManual: () => void }) => (
  <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden">
    <TouchableOpacity 
      onPress={onUpload}
      className="p-6 items-center border-b border-adroom-neon/10 bg-adroom-dark/50"
    >
      <View className="w-16 h-16 rounded-full bg-adroom-neon/10 items-center justify-center mb-3 border border-adroom-neon/30">
        <Upload size={32} color="#00F0FF" />
      </View>
      <Text className="text-white font-bold text-lg">Upload Product Image</Text>
      <Text className="text-adroom-text-muted text-center mt-1 text-xs">AI will scan for attributes automatically</Text>
    </TouchableOpacity>
    
    <TouchableOpacity 
      onPress={onManual}
      className="p-4 items-center bg-adroom-card"
    >
      <Text className="text-adroom-neon font-medium">Enter Details Manually</Text>
    </TouchableOpacity>
  </View>
);

const GOALS = [
  { id: 'sales', name: 'Sales', icon: DollarSign, color: '#10B981' },
  { id: 'awareness', name: 'Awareness', icon: Eye, color: '#3B82F6' },
  { id: 'promotional', name: 'Promo', icon: Tag, color: '#F59E0B' },
  { id: 'launch', name: 'Launch', icon: Rocket, color: '#8B5CF6' },
];

const GoalSelectionCard = ({ onSelect }: { onSelect: (goal: string) => void }) => (
  <View className="mt-2 flex-row flex-wrap justify-between">
    {GOALS.map((goal) => {
      const Icon = goal.icon;
      return (
        <TouchableOpacity 
          key={goal.id}
          onPress={() => onSelect(goal.id)}
          className="w-[48%] bg-adroom-card p-4 rounded-xl border border-adroom-neon/20 mb-3 items-center"
        >
          <View className="w-10 h-10 rounded-full items-center justify-center mb-2" style={{ backgroundColor: `${goal.color}20` }}>
            <Icon size={20} color={goal.color} />
          </View>
          <Text className="text-white font-bold text-sm">{goal.name}</Text>
        </TouchableOpacity>
      )
    })}
  </View>
);

const DURATIONS = [
  { days: 7, label: '7 Days', icon: Zap },
  { days: 14, label: '14 Days', icon: Calendar },
  { days: 30, label: '30 Days', icon: TrendingUp },
];

const DurationSelectionCard = ({ onSelect }: { onSelect: (days: number) => void }) => (
  <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden">
    {DURATIONS.map((d, i) => {
      const Icon = d.icon;
      return (
        <TouchableOpacity 
          key={d.days}
          onPress={() => onSelect(d.days)}
          className={`p-4 flex-row items-center justify-between ${i < DURATIONS.length - 1 ? 'border-b border-adroom-neon/10' : ''}`}
        >
          <View className="flex-row items-center">
             <Icon size={20} color="#94A3B8" />
             <Text className="text-white font-bold ml-3">{d.label}</Text>
          </View>
          <Text className="text-adroom-neon font-bold">Select ›</Text>
        </TouchableOpacity>
      )
    })}
  </View>
);

const StrategyComparisonCard = ({ strategies, onSelect }: { strategies: any, onSelect: (type: 'free' | 'paid') => void }) => {
  const [tab, setTab] = useState<'free' | 'paid'>('free');
  const active = tab === 'free' ? strategies.free : strategies.paid;

  return (
    <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden w-full">
      {/* Tabs */}
      <View className="flex-row border-b border-adroom-neon/20">
        <TouchableOpacity 
          onPress={() => setTab('free')} 
          className={`flex-1 p-3 items-center ${tab === 'free' ? 'bg-adroom-neon/10 border-b-2 border-adroom-neon' : ''}`}
        >
          <Text className={`font-bold ${tab === 'free' ? 'text-adroom-neon' : 'text-slate-500'}`}>FREE</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => setTab('paid')} 
          className={`flex-1 p-3 items-center ${tab === 'paid' ? 'bg-adroom-neon/10 border-b-2 border-adroom-neon' : ''}`}
        >
          <Text className={`font-bold ${tab === 'paid' ? 'text-adroom-neon' : 'text-slate-500'}`}>PAID</Text>
        </TouchableOpacity>
      </View>

      <View className="p-4">
         <View className="flex-row justify-between mb-4">
            <View>
                <Text className="text-slate-400 text-xs uppercase">Est. Reach</Text>
                <Text className="text-white font-bold text-xl">{active.expected_outcomes?.reach || 'N/A'}</Text>
            </View>
             <View>
                <Text className="text-slate-400 text-xs uppercase text-right">Budget</Text>
                <Text className="text-white font-bold text-xl text-right">
                    {tab === 'free' ? '$0' : `$${active.budget_recommendation || 0}`}
                </Text>
            </View>
         </View>

         <View className="bg-adroom-dark/50 p-3 rounded-lg mb-4">
             <Text className="text-slate-300 text-sm leading-5">
                {active.content_plan?.summary || "AI-driven content strategy focusing on high engagement and conversion optimization."}
             </Text>
         </View>
         
         <TouchableOpacity 
            onPress={() => onSelect(tab)}
            className={`py-3 rounded-lg items-center ${tab === 'free' ? 'bg-green-500' : 'bg-adroom-neon'}`}
         >
             <Text className="text-black font-bold uppercase">LAUNCH {tab} STRATEGY</Text>
         </TouchableOpacity>
      </View>
    </View>
  );
};

// --- Main Component ---

const TypingIndicator = () => (
    <View className="flex-row items-center space-x-1 p-2">
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse" />
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse delay-75" />
      <View className="w-2 h-2 rounded-full bg-adroom-neon animate-pulse delay-150" />
    </View>
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

const FacebookConnectButton = ({ onPress, isConnected, onDisconnect }: { onPress: () => void, isConnected: boolean, onDisconnect: () => void }) => (
  <TouchableOpacity 
    onPress={isConnected ? onDisconnect : onPress}
    className={`${isConnected ? 'bg-red-500/80 border-red-500' : 'bg-[#1877F2]'} py-3 px-6 rounded-xl flex-row items-center justify-center mt-2 shadow-lg border ${isConnected ? '' : 'border-transparent'}`}
  >
    <Text className="text-white font-bold text-base mr-2">f</Text>
    <Text className="text-white font-bold text-base">{isConnected ? 'Disconnect Facebook' : 'Connect Facebook'}</Text>
  </TouchableOpacity>
);

const SessionRestoreCard = ({ lastActivity, preview, onRestore, onNew }: any) => (
  <View className="mt-2 bg-adroom-card p-5 rounded-xl border border-adroom-neon/50">
    <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 bg-adroom-neon/20 rounded-full items-center justify-center mr-3">
            <Text className="text-adroom-neon text-xl">↺</Text>
        </View>
        <View>
            <Text className="text-white font-bold text-lg">Resume Session?</Text>
            <Text className="text-adroom-text-muted text-xs">Last active: {lastActivity}</Text>
        </View>
    </View>
    
    <View className="bg-adroom-dark p-3 rounded-lg mb-4 border border-white/10">
        <Text className="text-gray-400 italic text-sm">"{preview}"</Text>
    </View>

    <View className="flex-row space-x-3">
        <TouchableOpacity 
            onPress={onNew}
            className="flex-1 bg-red-500/20 py-3 rounded-lg items-center border border-red-500/50"
        >
            <Text className="text-red-400 font-bold">Start Fresh</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
            onPress={onRestore}
            className="flex-1 bg-adroom-neon py-3 rounded-lg items-center"
        >
            <Text className="text-adroom-dark font-bold">Continue</Text>
        </TouchableOpacity>
    </View>
  </View>
);


type Props = NativeStackScreenProps<RootStackParamList, 'AgentChat'>;

export default function AgentChatScreen({ navigation, route }: Props) {
  const { 
    messages, addMessage, isTyping, setTyping, isInputDisabled, setInputDisabled,
    flowState, handleProductIntake, handleGoalSelection, handleDurationSelection, handleStrategySelection,
    initiateFacebookConnection, handleFacebookLogin, handlePageSelection, handleAdAccountSelection,
    connectionState, loadMessages, restoreSession, startNewSession, fbAccessToken, disconnectFacebook
  } = useAgentStore();
  
  const { user } = useAuthStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [init, setInit] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Load history on mount
  useEffect(() => {
    loadMessages().then(() => setHistoryLoaded(true));
  }, []);

  // Check if we came from Strategy Approval
  useEffect(() => {
    if (route.params?.fromStrategyApproval && connectionState === 'IDLE') {
        initiateFacebookConnection();
    }
  }, [route.params]);

  useEffect(() => {
    if (historyLoaded && !init && messages.length === 0 && user) {
       setInit(true);
    }
  }, [init, messages.length, user, historyLoaded]);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    let finalText = inputText;
    setInputText('');
    
    addMessage(finalText, 'user');
    
    // Fallback: If in a specific flow but user types, we might want to handle it or just let AI generic respond
    // For now, if flow is active, we mostly ignore text unless it's a manual entry override (future improvement)
    if (flowState === 'IDLE') {
        // Generic chat response or intent detection
        // ...
    }
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
      quality: 0.8,
      base64: true, // Need base64 for AI analysis
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const selectedImage = result.assets[0].uri;
      const base64 = result.assets[0].base64; // Store might need this, or VisionService can read from URI if local
      
      setUploading(true);
      addMessage('Uploading product image...', 'user', selectedImage);
      
      try {
          // Analyze immediately
          const attributes = await VisionService.analyzeProductImage(selectedImage); // Or base64 if modified service
          
          await handleProductIntake({
              name: attributes.name,
              description: attributes.description,
              baseImageUri: selectedImage,
              scanResult: attributes,
              targetAudience: attributes.suggested_target_audience,
              price: attributes.estimatedPrice,
              category: attributes.category
          });
          
      } catch (error) {
          addMessage("Analysis failed. Please enter details manually.", 'agent');
      } finally {
          setUploading(false);
      }
    }
  };
  
  const handleManualEntry = () => {
      // For now, simple prompt. In future, could be a modal form.
      setInputDisabled(false);
      addMessage("Manual Entry", 'user');
      addMessage("Please type the product name and description.", 'agent');
      // Logic to capture next text input as product details would go here
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
        
        {item.uiType === 'product_intake_form' && (
            <ProductIntakeCard onUpload={handleImageUpload} onManual={handleManualEntry} />
        )}
        
        {item.uiType === 'goal_selection' && (
            <GoalSelectionCard onSelect={handleGoalSelection} />
        )}
        
        {item.uiType === 'duration_selection' && (
            <DurationSelectionCard onSelect={handleDurationSelection} />
        )}
        
        {item.uiType === 'strategy_comparison' && item.uiData?.strategies && (
            <StrategyComparisonCard strategies={item.uiData.strategies} onSelect={handleStrategySelection} />
        )}

        {/* Previous UI Types */}
        {item.uiType === 'facebook_connect' && (
            <FacebookConnectButton 
                onPress={handleFacebookLogin} 
                isConnected={!!fbAccessToken} 
                onDisconnect={disconnectFacebook}
            />
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

        {item.uiType === 'session_restore' && (
            <SessionRestoreCard 
                lastActivity={item.uiData?.lastActivity}
                preview={item.uiData?.preview}
                onRestore={restoreSession}
                onNew={startNewSession}
            />
        )}
      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark" edges={['top']}>
      {/* Header */}
      <View className="px-4 py-3 border-b border-adroom-neon/20 flex-row items-center justify-between">
        <View className="flex-row items-center">
            <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} className="mr-3">
                <Menu color="#E2E8F0" size={24} />
            </TouchableOpacity>
            <View className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
            <Text className="text-adroom-text font-bold text-lg tracking-wider">ADROOM <Text className="text-adroom-neon">AGENT</Text></Text>
        </View>
        <TouchableOpacity onPress={startNewSession}>
            <Text className="text-adroom-text-muted text-xs">RESET</Text>
        </TouchableOpacity>
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
            ListFooterComponent={(isTyping || uploading) ? <TypingIndicator /> : null}
          />
        </View>

        {/* Only show input bar if explicitly enabled (e.g., manual entry) */}
        {!isInputDisabled && (
            <View className="p-4 border-t border-adroom-neon/10 bg-adroom-dark/90">
            <View className="flex-row items-center space-x-2">
                <TextInput
                className={`flex-1 bg-adroom-card border border-adroom-neon/30 rounded-full px-4 py-3 text-adroom-text placeholder:text-gray-500 focus:border-adroom-neon`}
                placeholder="Enter command..."
                placeholderTextColor="#64748B"
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSend}
                />
                
                <TouchableOpacity 
                onPress={handleSend}
                className={`w-12 h-12 bg-adroom-neon rounded-full items-center justify-center shadow-lg shadow-adroom-neon/30`}
                >
                <Text className="text-adroom-dark font-bold text-xl">➤</Text>
                </TouchableOpacity>
            </View>
            </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
