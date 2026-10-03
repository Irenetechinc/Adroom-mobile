import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, Box, CheckCircle2, MapPin, Truck } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OutreachService } from '../services/outreach';
import FeatureGate from '../components/FeatureGate';
const c = { bg: '#0B0F19', card: '#151B2B', border: '#1E293B', text: '#E2E8F0', muted: '#94A3B8', cyan: '#00F0FF', green: '#10B981', amber: '#F59E0B' };

export default function ShipmentsScreen() {
  const navigation = useNavigation<any>();
  const [shipments, setShipments] = useState<any[]>([]);
  const [addressDrafts, setAddressDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await OutreachService.getShipments()).shipments || [];
      setShipments(rows);
      setAddressDrafts((current) => {
        const next = { ...current };
        rows.forEach((shipment: any) => {
          if (next[shipment.id] === undefined) next[shipment.id] = shipment.delivery_address || '';
        });
        return next;
      });
    } catch (error: any) {
      Alert.alert('Could not load shipments', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveAddressAndDispatch = async (shipment: any) => {
    const address = String(addressDrafts[shipment.id] || '').trim();
    if (address.length < 10) {
      Alert.alert('Delivery address required', 'Enter a complete delivery address before dispatch.');
      return;
    }
    setWorkingId(shipment.id);
    try {
      const result = shipment.delivery_address === address
        ? await OutreachService.dispatchShipment(shipment.id)
        : await OutreachService.setShipmentDeliveryAddress(shipment.id, address);
      if (result.dispatch_pending) {
        Alert.alert('Address saved; dispatch pending', result.dispatch_error || 'The provider did not accept the dispatch. You can retry from this screen.');
      }
      await load();
    } catch (error: any) {
      Alert.alert(shipment.delivery_address ? 'Dispatch is still pending' : 'Could not save delivery address', error?.message || 'Please try again.');
    } finally {
      setWorkingId(null);
    }
  };

  const confirmPickup = (shipment: any) => Alert.alert(
    'Confirm pickup',
    'Has the dispatch company collected this product?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setWorkingId(shipment.id);
          try {
            await OutreachService.confirmPickup(shipment.id);
            await load();
          } catch (error: any) {
            Alert.alert('Could not update shipment', error?.message || 'Please try again.');
          } finally {
            setWorkingId(null);
          }
        },
      },
    ],
  );

  return (
    <FeatureGate flag="shipping_ui" message="This area is currently unavailable.">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <ArrowLeft color={c.text} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Orders & Shipping</Text>
          <Truck color={c.cyan} size={20} />
        </View>
        {loading && shipments.length === 0 ? (
          <ActivityIndicator color={c.cyan} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.cyan} />}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle}>Track physical-product dispatch and delivery progress.</Text>
            {shipments.length === 0 ? (
              <View style={styles.empty}>
                <Box color={c.muted} size={30} />
                <Text style={styles.muted}>No shipments yet</Text>
              </View>
            ) : shipments.map((shipment) => {
              const status = String(shipment.status || 'awaiting_dispatch');
              const canConfirmPickup = Boolean(shipment.pickup_details?.provider_id)
                && !['awaiting_dispatch', 'in_transit', 'delivered', 'cancelled'].includes(status);
              return (
                <View key={shipment.id} style={styles.card}>
                  <View style={styles.row}>
                    <View style={styles.icon}><Truck color={c.cyan} size={19} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.status}>{status.replace(/_/g, ' ')}</Text>
                      <Text style={styles.meta}>{shipment.carrier || 'Carrier pending'}{shipment.tracking_number ? ` · ${shipment.tracking_number}` : ''}</Text>
                    </View>
                  </View>
                  <View style={styles.line}>
                    <MapPin color={c.muted} size={15} />
                    <Text style={styles.address}>Pickup: {shipment.pickup_address || 'Pickup address pending'}</Text>
                  </View>
                  {status === 'awaiting_dispatch' ? (
                    <View style={styles.addressForm}>
                      <Text style={styles.formLabel}>Buyer delivery address</Text>
                      <Text style={styles.meta}>
                        {shipment.delivery_address
                          ? 'Check or edit the buyer’s address. Saving it will request or retry dispatch.'
                          : 'Dispatch will not start until you enter and save the buyer’s complete address.'}
                      </Text>
                      <TextInput
                        value={addressDrafts[shipment.id] || ''}
                        onChangeText={(value) => setAddressDrafts((current) => ({ ...current, [shipment.id]: value }))}
                        placeholder="Street, area, city, region and postal code"
                        placeholderTextColor="#64748B"
                        multiline
                        accessibilityLabel="Buyer delivery address"
                        style={styles.input}
                      />
                      <TouchableOpacity
                        style={[styles.button, workingId === shipment.id && styles.buttonDisabled]}
                        onPress={() => saveAddressAndDispatch(shipment)}
                        disabled={workingId === shipment.id}
                        accessibilityRole="button"
                      >
                        <Text style={styles.buttonText}>
                          {workingId === shipment.id ? 'Saving…' : shipment.delivery_address ? 'Save address & retry dispatch' : 'Save address & dispatch'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : shipment.delivery_address ? (
                    <View style={styles.line}>
                      <MapPin color={c.cyan} size={15} />
                      <Text style={styles.address}>Delivery: {shipment.delivery_address}</Text>
                    </View>
                  ) : (
                    <View style={styles.line}>
                      <MapPin color={c.amber} size={15} />
                      <Text style={styles.address}>Delivery address was not recorded.</Text>
                    </View>
                  )}
                  {Array.isArray(shipment.tracking_events) && shipment.tracking_events.length > 0 && (
                    <View style={styles.event}>
                      <CheckCircle2 color={c.green} size={15} />
                      <Text style={styles.meta}>{shipment.tracking_events[shipment.tracking_events.length - 1].status}</Text>
                    </View>
                  )}
                  {canConfirmPickup && (
                    <TouchableOpacity style={styles.button} onPress={() => confirmPickup(shipment)} accessibilityRole="button">
                      <Text style={styles.buttonText}>Confirm pickup</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </FeatureGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { flex: 1, color: c.text, fontSize: 20, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { color: c.muted, marginBottom: 16 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 15, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 11, backgroundColor: `${c.cyan}15`, alignItems: 'center', justifyContent: 'center' },
  status: { color: c.text, fontWeight: '800', textTransform: 'capitalize' },
  meta: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  line: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' },
  address: { color: c.text, flex: 1, lineHeight: 19 },
  addressForm: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border },
  formLabel: { color: c.text, fontSize: 13, fontWeight: '700' },
  input: { minHeight: 82, color: c.text, backgroundColor: c.bg, borderRadius: 8, borderWidth: 1, borderColor: c.border, marginTop: 10, padding: 10, textAlignVertical: 'top' },
  event: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  button: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: c.cyan, alignItems: 'center' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#04121A', fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  muted: { color: c.muted },
});
