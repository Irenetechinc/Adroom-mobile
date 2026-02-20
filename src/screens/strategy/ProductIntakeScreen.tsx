
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, ActivityIndicator, TextInput, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { VisionService } from '../../services/vision';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, Upload, ArrowRight, Loader2 } from 'lucide-react-native';

export default function ProductIntakeScreen() {
  const navigation = useNavigation<any>();
  const { productData, setProductData } = useStrategyCreationStore();
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload product images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true, // VisionService handles conversion but this is handy
    });

    if (!result.canceled && result.assets[0].uri) {
      setProductData({ imageUri: result.assets[0].uri });
      analyzeImage(result.assets[0].uri);
    }
  };

  const analyzeImage = async (uri: string) => {
    setLoading(true);
    try {
      const attributes = await VisionService.analyzeProductImage(uri);
      
      // Auto-fill form
      setProductData({
        scanResult: attributes,
        name: attributes.name || '',
        description: attributes.description || '',
        price: attributes.estimatedPrice || '',
        category: attributes.category || '',
        targetAudience: attributes.suggested_target_audience || '',
      });
      
    } catch (error) {
      Alert.alert('Analysis Failed', 'Could not analyze image. Please enter details manually.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (!productData.name || !productData.description) {
      Alert.alert('Missing Information', 'Please provide at least a product name and description.');
      return;
    }
    navigation.navigate('StrategyWizard_GoalSelection');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <ScrollView className="flex-1 px-6">
        <Text className="text-2xl font-bold text-white mt-6 mb-2">New Strategy Setup</Text>
        <Text className="text-slate-400 mb-8">Step 1: Product Intake</Text>

        {/* Image Upload Area */}
        <TouchableOpacity 
          onPress={pickImage}
          className="w-full h-64 bg-slate-900 rounded-2xl border-2 border-dashed border-slate-700 items-center justify-center overflow-hidden mb-8"
        >
          {productData.imageUri ? (
            <Image source={{ uri: productData.imageUri }} className="w-full h-full" resizeMode="cover" />
          ) : (
            <View className="items-center">
              <Upload size={48} color="#94A3B8" />
              <Text className="text-slate-400 mt-4 font-medium">Tap to upload product image</Text>
              <Text className="text-slate-600 text-sm mt-1">AI will scan for details</Text>
            </View>
          )}
          
          {loading && (
            <View className="absolute inset-0 bg-black/70 items-center justify-center">
              <ActivityIndicator size="large" color="#00F0FF" />
              <Text className="text-cyan-400 mt-4 font-bold">AI Analyzing...</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Form Fields */}
        <View className="space-y-4 mb-8">
          <View>
            <Text className="text-slate-300 mb-2 font-medium">Product Name</Text>
            <TextInput
              value={productData.name}
              onChangeText={(text) => setProductData({ name: text })}
              placeholder="e.g. Wireless Noise-Cancelling Headphones"
              placeholderTextColor="#475569"
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 focus:border-cyan-500"
            />
          </View>

          <View>
            <Text className="text-slate-300 mb-2 font-medium">Category</Text>
            <TextInput
              value={productData.category}
              onChangeText={(text) => setProductData({ category: text })}
              placeholder="e.g. Electronics"
              placeholderTextColor="#475569"
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 focus:border-cyan-500"
            />
          </View>

          <View>
            <Text className="text-slate-300 mb-2 font-medium">Target Audience</Text>
            <TextInput
              value={productData.targetAudience}
              onChangeText={(text) => setProductData({ targetAudience: text })}
              placeholder="e.g. Remote workers, audiophiles"
              placeholderTextColor="#475569"
              multiline
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 focus:border-cyan-500 h-24"
              textAlignVertical="top"
            />
          </View>

          <View>
            <Text className="text-slate-300 mb-2 font-medium">Description</Text>
            <TextInput
              value={productData.description}
              onChangeText={(text) => setProductData({ description: text })}
              placeholder="Detailed description of your product..."
              placeholderTextColor="#475569"
              multiline
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 focus:border-cyan-500 h-32"
              textAlignVertical="top"
            />
          </View>

           <View>
            <Text className="text-slate-300 mb-2 font-medium">Price ($)</Text>
            <TextInput
              value={productData.price}
              onChangeText={(text) => setProductData({ price: text })}
              placeholder="0.00"
              placeholderTextColor="#475569"
              keyboardType="numeric"
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 focus:border-cyan-500"
            />
          </View>
        </View>

      </ScrollView>

      {/* Footer */}
      <View className="p-6 border-t border-slate-900 bg-slate-950">
        <TouchableOpacity 
          onPress={handleNext}
          className="bg-cyan-500 py-4 rounded-xl flex-row justify-center items-center shadow-lg shadow-cyan-500/20"
        >
          <Text className="text-slate-950 font-bold text-lg mr-2">Continue to Goal</Text>
          <ArrowRight size={20} color="#020617" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
