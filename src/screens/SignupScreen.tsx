import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';

type Props = NativeStackScreenProps<RootStackParamList, 'Signup'>;

export default function SignupScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);
    if (error) {
      Alert.alert('Signup Failed', error.message);
    } else {
      Alert.alert('Success', 'Please check your email for verification!');
      navigation.navigate('Login');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-adroom-dark justify-center px-6"
    >
      <Animated.View 
        entering={FadeInUp.duration(1000).springify()} 
        className="items-center mb-12"
      >
        <Text className="text-4xl font-extrabold text-white" style={{ textShadowColor: '#7000FF', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 }}>
          NEW IDENTITY
        </Text>
        <Text className="text-adroom-text-muted mt-3 text-lg tracking-widest uppercase">
          Join the Network
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(1000).springify()}>
        <View className="mb-6 space-y-4">
          <View>
            <Text className="text-adroom-purple mb-2 font-bold uppercase text-xs tracking-wider">Email Interface</Text>
            <TextInput
              className="w-full bg-adroom-card border border-adroom-purple/30 focus:border-adroom-purple rounded-xl p-4 text-adroom-text placeholder:text-gray-600"
              placeholder="Enter your email"
              placeholderTextColor="#4B5563"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View>
            <Text className="text-adroom-purple mb-2 font-bold uppercase text-xs tracking-wider">Passcode</Text>
            <TextInput
              className="w-full bg-adroom-card border border-adroom-purple/30 focus:border-adroom-purple rounded-xl p-4 text-adroom-text placeholder:text-gray-600"
              placeholder="Create a password"
              placeholderTextColor="#4B5563"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>
        </View>

        <TouchableOpacity 
          onPress={handleSignup}
          disabled={loading}
          className={`w-full bg-adroom-purple p-4 rounded-xl items-center shadow-lg shadow-adroom-purple/50 ${loading ? 'opacity-70' : ''}`}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-white font-bold text-lg uppercase tracking-wider">Register System</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          className="items-center mt-8"
        >
          <Text className="text-adroom-text-muted">
            Already registered? <Text className="text-adroom-purple font-bold">Access System</Text>
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
