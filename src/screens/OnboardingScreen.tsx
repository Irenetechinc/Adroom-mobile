import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, Dimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, Target, TrendingUp, ShieldCheck, ArrowRight } from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

const FeatureCard = ({ icon: Icon, title, description, delay }: any) => (
  <Animated.View 
    entering={FadeInDown.delay(delay).springify()}
    className="bg-adroom-card p-6 rounded-2xl mb-4 border border-adroom-neon/20 shadow-lg shadow-adroom-neon/10"
  >
    <View className="w-12 h-12 bg-adroom-neon/10 rounded-full items-center justify-center mb-4 border border-adroom-neon/30">
      <Icon color="#00F0FF" size={24} />
    </View>
    <Text className="text-white text-lg font-bold mb-2">{title}</Text>
    <Text className="text-adroom-text-muted leading-5">{description}</Text>
  </Animated.View>
);

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export default function OnboardingScreen({ navigation }: Props) {
  return (
    <SafeAreaView className="flex-1 bg-adroom-dark">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header Section */}
        <Animated.View entering={FadeInUp.delay(200)} className="items-center mt-10 px-6">
          <View className="w-20 h-20 bg-adroom-neon/20 rounded-full items-center justify-center mb-6 border-2 border-adroom-neon animate-pulse">
            <Zap size={40} color="#00F0FF" />
          </View>
          <Text className="text-3xl font-bold text-white text-center mb-2">
            AdRoom <Text className="text-adroom-neon">Intelligent Smart</Text>
          </Text>
          <Text className="text-lg font-bold text-white text-center mb-4">
             Automated Digital Marketing Agent
          </Text>
          <Text className="text-adroom-text-muted text-center text-base px-4">
            The world's first fully autonomous marketing OS.
          </Text>
        </Animated.View>

        {/* Features Grid */}
        <View className="px-6 mt-10">
          <FeatureCard 
            icon={Target}
            title="Real-time Strategy"
            description="Autonomous ad campaigns that adjust instantly to market data and user behavior."
            delay={400}
          />
          <FeatureCard 
            icon={TrendingUp}
            title="Smart Asset Gen"
            description="Instantly generate professional banners, copy, and video concepts using generative AI."
            delay={600}
          />
          <FeatureCard 
            icon={ShieldCheck}
            title="Auto-Integrity"
            description="Every word is proofread and every image vetted by AI before going live."
            delay={800}
          />
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <Animated.View 
        entering={FadeInUp.delay(1000)}
        className="absolute bottom-10 left-6 right-6"
      >
        <TouchableOpacity 
          onPress={() => navigation.replace('Login')}
          className="bg-adroom-neon h-14 rounded-xl flex-row items-center justify-center shadow-lg shadow-adroom-neon/40"
        >
          <Text className="text-adroom-dark font-bold text-lg mr-2 uppercase tracking-wider">Initialize System</Text>
          <ArrowRight color="#050B14" size={24} />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}
