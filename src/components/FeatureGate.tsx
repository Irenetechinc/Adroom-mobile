import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Lock } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import useFeatureFlags from '../hooks/useFeatureFlags';

interface Props {
  flag: string;
  children: React.ReactNode;
  message?: string;
  fullScreen?: boolean;
}

export default function FeatureGate({ flag, children, message, fullScreen = true }: Props) {
  const { isEnabled } = useFeatureFlags();

  if (isEnabled(flag)) return <>{children}</>;

  const content = (
    <View style={styles.inner}>
      <View style={styles.iconWrap}>
        <Lock color="#475569" size={36} strokeWidth={1.5} />
      </View>
      <Text style={styles.title}>Feature Unavailable</Text>
      <Text style={styles.body}>
        {message ?? 'This feature has been temporarily disabled by your administrator.'}
      </Text>
    </View>
  );

  if (!fullScreen) return content;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#050B14',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(71,85,105,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
});
