import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, Phone, CheckCircle2, Clock3, XCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OutreachService } from '../services/outreach';
import FeatureGate from '../components/FeatureGate';
import InlineAudioPlayer from '../components/InlineAudioPlayer';

const colors = { bg: '#0B0F19', card: '#151B2B', border: '#1E293B', text: '#E2E8F0', muted: '#94A3B8', cyan: '#00F0FF', green: '#10B981', amber: '#F59E0B', red: '#EF4444' };
function statusColor(status: string) { return ['completed', 'recorded'].includes(status) ? colors.green : ['failed', 'no_answer', 'canceled'].includes(status) ? colors.red : colors.amber; }

export default function CallLogsScreen() {
  const navigation = useNavigation<any>();
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { setCalls((await OutreachService.getCalls()).calls || []); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return <FeatureGate flag="calling_ui" message="This area is currently unavailable."><SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}><TouchableOpacity onPress={() => navigation.goBack()}><ArrowLeft color={colors.text} size={22} /></TouchableOpacity><Text style={styles.title}>Call Activity</Text><Phone color={colors.cyan} size={20} /></View>
    {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: 40 }} /> : <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.cyan} />} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Call activity and outcomes.</Text>
      {calls.length === 0 ? <View style={styles.empty}><Phone color={colors.muted} size={30} /><Text style={styles.emptyText}>No calls yet</Text></View> : calls.map(call => <View key={call.id} style={styles.card}>
        <View style={styles.row}><View style={[styles.icon, { backgroundColor: `${statusColor(call.status)}18` }]}>{call.status === 'completed' ? <CheckCircle2 color={colors.green} size={19} /> : call.status === 'failed' ? <XCircle color={colors.red} size={19} /> : <Clock3 color={colors.amber} size={19} />}</View><View style={{ flex: 1 }}><Text style={styles.status}>{String(call.status || 'queued').replace(/_/g, ' ')}</Text><Text style={styles.meta}>{call.created_at ? new Date(call.created_at).toLocaleString() : ''}</Text></View></View>
        {!!call.summary?.requested_goal && <Text style={styles.body}>{call.summary.requested_goal}</Text>}
        {!!call.summary?.duration_seconds && <Text style={styles.meta}>Duration: {call.summary.duration_seconds}s</Text>}
        {!!call.transcript && <Text style={styles.transcript}>{call.transcript}</Text>}
        {!!call.summary?.recording_url && <InlineAudioPlayer uri={`${call.summary.recording_url}.mp3`} />}
      </View>)}
    </ScrollView>}
  </SafeAreaView></FeatureGate>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: colors.border }, title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' }, content: { padding: 16, paddingBottom: 40 }, subtitle: { color: colors.muted, marginBottom: 16 }, numberCard: { backgroundColor: `${colors.cyan}10`, borderColor: `${colors.cyan}44`, borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }, numberLabel: { color: colors.muted, fontSize: 12 }, numberValue: { color: colors.text, fontWeight: '700', marginTop: 5 }, smallButton: { backgroundColor: colors.cyan, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 }, smallButtonText: { color: '#04121A', fontWeight: '800' }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 15, marginBottom: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, status: { color: colors.text, fontWeight: '800', textTransform: 'capitalize' }, meta: { color: colors.muted, fontSize: 12, marginTop: 3 }, body: { color: colors.text, marginTop: 12, lineHeight: 20 }, transcript: { color: colors.muted, marginTop: 10, fontSize: 12, lineHeight: 18 }, recording: { color: colors.cyan, fontWeight: '800', marginTop: 10 }, empty: { alignItems: 'center', paddingTop: 80, gap: 10 }, emptyText: { color: colors.muted } });
