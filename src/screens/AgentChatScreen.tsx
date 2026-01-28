import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import * as ImagePicker from 'expo-image-picker'; // We need to add this dependency

type Props = NativeStackScreenProps<RootStackParamList, 'AgentChat'>;

export default function AgentChatScreen({ navigation }: Props) {
  const { messages, addMessage, isTyping, setTyping, generateStrategies, updateProductDetails } = useAgentStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setTyping(true);
      setTimeout(() => {
        addMessage('Hello! I am AdRoom Agent. To get started, please upload a photo of your product or service.', 'agent');
        setTyping(false);
      }, 1000);
    }
  }, []);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const userText = inputText;
    setInputText('');
    addMessage(userText, 'user');

    processAgentResponse(userText);
  };

  const handleImageUpload = async () => {
    // In a real app, use expo-image-picker
    // For this simulation, we'll pretend the user picked an image
    // AND we'll add a "Simulated" image message
    const mockImageUri = 'https://placehold.co/600x400/png'; 
    
    addMessage('Here is my product image.', 'user', mockImageUri);
    updateProductDetails({ baseImageUri: mockImageUri });
    
    setTyping(true);
    setTimeout(() => {
      addMessage("Great photo! I'm analyzing the visual elements...", 'agent');
      setTimeout(() => {
        addMessage("It looks like a high-quality product. What is the name of this product?", 'agent');
        setTyping(false);
      }, 1500);
    }, 1500);
  };

  const processAgentResponse = (userText: string) => {
    setTyping(true);
    
    // Simple state machine for conversation flow
    const lastAgentMsg = [...messages].reverse().find(m => m.sender === 'agent')?.text || '';

    setTimeout(() => {
      if (lastAgentMsg.includes('name of this product')) {
        updateProductDetails({ name: userText });
        addMessage(`Got it. Who is the ideal customer for ${userText}?`, 'agent');
      } else if (lastAgentMsg.includes('ideal customer')) {
        updateProductDetails({ targetAudience: userText });
        addMessage("Understood. I'm now generating two comprehensive strategies (Free & Paid) for you. I'll also create some ad creatives.", 'agent');
        
        generateStrategies().then(() => {
           navigation.navigate('StrategyApproval');
        });
      } else {
        // Fallback
         addMessage("Could you tell me more about the product?", 'agent');
      }
      setTyping(false);
    }, 1500);
  };

  const renderMessage = ({ item }: { item: any }) => (
    <View className={`mb-4 flex-row ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
      {item.sender === 'agent' && (
        <View className="w-8 h-8 rounded-full bg-blue-100 items-center justify-center mr-2">
          <Text className="text-xs font-bold text-blue-800">AI</Text>
        </View>
      )}
      <View 
        className={`px-4 py-3 rounded-2xl max-w-[80%] ${
          item.sender === 'user' 
            ? 'bg-blue-600 rounded-tr-none' 
            : 'bg-gray-100 rounded-tl-none'
        }`}
      >
        {item.imageUri ? (
          <Image 
            source={{ uri: item.imageUri }} 
            className="w-48 h-32 rounded-lg mb-2" 
            resizeMode="cover"
          />
        ) : null}
        <Text className={`${item.sender === 'user' ? 'text-white' : 'text-gray-800'}`}>
          {item.text}
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <View className="flex-1 px-4 pt-4">
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <View className="p-4 border-t border-gray-100 bg-white">
        <View className="flex-row items-center">
          <TouchableOpacity 
            onPress={handleImageUpload}
            className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center mr-2"
          >
            <Text className="text-gray-500 text-xl">📷</Text>
          </TouchableOpacity>
          <TextInput
            className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-3 mr-2 text-gray-800"
            placeholder="Type your message..."
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity 
            onPress={handleSend}
            className="w-12 h-12 bg-blue-800 rounded-full items-center justify-center"
          >
            <Text className="text-white font-bold text-xl">↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
