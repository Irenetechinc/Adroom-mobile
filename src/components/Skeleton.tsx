import React, { useEffect } from 'react';
import { View, ViewProps, StyleSheet, Image, ActivityIndicator, Text } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence 
} from 'react-native-reanimated';

interface SkeletonProps extends ViewProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  width = '100%', 
  height = 20, 
  borderRadius = 4, 
  style, 
  ...props 
}) => {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1000 }),
        withTiming(0.3, { duration: 1000 })
      ),
      -1, // Infinite repeat
      true // Reverse
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        { 
          width: width as any, 
          height: height as any, 
          borderRadius, 
          backgroundColor: '#1E293B',
        },
        animatedStyle,
        style
      ]}
      {...props}
    />
  );
};

export const AuthLoadingSkeleton = () => {
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0F19', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 100, height: 100, borderRadius: 30,
        backgroundColor: '#151B2B',
        borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.3)',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 24, overflow: 'hidden',
      }}>
        <Image
          source={require('../../assets/icon.png')}
          style={{ width: 80, height: 80, borderRadius: 22 }}
          resizeMode="contain"
        />
      </View>
      <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 }}>
        AdRoom <Text style={{ color: '#F59E0B' }}>AI</Text>
      </Text>
      <Text style={{ color: '#475569', fontSize: 13, marginBottom: 36 }}>Autonomous Marketing Platform</Text>
      <ActivityIndicator color="#F59E0B" size="small" />
    </View>
  );
};
