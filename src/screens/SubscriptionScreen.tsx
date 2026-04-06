import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
  Linking, Switch, RefreshControl, StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Zap, Crown, ArrowLeft, CheckCircle, AlertCircle,
  RefreshCw, ChevronRight, Star, Shield, X, Bot, Video, Image as ImageIcon, Globe,
} from 'lucide-react-native';
import { useEnergyStore, PLAN_DETAILS, TOPUP_OPTIONS } from '../store/energyStore';
import Constants from 'expo-constants';

const API_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';

const COLORS = {
  bg: '#0B0F19', card: '#151B2B', border: '#1E293B',
  neon: '#00F0FF', purple: '#7C3AED', amber: '#F59E0B',
  text: '#E2E8F0', muted: '#64748B', danger: '#EF4444',
};

function EnergyBar({ balance, max }: { balance: number; max: number }) {
  const pct = Math.min(1, balance / Math.max(max, 1));
  const color = pct > 0.5 ? COLORS.neon : pct > 0.2 ? COLORS.amber : COLORS.danger;
  return (
    <View style={{ height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

function formatCountdown(ms: number) {
  if (ms <= 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SubscriptionScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const scrollToPlan = route.params?.scrollToPlan ?? null;
  const insets = useSafeAreaInsets();
  const {
    account, subscription, transactions, isLoading,
    fetchEnergy, startTrial, cancelSubscription, toggleOnDemand, verifyAndApplyPayment,
  } = useEnergyStore();
  const [refreshing, setRefreshing] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [tab, setTab] = useState<'plans' | 'topup' | 'usage'>('plans');
  const [countdown, setCountdown] = useState<string | null>(null);
  const [graceActive, setGraceActive] = useState(false);

  useEffect(() => {
    fetchEnergy();
  }, []);

  // 72h grace period countdown: shown when trial just ended (within 72h)
  useEffect(() => {
    if (!subscription?.trial_end) return;
    const trialEndMs = new Date(subscription.trial_end).getTime();
    const graceEndMs = trialEndMs + 72 * 60 * 60 * 1000;
    const now = Date.now();
    if (now >= trialEndMs && now < graceEndMs) {
      setGraceActive(true);
      const tick = () => {
        const remaining = graceEndMs - Date.now();
        if (remaining <= 0) {
          setCountdown('00:00:00');
          clearInterval(interval);
        } else {
          setCountdown(formatCountdown(remaining));
        }
      };
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    } else {
      setGraceActive(false);
      setCountdown(null);
    }
  }, [subscription?.trial_end]);

  // Scroll to pro plan if navigated with param
  useEffect(() => {
    if (scrollToPlan === 'pro') {
      setTab('plans');
    }
  }, [scrollToPlan]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEnergy();
    setRefreshing(false);
  }, []);

  const balance = parseFloat(String(account?.balance_credits ?? '0'));
  const plan = subscription?.plan ?? 'none';
  const planInfo = PLAN_DETAILS[plan];
  const isTrialing = subscription?.status === 'trialing';
  const isActive = subscription?.status === 'active' || isTrialing;

  const trialDaysLeft = subscription?.trial_end
    ? Math.max(0, Math.ceil((new Date(subscription.trial_end).getTime() - Date.now()) / 86400000))
    : null;

  const maxCredits = planInfo?.credits || 100;

  const openFlutterwavePayment = async (amount: number, type: 'subscription' | 'topup', id: string) => {
    try {
      setPaymentLoading(true);
      const { data: { session } } = await (await import('../services/supabase')).supabase.auth.getSession();
      if (!session) { Alert.alert('Error', 'Please sign in again.'); return; }

      const res = await fetch(`${API_URL}/api/billing/payment-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, type, id }),
      });
      const data = await res.json();
      if (!data.payment_url) throw new Error('Could not generate payment link');
      await Linking.openURL(data.payment_url);
      setTimeout(() => {
        Alert.alert(
          'Complete Payment',
          'Once your payment is confirmed, tap Verify to activate your plan.',
          [
            { text: 'Verify Payment', onPress: () => showVerifyDialog(data.tx_ref, type, id) },
            { text: 'Later', style: 'cancel' },
          ],
        );
      }, 2000);
    } catch (err: any) {
      Alert.alert('Payment Error', err.message);
    } finally {
      setPaymentLoading(false);
    }
  };

  const showVerifyDialog = (txRef: string, type: 'subscription' | 'topup', id: string) => {
    Alert.prompt(
      'Enter Transaction ID',
      'Paste the Flutterwave transaction ID from your confirmation email or SMS.',
      async (txId) => {
        if (!txId) return;
        const result = await verifyAndApplyPayment(txId, txRef, type, id);
        if (result.success) {
          Alert.alert('Success!', result.message || `${result.credits} energy credits added.`);
        } else {
          Alert.alert('Verification Failed', result.message || 'Could not verify payment. Contact support.');
        }
      },
      'plain-text',
    );
  };

  const handleStartTrial = async () => {
    if (!subscription?.flw_card_last4 && !subscription?.billing_email) {
      Alert.alert(
        'Add Payment Method First',
        'You need a payment method before starting your free trial. You will not be charged for 14 days.',
        [
          { text: 'Add Payment Method', onPress: () => openFlutterwavePayment(1, 'subscription', 'starter') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    const result = await startTrial();
    Alert.alert(result.success ? 'Trial Started!' : 'Error', result.message);
  };

  const handleSubscribe = (planId: string) => {
    const p = PLAN_DETAILS[planId];
    Alert.alert(
      `Subscribe to ${p.name}`,
      `${p.credits} energy credits per month.\n\nYou'll be redirected to complete payment securely.`,
      [
        { text: 'Proceed to Payment', onPress: () => openFlutterwavePayment(p.price, 'subscription', planId) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleTopUp = (pack: typeof TOPUP_OPTIONS[0]) => {
    Alert.alert(
      `Buy ${pack.label}`,
      `Add ${pack.credits} energy credits.\n\nInstant credit after payment.`,
      [
        { text: 'Buy Now', onPress: () => openFlutterwavePayment(pack.price, 'topup', pack.id) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleCancel = async () => {
    setShowCancelModal(false);
    const result = await cancelSubscription('user_requested');
    Alert.alert(
      result.success ? 'Subscription Cancelled' : 'Error',
      result.success ? 'Your subscription has been cancelled.' : 'Please try again.',
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={COLORS.neon} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Zap size={20} color={COLORS.amber} />
          <Text style={styles.headerTitle}>AdRoom Energy</Text>
        </View>
        <TouchableOpacity onPress={onRefresh}>
          <RefreshCw size={18} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* Energy Balance Card */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.balanceCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={styles.balanceLabel}>Current Balance</Text>
              <Text style={styles.balanceValue}>{balance.toFixed(1)}</Text>
              <Text style={styles.balanceUnit}>Energy Credits</Text>
            </View>
            <View style={styles.planBadge}>
              <Crown size={12} color={planInfo?.color ?? COLORS.muted} />
              <Text style={[styles.planBadgeText, { color: planInfo?.color ?? COLORS.muted }]}>
                {planInfo?.name ?? 'No Plan'}
              </Text>
            </View>
          </View>
          <EnergyBar balance={balance} max={maxCredits} />
          <View style={styles.balanceMeta}>
            <Text style={styles.metaText}>{balance.toFixed(1)} credits remaining</Text>
            {isTrialing && trialDaysLeft !== null && (
              <View style={styles.trialBadge}>
                <Text style={styles.trialBadgeText}>Trial: {trialDaysLeft}d left</Text>
              </View>
            )}
            {isActive && !isTrialing && (
              <View style={[styles.trialBadge, { backgroundColor: '#00F0FF20' }]}>
                <Text style={[styles.trialBadgeText, { color: COLORS.neon }]}>Active</Text>
              </View>
            )}
          </View>

          {/* 72h Grace Countdown */}
          {graceActive && countdown && (
            <View style={[styles.warningBox, { backgroundColor: '#7C3AED20', borderColor: '#7C3AED50' }]}>
              <AlertCircle size={14} color={COLORS.purple} />
              <Text style={[styles.warningText, { color: COLORS.purple }]}>
                Trial ended — billing starts in {countdown}. Upgrade to keep access.
              </Text>
            </View>
          )}

          {balance < 10 && (
            <View style={styles.warningBox}>
              <AlertCircle size={14} color={COLORS.amber} />
              <Text style={styles.warningText}>Low energy! AI features will stop when balance reaches 0.</Text>
            </View>
          )}
          {balance <= 0 && (
            <View style={[styles.warningBox, { backgroundColor: '#EF444420', borderColor: COLORS.danger }]}>
              <AlertCircle size={14} color={COLORS.danger} />
              <Text style={[styles.warningText, { color: COLORS.danger }]}>
                No energy! All AI features & agents are paused. Top up to continue.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['plans', 'topup', 'usage'] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'plans' ? 'Plans' : t === 'topup' ? 'Top Up' : 'Usage'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─── PLANS TAB ─────────────────────────────────────── */}
        {tab === 'plans' && (
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            {/* Trial Banner */}
            {!isActive && (
              <View style={styles.trialBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.trialTitle}>14-Day Free Trial</Text>
                  <Text style={styles.trialDesc}>
                    Start free — <Text style={{ color: COLORS.neon, fontWeight: '700' }}>$0/month for 14 days</Text>, then $20/month.{'\n'}
                    No charge during trial. Cancel anytime.
                  </Text>
                </View>
                <TouchableOpacity onPress={handleStartTrial} style={styles.trialBtn}>
                  <Text style={styles.trialBtnText}>Try Free</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Plan Cards */}
            {(['starter', 'pro', 'pro_plus'] as const).map((planId, idx) => {
              const p = PLAN_DETAILS[planId];
              const isCurrent = plan === planId && isActive;
              const isPopular = planId === 'pro';
              const isHighlighted = scrollToPlan === planId;
              return (
                <Animated.View key={planId} entering={FadeInDown.delay(idx * 80).duration(400)}>
                  <TouchableOpacity
                    onPress={() => !isCurrent && handleSubscribe(planId)}
                    style={[
                      styles.planCard,
                      isCurrent && { borderColor: p.color },
                      isHighlighted && !isCurrent && { borderColor: p.color, borderWidth: 2 },
                    ]}
                    activeOpacity={isCurrent ? 1 : 0.8}
                  >
                    {isPopular && (
                      <View style={[styles.popularBadge, { backgroundColor: p.color }]}>
                        <Star size={10} color="#000" />
                        <Text style={styles.popularText}>Most Popular</Text>
                      </View>
                    )}

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View>
                        <Text style={[styles.planName, { color: p.color }]}>{p.name}</Text>
                        {/* Starter shows $0 during trial hint, $20 after */}
                        {planId === 'starter' ? (
                          <View>
                            <Text style={styles.planPrice}>
                              {!isActive ? (
                                <><Text style={{ color: COLORS.neon }}>$0</Text><Text style={styles.planPer}> /14 days trial</Text></>
                              ) : (
                                <>$20<Text style={styles.planPer}>/mo</Text></>
                              )}
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.planPrice}>${p.price}<Text style={styles.planPer}>/mo</Text></Text>
                        )}
                      </View>
                      <View style={styles.energyBadge}>
                        <Zap size={12} color={p.color} />
                        <Text style={[styles.energyBadgeText, { color: p.color }]}>{p.credits} Energy</Text>
                      </View>
                    </View>

                    <View style={styles.planFeatures}>
                      {p.features.map((feat, fi) => (
                        <FeatureRow key={fi} color={p.color} text={feat} />
                      ))}

                      {/* Agents */}
                      <View style={{ marginTop: 6 }}>
                        <AgentRow label="Sales Agent" available={p.agents.sales} color={p.color} />
                        <AgentRow label="Awareness Agent" available={p.agents.awareness} color={p.color} />
                        <AgentRow label="Promotion Agent" available={p.agents.promotion} color={p.color} />
                        <AgentRow label="Launch Agent" available={p.agents.launch} color={p.color} />
                      </View>
                    </View>

                    {isCurrent ? (
                      <View style={[styles.planBtn, { backgroundColor: p.color + '20', borderColor: p.color }]}>
                        <CheckCircle size={14} color={p.color} />
                        <Text style={[styles.planBtnText, { color: p.color }]}>Current Plan</Text>
                      </View>
                    ) : (
                      <View style={[styles.planBtn, { backgroundColor: p.color }]}>
                        <Text style={[styles.planBtnText, { color: '#000' }]}>
                          {paymentLoading ? 'Processing...' : (planId === 'starter' ? 'Start Free Trial' : 'Subscribe')}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })}

            {/* On-Demand */}
            <View style={styles.sectionCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Auto Top-Up (On-Demand)</Text>
                  <Text style={styles.sectionDesc}>
                    Automatically purchase 100 energy credits when balance hits 25 credits.
                    Requires saved payment method.
                  </Text>
                </View>
                <Switch
                  value={account?.on_demand_enabled ?? false}
                  onValueChange={toggleOnDemand}
                  trackColor={{ false: COLORS.border, true: COLORS.neon + '80' }}
                  thumbColor={account?.on_demand_enabled ? COLORS.neon : COLORS.muted}
                />
              </View>
            </View>

            {isActive && !isTrialing && (
              <TouchableOpacity onPress={() => setShowCancelModal(true)} style={styles.cancelLink}>
                <Text style={styles.cancelText}>Cancel Subscription</Text>
              </TouchableOpacity>
            )}
            {isTrialing && (
              <TouchableOpacity onPress={() => setShowCancelModal(true)} style={styles.cancelLink}>
                <Text style={styles.cancelText}>Cancel Trial</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* ─── TOP UP TAB ────────────────────────────────────── */}
        {tab === 'topup' && (
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <Text style={styles.sectionHeader}>One-time Energy Packs</Text>
            {TOPUP_OPTIONS.map((pack, idx) => (
              <Animated.View key={pack.id} entering={FadeInDown.delay(idx * 80).duration(400)}>
                <TouchableOpacity onPress={() => handleTopUp(pack)} style={styles.topupCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={styles.topupIcon}>
                      <Zap size={20} color={COLORS.amber} />
                    </View>
                    <View>
                      <Text style={styles.topupLabel}>{pack.label}</Text>
                      <Text style={styles.topupValue}>{pack.credits} energy credits</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.topupPrice}>${pack.price}</Text>
                    {pack.best && (
                      <View style={styles.bestBadge}>
                        <Text style={styles.bestBadgeText}>Best Value</Text>
                      </View>
                    )}
                  </View>
                  <ChevronRight size={16} color={COLORS.muted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              </Animated.View>
            ))}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Energy Powers Everything</Text>
              <Text style={styles.sectionDesc}>
                Energy credits fuel all AI operations: strategy generation, product scanning,
                content creation, and autonomous agents. When balance reaches 0, all AI features pause.
              </Text>
            </View>
          </Animated.View>
        )}

        {/* ─── USAGE TAB ─────────────────────────────────────── */}
        {tab === 'usage' && (
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <View style={styles.usageStats}>
              <UsageStat label="Total Purchased" value={parseFloat(String(account?.lifetime_credits ?? '0')).toFixed(0)} unit="credits" />
              <UsageStat label="Total Consumed" value={parseFloat(String(account?.lifetime_consumed ?? '0')).toFixed(1)} unit="credits" />
              <UsageStat label="Operations Run" value={`${Math.round(parseFloat(String(account?.lifetime_consumed ?? '0')))}`} unit="" />
            </View>

            <Text style={styles.sectionHeader}>Transaction History</Text>
            {transactions.length === 0 ? (
              <View style={styles.emptyState}>
                <Zap size={32} color={COLORS.muted} />
                <Text style={styles.emptyText}>No transactions yet</Text>
              </View>
            ) : (
              transactions.map((tx) => (
                <View key={tx.id} style={styles.txRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txDesc} numberOfLines={1}>{tx.description || tx.operation || tx.type}</Text>
                    <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.txAmount, { color: tx.credits >= 0 ? COLORS.neon : COLORS.danger }]}>
                    {tx.credits >= 0 ? '+' : ''}{parseFloat(String(tx.credits)).toFixed(1)}
                  </Text>
                </View>
              ))
            )}
          </Animated.View>
        )}
      </ScrollView>

      {/* Cancel Modal */}
      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity onPress={() => setShowCancelModal(false)} style={styles.modalClose}>
              <X size={20} color={COLORS.muted} />
            </TouchableOpacity>
            <AlertCircle size={40} color={COLORS.danger} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.modalTitle}>Cancel Subscription?</Text>
            <Text style={styles.modalDesc}>
              Your remaining energy credits stay active until{' '}
              {subscription?.current_period_end
                ? new Date(subscription.current_period_end).toLocaleDateString()
                : 'end of billing period'}. After that, AI features will pause.
            </Text>
            <TouchableOpacity onPress={handleCancel} style={styles.modalDanger}>
              <Text style={styles.modalDangerText}>Yes, Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCancelModal(false)} style={styles.modalSecondary}>
              <Text style={styles.modalSecondaryText}>Keep Subscription</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FeatureRow({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
      <CheckCircle size={13} color={color} style={{ marginTop: 1 }} />
      <Text style={{ color: COLORS.text, fontSize: 12, flex: 1 }}>{text}</Text>
    </View>
  );
}

function AgentRow({ label, available, color }: { label: string; available: boolean; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <Bot size={13} color={available ? color : COLORS.muted} />
      <Text style={{ color: available ? COLORS.text : COLORS.muted, fontSize: 12, flex: 1 }}>
        {label}
      </Text>
      {!available && (
        <View style={{ backgroundColor: '#EF444420', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: COLORS.danger, fontSize: 10 }}>Not included</Text>
        </View>
      )}
    </View>
  );
}

function UsageStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.usageStatItem}>
      <Text style={styles.usageStatValue}>{value} <Text style={styles.usageStatUnit}>{unit}</Text></Text>
      <Text style={styles.usageStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  balanceCard: { margin: 16, padding: 20, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  balanceLabel: { color: COLORS.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  balanceValue: { color: COLORS.amber, fontSize: 48, fontWeight: '900', letterSpacing: -2, marginTop: 2 },
  balanceUnit: { color: COLORS.muted, fontSize: 13, marginTop: -4 },
  planBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  planBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  balanceMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  metaText: { color: COLORS.muted, fontSize: 12 },
  trialBadge: { backgroundColor: '#F59E0B20', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  trialBadgeText: { color: COLORS.amber, fontSize: 11, fontWeight: '600' },
  warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B15', borderWidth: 1, borderColor: '#F59E0B40', borderRadius: 8, padding: 10, marginTop: 12 },
  warningText: { color: COLORS.amber, fontSize: 12, flex: 1 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: COLORS.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: COLORS.bg },
  tabText: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: COLORS.text },
  trialBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#00F0FF10', borderWidth: 1, borderColor: '#00F0FF30', borderRadius: 16, padding: 16, gap: 12 },
  trialTitle: { color: COLORS.neon, fontWeight: '800', fontSize: 15, marginBottom: 4 },
  trialDesc: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  trialBtn: { backgroundColor: COLORS.neon, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  trialBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  planCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16, overflow: 'hidden' },
  popularBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, position: 'absolute', top: 0, right: 0, paddingHorizontal: 10, paddingVertical: 5, borderBottomLeftRadius: 12 },
  popularText: { color: '#000', fontSize: 10, fontWeight: '800' },
  planName: { fontSize: 18, fontWeight: '800' },
  planPrice: { color: COLORS.text, fontSize: 24, fontWeight: '900', marginTop: 2 },
  planPer: { color: COLORS.muted, fontSize: 13, fontWeight: '400' },
  energyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  energyBadgeText: { fontSize: 12, fontWeight: '700' },
  planFeatures: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border },
  planBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  planBtnText: { fontWeight: '700', fontSize: 14 },
  sectionCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  sectionTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14, marginBottom: 6 },
  sectionDesc: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  sectionHeader: { color: COLORS.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 16, marginBottom: 10, marginTop: 4 },
  cancelLink: { alignItems: 'center', paddingVertical: 14, marginHorizontal: 16 },
  cancelText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  topupCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  topupIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F59E0B15', alignItems: 'center', justifyContent: 'center' },
  topupLabel: { color: COLORS.text, fontWeight: '700', fontSize: 15 },
  topupValue: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  topupPrice: { color: COLORS.amber, fontWeight: '800', fontSize: 18 },
  bestBadge: { backgroundColor: '#F59E0B20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  bestBadgeText: { color: COLORS.amber, fontSize: 10, fontWeight: '700' },
  usageStats: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 16, gap: 8 },
  usageStatItem: { flex: 1, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14, alignItems: 'center' },
  usageStatValue: { color: COLORS.neon, fontSize: 20, fontWeight: '900' },
  usageStatUnit: { color: COLORS.muted, fontSize: 11, fontWeight: '400' },
  usageStatLabel: { color: COLORS.muted, fontSize: 11, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', padding: 32, gap: 10 },
  emptyText: { color: COLORS.muted, fontSize: 14 },
  txRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  txDesc: { color: COLORS.text, fontSize: 13, fontWeight: '500' },
  txDate: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '800', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalClose: { position: 'absolute', top: 16, right: 16, padding: 4 },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  modalDesc: { color: COLORS.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  modalDanger: { backgroundColor: COLORS.danger, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  modalDangerText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  modalSecondary: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  modalSecondaryText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
});
