import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { CheckCircle2, X } from 'lucide-react-native';
import { useNotificationStore } from '../store/notificationStore';

export function AgentMilestoneBanner() {
  const milestone = useNotificationStore((state) => state.latestAgentMilestone);
  const clearMilestone = useNotificationStore((state) => state.clearAgentMilestone);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (!milestone) return;
    const timeout = setTimeout(() => {
      setVisible(false);
      clearMilestone();
    }, 12000);
    return () => clearTimeout(timeout);
  }, [milestone?.id, clearMilestone]);

  if (!milestone || !visible) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 10,
        padding: 13,
        borderRadius: 14,
        backgroundColor: '#102331',
        borderLeftWidth: 3,
        borderLeftColor: '#00F0FF',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <CheckCircle2 size={18} color="#00F0FF" style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#E2E8F0', fontSize: 13, fontWeight: '700' }}>{milestone.title}</Text>
        <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 17, marginTop: 3 }}>{milestone.body}</Text>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Dismiss update"
        onPress={() => {
          setVisible(false);
          clearMilestone();
        }}
        hitSlop={10}
      >
        <X size={16} color="#64748B" />
      </TouchableOpacity>
    </Animated.View>
  );
}
