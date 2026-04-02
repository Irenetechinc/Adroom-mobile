
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
import ImageUploadComponent from '../components/ImageUploadComponent';

// --- Interactive Cards ---

const ProductIntakeCard = ({ onUpload, onManual, onWebsite }: { onUpload: () => void, onManual: () => void, onWebsite: () => void }) => (
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
    
    <View className="flex-row">
        <TouchableOpacity 
          onPress={onWebsite}
          className="flex-1 p-4 items-center bg-adroom-card border-r border-adroom-neon/10"
        >
          <Text className="text-adroom-neon font-medium">Website URL</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={onManual}
          className="flex-1 p-4 items-center bg-adroom-card"
        >
          <Text className="text-adroom-neon font-medium">Manual Entry</Text>
        </TouchableOpacity>
    </View>
  </View>
);

const WebsiteIntakeCard = ({ onSubmit }: { onSubmit: (url: string) => void }) => {
    const [url, setUrl] = useState('');
    return (
        <View className="mt-2 bg-adroom-card p-4 rounded-xl border border-adroom-neon/20">
            <TextInput 
                placeholder="https://yourstore.com" 
                placeholderTextColor="#64748B"
                className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                keyboardType="url"
            />
            <TouchableOpacity 
                onPress={() => onSubmit(url)}
                className="bg-adroom-neon py-3 rounded-lg items-center"
            >
                <Text className="text-adroom-dark font-bold uppercase">Scrape Website</Text>
            </TouchableOpacity>
        </View>
    );
};

const AttributeEditorCard = ({ product, onSave }: { product: any, onSave: (data: any) => void }) => {
    const [editedProduct, setEditedProduct] = useState({ ...product });
    const [newFieldKey, setNewFieldKey] = useState('');
    const [newFieldValue, setNewFieldValue] = useState('');

    const handleUpdate = (key: string, value: string) => {
        setEditedProduct({ ...editedProduct, [key]: value });
    };

    const handleAddField = () => {
        if (newFieldKey && newFieldValue) {
            setEditedProduct({ ...editedProduct, [newFieldKey]: newFieldValue });
            setNewFieldKey('');
            setNewFieldValue('');
        }
    };

    const handleRemoveField = (key: string) => {
        const updated = { ...editedProduct };
        delete updated[key];
        setEditedProduct(updated);
    };

    return (
        <View className="mt-2 bg-adroom-card p-4 rounded-xl border border-adroom-neon/20">
            <Text className="text-white font-bold mb-3">Refine Product Details</Text>
            <ScrollView className="max-h-64 mb-4">
                {Object.entries(editedProduct).map(([key, value]) => {
                    if (key === 'id' || key === 'images' || typeof value === 'object') return null;
                    return (
                        <View key={key} className="mb-3">
                            <View className="flex-row justify-between items-center mb-1">
                                <Text className="text-adroom-neon text-[10px] uppercase font-bold">{key.replace('_', ' ')}</Text>
                                <TouchableOpacity onPress={() => handleRemoveField(key)}>
                                    <Text className="text-red-500 text-xs">Remove</Text>
                                </TouchableOpacity>
                            </View>
                            <TextInput 
                                className="bg-adroom-dark p-2 rounded text-white border border-white/5"
                                value={String(value)}
                                onChangeText={(val) => handleUpdate(key, val)}
                                multiline={key === 'description'}
                            />
                        </View>
                    );
                })}
                
                <View className="border-t border-adroom-neon/10 pt-3 mt-2">
                    <Text className="text-slate-400 text-[10px] font-bold mb-2">ADD MISSING FIELD</Text>
                    <View className="flex-row space-x-2">
                        <TextInput 
                            placeholder="Label" 
                            placeholderTextColor="#475569"
                            className="flex-1 bg-adroom-dark p-2 rounded text-white text-xs border border-white/5"
                            value={newFieldKey}
                            onChangeText={setNewFieldKey}
                        />
                        <TextInput 
                            placeholder="Value" 
                            placeholderTextColor="#475569"
                            className="flex-2 bg-adroom-dark p-2 rounded text-white text-xs border border-white/5"
                            value={newFieldValue}
                            onChangeText={setNewFieldValue}
                        />
                        <TouchableOpacity onPress={handleAddField} className="bg-adroom-neon/20 px-3 justify-center rounded">
                            <Text className="text-adroom-neon font-bold">+</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            <TouchableOpacity 
                onPress={() => onSave(editedProduct)}
                className="bg-adroom-neon py-3 rounded-lg items-center"
            >
                <Text className="text-adroom-dark font-bold uppercase">Confirm & Continue</Text>
            </TouchableOpacity>
        </View>
    );
};

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

