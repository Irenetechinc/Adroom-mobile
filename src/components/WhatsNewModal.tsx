/**
 * "What's New" modal — shown on the first launch after the app updates to a
 * new version. Lists every release note between the last version the user
 * acknowledged and the version they are now running.
 *
 * Markdown is intentionally NOT pulled in as a dependency — release notes use
 * a tiny, predictable subset (lines starting with "•" or "-" become bullets,
 * everything else is a paragraph). Keeps the bundle lean.
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import type { ChangelogEntry } from '../services/appVersionService';

interface Props {
  visible: boolean;
  entries: ChangelogEntry[];
  currentVersion: string;
  onDismiss: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function renderBullets(notes: string) {
  const lines = (notes || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return <Text style={styles.body}>No release notes provided.</Text>;
  }

  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, i) => {
        const isBullet = line.startsWith('•') || line.startsWith('-') || line.startsWith('*');
        const text = isBullet ? line.replace(/^[•\-*]\s*/, '') : line;
        return (
          <View key={i} style={styles.bulletRow}>
            {isBullet && <Text style={styles.bulletDot}>•</Text>}
            <Text style={[styles.body, isBullet && { flex: 1 }]}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function WhatsNewModal({
  visible,
  entries,
  currentVersion,
  onDismiss,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Animated.View entering={FadeIn.duration(220)}>
            <View style={styles.header}>
              <View style={styles.iconWrap}>
                <Sparkles size={20} color="#00F0FF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.kicker}>UPDATED</Text>
                <Text style={styles.title}>What's new in v{currentVersion}</Text>
              </View>
              <TouchableOpacity
                onPress={onDismiss}
                style={styles.closeBtn}
                accessibilityLabel="Close"
              >
                <X size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {entries.map((entry, idx) => (
                <Animated.View
                  key={`${entry.version}-${idx}`}
                  entering={FadeInUp.delay(idx * 60).springify()}
                  style={styles.entry}
                >
                  <View style={styles.entryHeader}>
                    <Text style={styles.entryVersion}>v{entry.version}</Text>
                    {entry.releasedAt ? (
                      <Text style={styles.entryDate}>{formatDate(entry.releasedAt)}</Text>
                    ) : null}
                  </View>
                  {renderBullets(entry.notes)}
                </Animated.View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.cta}
              onPress={onDismiss}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaText}>Got it</Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    color: '#00F0FF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#151B2B',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { maxHeight: 420 },
  entry: {
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  entryVersion: {
    color: '#00F0FF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  entryDate: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  bulletDot: {
    color: '#00F0FF',
    fontSize: 14,
    lineHeight: 21,
  },
  body: {
    color: '#CBD5E1',
    fontSize: 13.5,
    lineHeight: 21,
  },
  cta: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.35)',
    alignItems: 'center',
  },
  ctaText: {
    color: '#00F0FF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
