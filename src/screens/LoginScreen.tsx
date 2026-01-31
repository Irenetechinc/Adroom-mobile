import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (error) {
      Alert.alert('Login Failed', error.message);
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
        <Text className="text-5xl font-extrabold text-transparent bg-clip-text text-white" style={{ textShadowColor: '#00F0FF', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 }}>
          ADROOM
        </Text>
        <Text className="text-adroom-text-muted mt-3 text-lg tracking-widest uppercase">
          Autonomous Marketing
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(1000).springify()}>
        <View className="mb-6 space-y-4">
          <View>
            <Text className="text-adroom-neon mb-2 font-bold uppercase text-xs tracking-wider">Email Interface</Text>
            <TextInput
              className="w-full bg-adroom-card border border-adroom-neon/30 focus:border-adroom-neon rounded-xl p-4 text-adroom-text placeholder:text-gray-600"
              placeholder="Enter your email"
              placeholderTextColor="#4B5563"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View>
            <Text className="text-adroom-neon mb-2 font-bold uppercase text-xs tracking-wider">Passcode</Text>
            <TextInput
              className="w-full bg-adroom-card border border-adroom-neon/30 focus:border-adroom-neon rounded-xl p-4 text-adroom-text placeholder:text-gray-600"
              placeholder="Enter your password"
              placeholderTextColor="#4B5563"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>
        </View>

        <TouchableOpacity 
          onPress={handleLogin}
          disabled={loading}
          className={`w-full bg-adroom-neon p-4 rounded-xl items-center shadow-lg shadow-adroom-neon/50 ${loading ? 'opacity-70' : ''}`}
        >
          {loading ? (
            <ActivityIndicator color="#0B0F19" />
          ) : (
            <Text className="text-adroom-dark font-bold text-lg uppercase tracking-wider">Initialize Session</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => navigation.navigate('Signup')}
          className="items-center mt-8"
        >
          <Text className="text-adroom-text-muted">
            New User? <Text className="text-adroom-neon font-bold">Create Identity</Text>
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
