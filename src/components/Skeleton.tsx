import React, { useEffect } from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
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
    <View style={{ flex: 1, backgroundColor: '#0B0F19', justifyContent: 'center', paddingHorizontal: 24 }}>
      <View style={{ alignItems: 'center', marginBottom: 40 }}>
        <Skeleton width={150} height={40} borderRadius={8} style={{ marginBottom: 10 }} />
        <Skeleton width={200} height={20} borderRadius={4} />
      </View>

      <View>
        <View style={{ marginBottom: 16 }}>
          <Skeleton width={80} height={16} borderRadius={4} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={50} borderRadius={10} />
        </View>

        <View style={{ marginBottom: 24 }}>
          <Skeleton width={80} height={16} borderRadius={4} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={50} borderRadius={10} />
        </View>

        <Skeleton width="100%" height={56} borderRadius={12} />
        
        <View style={{ alignItems: 'center', marginTop: 24 }}>
           <Skeleton width={200} height={16} borderRadius={4} />
        </View>
      </View>
    </View>
  );
};
