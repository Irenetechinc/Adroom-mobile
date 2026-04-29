/**
 * Update gate modal.
 *
 * Two modes:
 *   - mode="required" — non-dismissable. Renders OVER the entire app and
 *     blocks every interaction until the user opens the store. Used when the
 *     installed version is below the backend's minSupportedVersion.
 *   - mode="optional" — soft prompt with "Update now" + "Later". Used when a
 *     newer version exists but the installed one is still supported.
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Pressable,
  Platform,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Download, AlertOctagon } from 'lucide-react-native';

interface Props {
  visible: boolean;
  mode: 'required' | 'optional';
  currentVersion: string;
  latestVersion: string | null;
  storeUrl: string | null;
  onLater?: () => void; // only used in optional mode
}

async function openStore(url: string | null) {
  const fallback =
    Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/adroom-ai'
      : 'https://play.google.com/store/apps/details?id=com.adroom.mobile';
  const target = url || fallback;
  try {
    const can = await Linking.canOpenURL(target);
    if (can) await Linking.openURL(target);
    else await Linking.openURL(fallback);
  } catch {
    /* user can't be helped further if the OS refuses to open a URL */
  }
}

export default function ForceUpdateModal({
  visible,
  mode,
  currentVersion,
  latestVersion,
  storeUrl,
  onLater,
}: Props) {
  const required = mode === 'required';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // For required updates we intentionally swallow the back-button. The
      // user MUST update — there is no "skip".
      onRequestClose={() => {
        if (!required && onLater) onLater();
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          if (!required && onLater) onLater();
        }}
      >
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Animated.View entering={FadeIn.duration(220)}>
            <View
              style={[
                styles.iconWrap,
                required ? styles.iconWrapRequired : styles.iconWrapOptional,
              ]}
            >
              {required ? (
                <AlertOctagon size={28} color="#F87171" />
              ) : (
                <Download size={26} color="#00F0FF" />
              )}
            </View>

            <Text style={styles.title}>
              {required ? 'Update required' : 'Update available'}
            </Text>

            <Text style={styles.body}>
              {required
                ? `This version of AdRoom AI (v${currentVersion}) is no longer supported. Please update to continue using the app.`
                : `A newer version of AdRoom AI is available${
                    latestVersion ? ` (v${latestVersion})` : ''
                  }. You're on v${currentVersion}.`}
            </Text>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => openStore(storeUrl)}
              activeOpacity={0.85}
            >
              <Download size={16} color="#0B0F19" />
              <Text style={styles.btnPrimaryText}>
                {required ? 'Update now' : 'Update'}
              </Text>
            </TouchableOpacity>

            {!required && onLater && (
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onLater}
                activeOpacity={0.7}
              >
                <Text style={styles.btnGhostText}>Later</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.2)',
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderWidth: 1,
  },
  iconWrapRequired: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderColor: 'rgba(239,68,68,0.35)',
  },
  iconWrapOptional: {
    backgroundColor: 'rgba(0,240,255,0.10)',
    borderColor: 'rgba(0,240,255,0.30)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  btn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: '#00F0FF',
    borderColor: '#00F0FF',
  },
  btnPrimaryText: {
    color: '#0B0F19',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: '#1E293B',
  },
  btnGhostText: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '600',
  },
});
