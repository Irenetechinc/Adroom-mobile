import React, { useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useCampaignStore } from '../store/campaignStore';
import { DrawerActions } from '@react-navigation/native';
import { Plus, Menu, Radio, Clock, ChevronRight, Megaphone } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  ACTIVE: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', dot: '#10B981' },
  PAUSED: { bg: 'rgba(245,158,11,0.12)', text: '#FCD34D', dot: '#F59E0B' },
  ARCHIVED: { bg: 'rgba(148,163,184,0.1)', text: '#94A3B8', dot: '#64748B' },
  DEFAULT: { bg: 'rgba(100,116,139,0.1)', text: '#94A3B8', dot: '#64748B' },
};

function CampaignCard({ item, index, onPress }: { item: any; index: number; onPress: () => void }) {
  const colors = STATUS_COLORS[item.status] || STATUS_COLORS.DEFAULT;
  const objective = item.objective?.replace('OUTCOME_', '').replace(/_/g, ' ') || 'Campaign';

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <TouchableOpacity onPress={onPress} style={styles.card} activeOpacity={0.8}>
        <View style={styles.cardLeft}>
          <View style={styles.cardIcon}>
            <Megaphone size={18} color="#00F0FF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardObjective}>{objective}</Text>
            {item.facebook_campaign_id && (
              <Text style={styles.cardId} numberOfLines={1}>ID: {item.facebook_campaign_id}</Text>
            )}
          </View>
        </View>

        <View style={styles.cardRight}>
          <View style={[styles.badge, { backgroundColor: colors.bg }]}>
            <View style={[styles.badgeDot, { backgroundColor: colors.dot }]} />
            <Text style={[styles.badgeText, { color: colors.text }]}>{item.status}</Text>
          </View>
          <ChevronRight size={16} color="#334155" style={{ marginTop: 8 }} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CampaignListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { campaigns, isLoading, fetchCampaigns } = useCampaignStore();

  useEffect(() => { fetchCampaigns(); }, []);

  const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.menuBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Campaigns</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: false })}
          style={styles.addBtn}
          activeOpacity={0.85}
        >
          <Plus size={20} color="#0B0F19" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Summary bar */}
      {!isLoading && campaigns.length > 0 && (
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.summaryBar}>
          {[
            { icon: Radio, label: 'Active', value: activeCampaigns.length, color: '#10B981' },
            { icon: Clock, label: 'Total', value: campaigns.length, color: '#00F0FF' },
          ].map(({ icon: Icon, label, value, color }, i) => (
            <View key={i} style={[styles.summaryItem, i === 0 && styles.summaryBorder]}>
              <Icon size={14} color={color} style={{ marginRight: 6 }} />
              <Text style={[styles.summaryValue, { color }]}>{value}</Text>
              <Text style={styles.summaryLabel}>{label}</Text>
            </View>
          ))}
        </Animated.View>
      )}

      {isLoading && campaigns.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#00F0FF" />
          <Text style={styles.loadingText}>Fetching campaigns...</Text>
        </View>
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <CampaignCard
              item={item}
              index={index}
              onPress={() => {}}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={fetchCampaigns} tintColor="#00F0FF" />
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Megaphone size={32} color="#1E293B" />
              </View>
              <Text style={styles.emptyTitle}>No campaigns yet</Text>
              <Text style={styles.emptySubtitle}>
                Ask the AdRoom Agent to create your first campaign strategy.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: false })}
                style={styles.emptyBtn}
                activeOpacity={0.85}
              >
                <Plus size={18} color="#0B0F19" />
                <Text style={styles.emptyBtnText}>Start with Agent</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
  },
  menuBtn: { marginRight: 14, padding: 2 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  addBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#00F0FF', alignItems: 'center', justifyContent: 'center',
  },
  summaryBar: {
    flexDirection: 'row', backgroundColor: '#151B2B',
    marginHorizontal: 16, marginVertical: 12, borderRadius: 14,
    borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  summaryItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  summaryBorder: { borderRightWidth: 1, borderRightColor: '#1E293B' },
  summaryValue: { fontWeight: '800', fontSize: 16, marginRight: 6 },
  summaryLabel: { color: '#64748B', fontSize: 12, fontWeight: '500' },
  list: { padding: 16, paddingTop: 4 },
  card: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B',
    flexDirection: 'row', alignItems: 'center',
    padding: 14, marginBottom: 10,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cardIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  cardName: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  cardObjective: { color: '#64748B', fontSize: 12, textTransform: 'capitalize', marginBottom: 2 },
  cardId: { color: '#334155', fontSize: 10 },
  cardRight: { alignItems: 'flex-end', marginLeft: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 5 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#475569', marginTop: 12, fontSize: 13 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 24,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 17, marginBottom: 8 },
  emptySubtitle: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  emptyBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 14, marginLeft: 8 },
});
