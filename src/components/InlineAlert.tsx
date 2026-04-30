import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Animated, Easing } from 'react-native';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react-native';

export type InlineAlertVariant = 'error' | 'success' | 'info' | 'warning';

interface InlineAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  variant?: InlineAlertVariant;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onClose?: () => void;
}

const VARIANT_STYLES: Record<InlineAlertVariant, { color: string; bg: string; border: string; Icon: any }> = {
  error: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.35)', Icon: AlertCircle },
  success: { color: '#10B981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.35)', Icon: CheckCircle },
  info: { color: '#00F0FF', bg: 'rgba(0,240,255,0.1)', border: 'rgba(0,240,255,0.35)', Icon: Info },
  warning: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)', Icon: AlertCircle },
};

export default function InlineAlert({
  visible, title, message, variant = 'info',
  primaryLabel = 'OK', onPrimary,
  secondaryLabel, onSecondary,
  onClose,
}: InlineAlertProps) {
  const v = VARIANT_STYLES[variant];
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }),
      ]).start();
    } else {
      fade.setValue(0);
      scale.setValue(0.9);
    }
  }, [visible]);

  const handleClose = () => { onClose?.(); };
  const handlePrimary = () => { (onPrimary ?? onClose)?.(); };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color="#475569" />
          </TouchableOpacity>

          <View style={[styles.iconRing, { backgroundColor: v.bg, borderColor: v.border }]}>
            <v.Icon size={26} color={v.color} />
          </View>

          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.actions}>
            {secondaryLabel ? (
              <TouchableOpacity onPress={onSecondary ?? handleClose} style={[styles.btn, styles.btnGhost]} activeOpacity={0.85}>
                <Text style={styles.btnGhostText}>{secondaryLabel}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handlePrimary}
              style={[styles.btn, { backgroundColor: v.color, flex: secondaryLabel ? 1 : undefined }]}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>{primaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center', alignItems: 'center', padding: 22,
  },
  card: {
    backgroundColor: '#111827', borderRadius: 24,
    padding: 24, width: '100%', maxWidth: 420,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
  },
  closeBtn: { position: 'absolute', top: 14, right: 14, padding: 6 },
  iconRing: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 16, marginTop: 6,
    borderWidth: 1.5,
  },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  message: { color: '#94A3B8', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1E293B' },
  btnGhostText: { color: '#94A3B8', fontWeight: '700', fontSize: 14 },
  btnText: { color: '#0B0F19', fontWeight: '800', fontSize: 14 },
});
