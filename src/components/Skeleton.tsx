import React, { useEffect } from 'react';
import { View, ViewProps, StyleSheet, Image, Text, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
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
      -1,
      true
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
        style,
      ]}
      {...props}
    />
  );
};

/**
 * Branded splash shown while the auth session is being restored on app start.
 * Mirrors the native expo splash colors for a seamless transition and pulses
 * the logo gently so it never looks frozen on slow networks.
 */
export const AuthLoadingSkeleton = () => {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0.45);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.45, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <View style={splashStyles.root}>
      <View style={splashStyles.center}>
        <Animated.View style={[splashStyles.glowRing, ringStyle]} />
        <Animated.View style={[splashStyles.logoWrap, logoStyle]}>
          <Image
            source={require('../../assets/icon.png')}
            style={splashStyles.logo}
            resizeMode="contain"
          />
        </Animated.View>
        <Text style={splashStyles.brand}>
          AdRoom <Text style={{ color: '#00F0FF' }}>AI</Text>
        </Text>
        <Text style={splashStyles.tagline}>Intelligent Marketing Framework</Text>
      </View>
      <View style={splashStyles.footer}>
        <View style={splashStyles.dotRow}>
          <PulseDot delay={0} />
          <PulseDot delay={200} />
          <PulseDot delay={400} />
        </View>
      </View>
    </View>
  );
};

function PulseDot({ delay }: { delay: number }) {
  const o = useSharedValue(0.25);
  useEffect(() => {
    o.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.25, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[
        { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00F0FF', marginHorizontal: 3 },
        animStyle,
        { transform: [{ translateX: 0 }] },
      ]}
    />
  );
}

/**
 * Skeleton placeholder that mirrors the AgentChat shape: header, alternating
 * intelligence/user bubbles, and the composer rail. Shown while message history
 * loads so the user never sees a blank screen.
 */
export const AgentChatSkeleton = () => {
  const screenWidth = Dimensions.get('window').width;
  const bubbleWidth = Math.min(screenWidth * 0.78, 320);

  return (
    <View style={chatStyles.root}>
      {/* Header */}
      <View style={chatStyles.header}>
        <Skeleton width={36} height={36} borderRadius={10} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Skeleton width={60} height={10} borderRadius={5} style={{ marginBottom: 6 }} />
          <Skeleton width={120} height={16} borderRadius={6} />
        </View>
        <Skeleton width={56} height={26} borderRadius={13} style={{ marginRight: 8 }} />
        <Skeleton width={36} height={26} borderRadius={13} />
      </View>

      {/* Messages */}
      <View style={chatStyles.body}>
        {/* Intelligence bubble (left) */}
        <View style={chatStyles.rowLeft}>
          <Skeleton width={32} height={32} borderRadius={16} style={{ marginRight: 8 }} />
          <View style={[chatStyles.bubbleLeft, { maxWidth: bubbleWidth }]}>
            <Skeleton width="90%" height={12} borderRadius={6} style={{ marginBottom: 8 }} />
            <Skeleton width="70%" height={12} borderRadius={6} style={{ marginBottom: 8 }} />
            <Skeleton width="55%" height={12} borderRadius={6} />
          </View>
        </View>

        {/* User bubble (right) */}
        <View style={chatStyles.rowRight}>
          <View style={[chatStyles.bubbleRight, { maxWidth: bubbleWidth * 0.7 }]}>
            <Skeleton width="80%" height={12} borderRadius={6} style={{ marginBottom: 8, backgroundColor: '#1E293B' }} />
            <Skeleton width="55%" height={12} borderRadius={6} style={{ backgroundColor: '#1E293B' }} />
          </View>
        </View>

        {/* Intelligence bubble (left) shorter */}
        <View style={chatStyles.rowLeft}>
          <Skeleton width={32} height={32} borderRadius={16} style={{ marginRight: 8 }} />
          <View style={[chatStyles.bubbleLeft, { maxWidth: bubbleWidth * 0.85 }]}>
            <Skeleton width="60%" height={12} borderRadius={6} style={{ marginBottom: 8 }} />
            <Skeleton width="40%" height={12} borderRadius={6} />
          </View>
        </View>

        {/* Action chips row */}
        <View style={chatStyles.chipsRow}>
          <Skeleton width={92} height={36} borderRadius={18} />
          <Skeleton width={110} height={36} borderRadius={18} />
          <Skeleton width={80} height={36} borderRadius={18} />
        </View>
      </View>

      {/* Composer */}
      <View style={chatStyles.composer}>
        <Skeleton width="100%" height={48} borderRadius={24} />
      </View>
    </View>
  );
};

const splashStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F19', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  glowRing: {
    position: 'absolute',
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(0,240,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
  },
  logoWrap: {
    width: 110, height: 110, borderRadius: 32,
    backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28, overflow: 'hidden',
  },
  logo: { width: 88, height: 88, borderRadius: 24 },
  brand: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.4 },
  tagline: { color: '#64748B', fontSize: 13, marginTop: 8, fontWeight: '500', letterSpacing: 0.2 },
  footer: { position: 'absolute', bottom: 56 },
  dotRow: { flexDirection: 'row' },
});

const chatStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#0B0F19',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 18, gap: 12 },
  rowLeft: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  bubbleLeft: {
    backgroundColor: '#151B2B',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.08)',
    borderRadius: 16, borderTopLeftRadius: 4,
    padding: 14,
  },
  bubbleRight: {
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
    borderRadius: 16, borderTopRightRadius: 4,
    padding: 14,
  },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  composer: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
  },
});
