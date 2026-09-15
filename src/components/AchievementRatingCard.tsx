import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Star, X } from 'lucide-react-native';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.adroom.mobile';

export default function AchievementRatingCard({
  onDismiss,
  onRated,
}: {
  onDismiss: () => void;
  onRated: () => void;
}) {
  const openRating = async () => {
    onRated();
    await Linking.openURL(PLAY_STORE_URL);
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <TouchableOpacity onPress={onDismiss} style={styles.close} accessibilityLabel="Close rating prompt">
          <X size={18} color="#94A3B8" />
        </TouchableOpacity>
        <View style={styles.iconWrap}>
          <Star size={25} color="#FBBF24" fill="#FBBF24" />
        </View>
        <Text style={styles.eyebrow}>A result worth sharing</Text>
        <Text style={styles.title}>How is Adirum AI performing for you?</Text>
        <Text style={styles.body}>
          Your autonomous workforce has been active and making progress. A quick Play Store rating helps more businesses discover Adirum AI.
        </Text>
        <TouchableOpacity onPress={openRating} style={styles.primary} activeOpacity={0.86}>
          <Star size={17} color="#07111C" fill="#07111C" />
          <Text style={styles.primaryText}>Rate Adirum AI</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} style={styles.secondary} activeOpacity={0.75}>
          <Text style={styles.secondaryText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(3, 9, 18, 0.72)', justifyContent: 'flex-end', padding: 16 },
  card: { backgroundColor: '#101D2D', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(0,240,255,0.22)', padding: 22, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: -8 } },
  close: { position: 'absolute', right: 14, top: 14, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(148,163,184,0.08)' },
  iconWrap: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(251,191,36,0.12)', marginBottom: 14 },
  eyebrow: { color: '#FBBF24', textTransform: 'uppercase', letterSpacing: 1.3, fontSize: 10, fontWeight: '800', marginBottom: 7 },
  title: { color: '#F8FAFC', fontSize: 22, lineHeight: 28, fontWeight: '900', marginBottom: 9 },
  body: { color: '#A9BBD0', fontSize: 13, lineHeight: 20, marginBottom: 18 },
  primary: { height: 48, borderRadius: 14, backgroundColor: '#00F0FF', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryText: { color: '#07111C', fontSize: 14, fontWeight: '900' },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
});
