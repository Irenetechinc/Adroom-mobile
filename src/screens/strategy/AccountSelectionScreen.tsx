import React, { useCallback, useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, ArrowRight, Check, Link2, Plus } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAgentStore } from '../../store/agentStore';

const colors = { bg: '#0B0F19', panel: '#121D2B', text: '#E2E8F0', muted: '#8FA3B8', cyan: '#00F0FF', border: '#233246' };

export default function AccountSelectionScreen() {
  const navigation = useNavigation<any>();
  const { connectedPlatforms, loadConnectedPlatforms } = useAgentStore();
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadConnectedPlatforms().finally(() => setLoading(false));
  }, [loadConnectedPlatforms]));

  const platforms = Object.values(connectedPlatforms || {}) as any[];
  const continueNext = () => navigation.navigate('AgentChat', { strategyAccountSelection: true });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><TouchableOpacity onPress={() => navigation.goBack()}><ArrowLeft color={colors.text} size={22} /></TouchableOpacity><Text style={styles.headerTitle}>Choose channels</Text><View style={{ width: 22 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}><View style={styles.icon}><Link2 color={colors.cyan} size={22} /></View><Text style={styles.title}>Where should this strategy run?</Text><Text style={styles.subtitle}>Select the connected accounts Adirum AI should use for this campaign. Your choice stays specific to this strategy.</Text></View>
        {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: 32 }} /> : <TouchableOpacity style={styles.connectCard} onPress={continueNext}><Link2 color={colors.cyan} size={22} /><View style={{ flex: 1 }}><Text style={styles.connectTitle}>{platforms.length ? 'Continue in Adirum AI' : 'Open account connection'}</Text><Text style={styles.connectText}>Adirum AI will show connected accounts here and use its existing connection flow for any account you still need.</Text></View><ArrowRight color={colors.cyan} size={18} /></TouchableOpacity>}
      </ScrollView>
      <View style={styles.footer}><TouchableOpacity style={styles.next} onPress={continueNext}><Text style={styles.nextText}>Choose accounts</Text><ArrowRight color={colors.bg} size={18} /></TouchableOpacity></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 15 }, headerTitle: { flex: 1, color: colors.text, fontSize: 19, fontWeight: '800' }, content: { padding: 20, paddingBottom: 130 }, intro: { alignItems: 'center', marginBottom: 24 }, icon: { width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(0,240,255,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, title: { color: colors.text, fontSize: 24, fontWeight: '900', textAlign: 'center' }, subtitle: { color: colors.muted, lineHeight: 20, textAlign: 'center', marginTop: 8 }, account: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.panel, borderRadius: 18, padding: 15, marginBottom: 10 }, accountSelected: { backgroundColor: 'rgba(0,240,255,0.10)' }, accountMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#1B2A3A', alignItems: 'center', justifyContent: 'center' }, accountMarkSelected: { backgroundColor: colors.cyan }, accountLetter: { color: colors.text, fontWeight: '900' }, accountName: { color: colors.text, fontWeight: '800' }, accountPlatform: { color: colors.muted, fontSize: 12, marginTop: 3, textTransform: 'capitalize' }, connectCard: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.panel, borderRadius: 18, padding: 16 }, connectTitle: { color: colors.text, fontWeight: '800' }, connectText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 }, secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 18 }, secondaryText: { color: colors.muted, fontWeight: '700' }, footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, backgroundColor: colors.bg }, next: { height: 52, borderRadius: 16, backgroundColor: colors.cyan, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, nextDisabled: { backgroundColor: '#243447' }, nextText: { color: colors.bg, fontWeight: '900' },
});
