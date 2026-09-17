import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, Phone, ShieldCheck } from 'lucide-react-native';
import { TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OutreachService } from '../services/outreach';
import FeatureGate from '../components/FeatureGate';
const c = { bg: '#0B0F19', card: '#151B2B', border: '#1E293B', text: '#E2E8F0', muted: '#94A3B8', cyan: '#00F0FF', green: '#10B981' };
export default function OutreachPreferencesScreen() {
  const navigation = useNavigation<any>();
  const [prefs, setPrefs] = useState({ do_not_call: false, public_data_collection: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const nextPrefs = await OutreachService.getPreferences();
      setPrefs((p) => ({ ...p, ...nextPrefs }));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const update = async (key: 'do_not_call' | 'public_data_collection', value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    try {
      await OutreachService.updatePreferences(next);
    } catch (e: any) {
      setPrefs(prefs);
      Alert.alert('Could not save preference', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureGate flag="outreach_preferences_ui" message="This area is currently unavailable.">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ArrowLeft color={c.text} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Outreach Privacy</Text>
          <ShieldCheck color={c.green} size={20} />
        </View>

        {loading ? (
          <ActivityIndicator color={c.cyan} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.content}>
            <Text style={styles.subtitle}>Control how Adirum uses outreach and permitted public evidence.</Text>

            <View style={styles.card}>
              <View style={styles.row}>
                <Phone color={c.cyan} size={20} />
                <View style={styles.copy}>
                  <Text style={styles.label}>Do not call</Text>
                  <Text style={styles.help}>Block autonomous outbound calls for your account.</Text>
                </View>
                <Switch
                  value={prefs.do_not_call}
                  onValueChange={(v) => update('do_not_call', v)}
                  trackColor={{ false: c.border, true: `${c.cyan}88` }}
                  thumbColor={prefs.do_not_call ? c.cyan : c.muted}
                />
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.row}>
                <ShieldCheck color={c.green} size={20} />
                <View style={styles.copy}>
                  <Text style={styles.label}>Public mention evidence</Text>
                  <Text style={styles.help}>Allow permitted public excerpts to inform sales preparation profiles.</Text>
                </View>
                <Switch
                  value={prefs.public_data_collection}
                  onValueChange={(v) => update('public_data_collection', v)}
                  trackColor={{ false: c.border, true: `${c.green}88` }}
                  thumbColor={prefs.public_data_collection ? c.green : c.muted}
                />
              </View>
            </View>

            {saving && <Text style={styles.saved}>Saving…</Text>}
          </View>
        )}
      </SafeAreaView>
    </FeatureGate>
  );
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: c.bg }, header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: c.border }, title: { flex: 1, color: c.text, fontSize: 20, fontWeight: '800' }, content: { padding: 16 }, subtitle: { color: c.muted, lineHeight: 20, marginBottom: 18 }, card: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, copy: { flex: 1 }, label: { color: c.text, fontWeight: '800', fontSize: 15 }, help: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 4 }, saved: { color: c.green, fontSize: 12 } });