const STRATEGY_TYPES = [
  { id: 'product', name: 'Product', icon: Tag, description: 'Promote a specific item' },
  { id: 'service', name: 'Service', icon: Users, description: 'Promote a professional service' },
  { id: 'brand', name: 'Brand', icon: Rocket, description: 'Build awareness and authority' },
];

const StrategyTypeSelectionCard = ({ onSelect }: { onSelect: (type: string) => void }) => (
  <View className="mt-2 space-y-3">
    {STRATEGY_TYPES.map((type) => (
      <TouchableOpacity 
        key={type.id}
        onPress={() => onSelect(type.id)}
        className="bg-adroom-card p-4 rounded-xl border border-adroom-neon/20 flex-row items-center"
      >
        <View className="w-10 h-10 rounded-full bg-adroom-neon/10 items-center justify-center mr-4">
           <type.icon size={20} color="#00F0FF" />
        </View>
        <View className="flex-1">
          <Text className="text-white font-bold">{type.name}</Text>
          <Text className="text-adroom-text-muted text-xs">{type.description}</Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
);

const DurationSelectionCard = ({ onSelect, recommended }: { onSelect: (days: number) => void, recommended?: number }) => (
  <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden">
    {recommended && (
        <TouchableOpacity 
            onPress={() => onSelect(recommended)}
            className="p-4 flex-row items-center justify-between border-b border-cyan-500/30 bg-cyan-500/5"
        >
            <View className="flex-row items-center">
                <Zap size={20} color="#00F0FF" />
                <View className="ml-3">
                    <Text className="text-cyan-400 font-bold">Recommended: {recommended} Days</Text>
                    <Text className="text-cyan-400/60 text-xs">Optimized for your goal and price</Text>
                </View>
            </View>
            <Text className="text-cyan-400 font-bold">Select ›</Text>
        </TouchableOpacity>
    )}
    {DURATIONS.map((d, i) => {
      const Icon = d.icon;
      if (d.days === recommended) return null; // Don't duplicate
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

const StrategyPreviewCard = ({ strategy, onLaunch }: { strategy: any, onLaunch: () => void }) => {
  return (
    <View className="mt-2 bg-adroom-card rounded-xl border border-adroom-neon/20 overflow-hidden w-full">
      <View className="p-4">
         <View className="flex-row justify-between mb-4">
            <View>
                <Text className="text-slate-400 text-xs uppercase">Est. Reach</Text>
                <Text className="text-white font-bold text-xl">{strategy.estimated_outcomes?.reach || 'N/A'}</Text>
            </View>
         </View>

         <View className="bg-adroom-dark/50 p-3 rounded-lg mb-4">
             <Text className="text-slate-300 text-sm leading-5">
                {strategy.rationale || "Optimized strategy based on real-time intelligence."}
             </Text>
         </View>
         
         {/* Platforms */}
         <View className="flex-row flex-wrap gap-2 mb-4">
            {strategy.platforms?.map((p: string) => (
                <View key={p} className="bg-adroom-neon/10 px-2 py-1 rounded border border-adroom-neon/30">
                    <Text className="text-adroom-neon text-xs capitalize">{p}</Text>
                </View>
            ))}
         </View>

         <TouchableOpacity 
            onPress={onLaunch}
            className="bg-adroom-neon py-3 rounded-lg items-center"
         >
             <Text className="text-adroom-dark font-bold uppercase">LAUNCH STRATEGY</Text>
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

const SelectionList = ({ items, onSelect, type }: { items: any[], onSelect: (item: any) => void, type: 'page' }) => (
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
            {item.category}
          </Text>
        </View>
        <Text className="text-adroom-neon text-lg">›</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const ProductManualIntakeCard = ({ onSubmit }: { onSubmit: (data: any) => void }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

  return (
    <View className="mt-2 bg-adroom-card p-4 rounded-xl border border-adroom-neon/20">
      <TextInput 
        placeholder="Product Name" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={name}
        onChangeText={setName}
      />
      <TextInput 
        placeholder="Category (e.g. Fashion)" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={category}
        onChangeText={setCategory}
      />
      <TextInput 
        placeholder="Price (e.g. 5000)" 
        placeholderTextColor="#64748B"
        keyboardType="numeric"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={price}
        onChangeText={setPrice}
      />
      <TextInput 
        placeholder="Product Description" 
        placeholderTextColor="#64748B"
        multiline
        className="bg-adroom-dark p-3 rounded-lg text-white mb-4 border border-white/5 h-20"
        value={description}
        onChangeText={setDescription}
      />
      <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />
      <TouchableOpacity 
        onPress={() => onSubmit({ name, category, price, description, images })}
        className="bg-adroom-neon py-3 rounded-lg items-center mt-4"
      >
        <Text className="text-adroom-dark font-bold uppercase">Save Product</Text>
      </TouchableOpacity>
    </View>
  );
};

const RetryActionCard = ({ onRetry, onCancel, actionName }: { onRetry: () => void, onCancel: () => void, actionName: string }) => (
  <View className="mt-2 bg-adroom-card p-5 rounded-xl border border-red-500/50">
    <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 bg-red-500/20 rounded-full items-center justify-center mr-3">
            <Text className="text-red-500 text-xl">⚠</Text>
        </View>
        <View>
            <Text className="text-white font-bold text-lg">{actionName} Failed</Text>
            <Text className="text-adroom-text-muted text-xs">Would you like to try again?</Text>
        </View>
    </View>
    
    <View className="flex-row space-x-3 mt-2">
        <TouchableOpacity 
            onPress={onCancel}
            className="flex-1 bg-slate-800 py-3 rounded-lg items-center border border-slate-700"
        >
            <Text className="text-slate-400 font-bold uppercase">No, Skip</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
            onPress={onRetry}
            className="flex-1 bg-adroom-neon py-3 rounded-lg items-center"
        >
            <Text className="text-adroom-dark font-bold uppercase">Retry Now</Text>
        </TouchableOpacity>
    </View>
  </View>
);

const CompletionCard = ({ onDashboard }: { onDashboard: () => void }) => (
  <View className="mt-2 bg-adroom-card p-5 rounded-xl border border-green-500/50 items-center">
    <View className="w-12 h-12 bg-green-500/20 rounded-full items-center justify-center mb-3">
      <Text className="text-green-400 text-2xl">✓</Text>
    </View>
    <Text className="text-white font-bold text-lg mb-1">Campaign Launched</Text>
    <Text className="text-adroom-text-muted text-center mb-4">Your strategy is now active and running autonomously by Adroom .</Text>
    
    <TouchableOpacity 
      onPress={onDashboard}
      className="bg-adroom-neon w-full py-3 rounded-lg items-center"
    >
      <Text className="text-adroom-dark font-bold uppercase">Go to Dashboard</Text>
    </TouchableOpacity>
  </View>
);

const CreateStrategyPromptCard = ({ onStartStrategy }: { onStartStrategy: () => void }) => (
  <View className="mt-2 bg-adroom-card p-5 rounded-xl border border-adroom-neon/50 items-center">
    <View className="w-12 h-12 bg-adroom-neon/20 rounded-full items-center justify-center mb-3">
      <Rocket size={24} color="#00F0FF" />
    </View>
    <Text className="text-white font-bold text-lg mb-1">Ready to Grow?</Text>
    <Text className="text-adroom-text-muted text-center mb-4">You are connected! Create a strategy now to start running ads.</Text>
    
    <TouchableOpacity 
      onPress={onStartStrategy}
      className="bg-adroom-neon w-full py-3 rounded-lg items-center"
    >
      <Text className="text-adroom-dark font-bold uppercase">Create New Strategy</Text>
    </TouchableOpacity>
  </View>
);

const ServiceIntakeCard = ({ onSubmit }: { onSubmit: (data: any) => void }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

  return (
    <View className="mt-2 bg-adroom-card p-4 rounded-xl border border-adroom-neon/20">
      <TextInput 
        placeholder="Service Name" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={name}
        onChangeText={setName}
      />
      <TextInput 
        placeholder="Category (e.g. Consulting)" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={category}
        onChangeText={setCategory}
      />
      <TextInput 
        placeholder="Pricing Model (e.g. $100/hr)" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={price}
        onChangeText={setPrice}
      />
      <TextInput 
        placeholder="Service Description" 
        placeholderTextColor="#64748B"
        multiline
        className="bg-adroom-dark p-3 rounded-lg text-white mb-4 border border-white/5 h-20"
        value={description}
        onChangeText={setDescription}
      />
      <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />
      <TouchableOpacity 
        onPress={() => onSubmit({ name, category, price, description, images })}
        className="bg-adroom-neon py-3 rounded-lg items-center mt-4"
      >
        <Text className="text-adroom-dark font-bold">SAVE SERVICE</Text>
      </TouchableOpacity>
    </View>
  );
};

const BrandIntakeCard = ({ onSubmit }: { onSubmit: (data: any) => void }) => {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [values, setValues] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

  return (
    <View className="mt-2 bg-adroom-card p-4 rounded-xl border border-adroom-neon/20">
      <TextInput 
        placeholder="Brand Name" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={name}
        onChangeText={setName}
      />
      <TextInput 
        placeholder="Mission Statement" 
        placeholderTextColor="#64748B"
        className="bg-adroom-dark p-3 rounded-lg text-white mb-3 border border-white/5"
        value={mission}
        onChangeText={setMission}
      />
      <TextInput 
        placeholder="Core Values" 
        placeholderTextColor="#64748B"
        multiline
        className="bg-adroom-dark p-3 rounded-lg text-white mb-4 border border-white/5 h-20"
        value={values}
        onChangeText={setValues}
      />
      <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />
      <TouchableOpacity 
        onPress={() => onSubmit({ name, mission, values, images })}
        className="bg-adroom-neon py-3 rounded-lg items-center mt-4"
      >
        <Text className="text-adroom-dark font-bold">SAVE BRAND</Text>
      </TouchableOpacity>
    </View>
  );
};

const FacebookConnectButton = ({ onPress, isConnected, onDisconnect, platform }: { onPress: () => void, isConnected: boolean, onDisconnect: () => void, platform: string }) => (
  <TouchableOpacity 
    onPress={isConnected ? onDisconnect : onPress}
    className={`${isConnected ? 'bg-red-500/80 border-red-500' : 'bg-adroom-neon'} py-3 px-6 rounded-xl flex-row items-center justify-center mt-2 shadow-lg border ${isConnected ? '' : 'border-transparent'}`}
  >
    <Text className="text-white font-bold text-base mr-2">{platform?.charAt(0).toUpperCase()}</Text>
    <Text className="text-adroom-dark font-bold text-base">{isConnected ? `Disconnect ${platform}` : `Connect ${platform}`}</Text>
  </TouchableOpacity>
);


type Props = NativeStackScreenProps<RootStackParamList, 'AgentChat'>;

export default function AgentChatScreen({ navigation, route }: Props) {
  const { 
    messages, addMessage, isTyping, setTyping, isInputDisabled, setInputDisabled,
    flowState, handleProductIntake, handleGoalSelection, handleDurationSelection, handleStrategySelection,
    initiateConnection, handleLogin, handleAccountSelection,
    connectionState, loadMessages, restoreSession, startNewSession, tokens, disconnectPlatform,
    handleStrategyTypeSelection, handleServiceIntake, handleBrandIntake, handleManualProductSubmit,
    handleRetry, handleImageUpload: handleImageUploadStore, startStrategyFlow,
    handleWebsiteIntake
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

  useEffect(() => {
    if (connectionState !== 'IDLE') return;
    if (route.params?.fromStrategyApproval) {
      initiateConnection('facebook', true);
      return;
    }
    if (route.params?.connectFacebook) initiateConnection('facebook', false);
    if (route.params?.connectInstagram) initiateConnection('instagram', false);
    if (route.params?.connectTikTok) initiateConnection('tiktok', false);
    if (route.params?.connectLinkedIn) initiateConnection('linkedin', false);
    if (route.params?.connectTwitter) initiateConnection('twitter', false);
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
      base64: true, 
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const selectedImage = result.assets[0].uri;
      const base64 = result.assets[0].base64; 

      if (!base64) {
        Alert.alert('Upload Error', 'Image encoding failed. Please try another image.');
        return;
      }
      
      setUploading(true);
      addMessage('Uploading product image...', 'user', selectedImage);
      
      try {
          await handleImageUploadStore(selectedImage, base64);
      } finally {
          setUploading(false);
      }
    }
  };

  const SessionRestoreCard = ({ lastActivity, preview, onRestore, onNew }: { lastActivity?: string; preview?: string; onRestore: () => void; onNew: () => void }) => (
    <View className="mt-3 bg-adroom-dark/50 border border-adroom-neon/20 rounded-xl p-4">
      <Text className="text-white font-bold mb-2">Resume session?</Text>
      {lastActivity ? <Text className="text-adroom-text-muted text-xs mb-2">Last activity: {lastActivity}</Text> : null}
      {preview ? <Text className="text-adroom-text text-sm mb-3">{preview}</Text> : null}
      <View className="flex-row">
        <TouchableOpacity onPress={onRestore} className="flex-1 bg-adroom-neon rounded-lg py-3 items-center mr-2">
          <Text className="text-adroom-dark font-bold">Resume</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNew} className="flex-1 border border-adroom-neon/40 rounded-lg py-3 items-center ml-2">
          <Text className="text-adroom-neon font-bold">Start New</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
  
  const handleManualEntry = () => {
      setInputDisabled(true);
      addMessage("Manual Entry", 'user');
      addMessage("Please provide your product details below.", 'agent', undefined, 'product_manual_form');
  };

  const handleWebsiteEntry = () => {
      setInputDisabled(true);
      addMessage("Website Scan", 'user');
      addMessage("Please provide your store or product URL below.", 'agent', undefined, 'website_intake_form' as any);
  };

  const renderMessage = ({ item }: { item: any }) => (
    <Animated.View 
      entering={item.sender === 'user' ? FadeInRight : FadeInLeft}
      layout={Layout.springify()}
      className={`mb-4 flex-row ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {item.sender === 'agent' && (
        <View className="w-8 h-8 rounded-full bg-adroom-card border border-adroom-neon items-center justify-center mr-2 shadow-lg shadow-adroom-neon/50">
          <Text className="text-xs font-bold text-adroom-neon">AD</Text>
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
            <ProductIntakeCard onUpload={handleImageUpload} onManual={handleManualEntry} onWebsite={handleWebsiteEntry} />
        )}

        {item.uiType === 'website_intake_form' && (
            <WebsiteIntakeCard onSubmit={handleWebsiteIntake} />
        )}

        {item.uiType === 'attribute_editor' && item.uiData?.product && (
            <AttributeEditorCard product={item.uiData.product} onSave={(data) => handleProductIntake(data)} />
        )}

        {item.uiType === 'product_manual_form' && (
            <ProductManualIntakeCard onSubmit={handleManualProductSubmit} />
        )}

        {item.uiType === 'service_intake_form' && (
            <ServiceIntakeCard onSubmit={handleServiceIntake} />
        )}

        {item.uiType === 'brand_intake_form' && (
            <BrandIntakeCard onSubmit={handleBrandIntake} />
        )}

        {item.uiType === 'strategy_type_selection' && (
            <StrategyTypeSelectionCard onSelect={handleStrategyTypeSelection} />
        )}
        
        {item.uiType === 'goal_selection' && (
            <GoalSelectionCard onSelect={handleGoalSelection} />
        )}
        
        {item.uiType === 'duration_selection' && (
            <DurationSelectionCard 
                onSelect={handleDurationSelection} 
                recommended={item.uiData?.recommended}
            />
        )}
        
        {item.uiType === 'strategy_preview' && item.uiData?.strategy && (
            <StrategyPreviewCard strategy={item.uiData.strategy} onLaunch={handleStrategySelection} />
        )}

        {item.uiType === 'retry_action' && (
            <RetryActionCard 
                actionName={item.uiData?.action} 
                onRetry={() => handleRetry(item.uiData?.action, item.uiData?.data)}
                onCancel={() => addMessage("I'll help you with something else then. What would you like to do?", 'agent')}
            />
        )}

        {item.uiType === 'facebook_connect' && (
            <FacebookConnectButton 
                onPress={() => handleLogin(item.uiData?.platform || 'facebook')} 
                isConnected={!!tokens[item.uiData?.platform || 'facebook']} 
                onDisconnect={() => disconnectPlatform(item.uiData?.platform || 'facebook')}
                platform={item.uiData?.platform || 'facebook'}
            />
        )}
        
        {item.uiType === 'page_selection' && item.uiData?.pages && (
            <SelectionList 
                items={item.uiData.pages} 
                type="page" 
                onSelect={(account) => handleAccountSelection(item.uiData?.platform || 'facebook', account)} 
            />
        )}

        {item.uiType === 'completion_card' && (
            <CompletionCard onDashboard={() => navigation.navigate('Main', { screen: 'Dashboard' })} />
        )}

        {item.uiType === 'create_strategy_prompt' && (
            <CreateStrategyPromptCard onStartStrategy={startStrategyFlow} />
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
