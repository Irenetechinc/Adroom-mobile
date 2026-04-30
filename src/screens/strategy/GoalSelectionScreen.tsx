import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, ArrowRight, DollarSign, Eye, Tag, Rocket, MapPin, RefreshCw, Users, Lock,
} from 'lucide-react-native';
import { useEnergyStore } from '../../store/energyStore';

const COLORS = {
  bg: '#0B0F19', card: '#151B2B', border: '#1E293B',
  neon: '#00F0FF', purple: '#7C3AED', text: '#E2E8F0', muted: '#64748B',
};

const GOALS = [
  {
    id: 'sales', name: 'Sales & Conversions', icon: DollarSign,
    description: 'Drive direct purchases of your product.', color: '#10B981', proOnly: true,
  },
  {
    id: 'awareness', name: 'Brand Awareness', icon: Eye,
    description: 'Get maximum visibility for your product.', color: '#3B82F6', proOnly: false,
  },
  {
    id: 'promotional', name: 'Promotional Offer', icon: Tag,
    description: 'Promote a special offer or discount.', color: '#F59E0B', proOnly: false,
  },
  {
    id: 'launch', name: 'Product Launch', icon: Rocket,
    description: 'Launch a new product to market.', color: '#8B5CF6', proOnly: false,
  },
  {
    id: 'local', name: 'Local Traffic', icon: MapPin,
    description: 'Target customers in specific locations.', color: '#EF4444', proOnly: false,
  },
  {
    id: 'retargeting', name: 'Retargeting', icon: RefreshCw,
    description: 'Re-engage people who showed interest.', color: '#EC4899', proOnly: false,
  },
  {
    id: 'leads', name: 'Lead Generation', icon: Users,
    description: 'Collect emails or signups.', color: '#06B6D4', proOnly: true,
  },
];

export default function GoalSelectionScreen() {
  const navigation = useNavigation<any>();
  const { selectedGoal, setSelectedGoal } = useStrategyCreationStore();
  const { subscription } = useEnergyStore();

  const plan = subscription?.plan ?? 'none';
  const isProOrAbove = subscription?.status === 'active' && (plan === 'pro' || plan === 'pro_plus');

  const handleNext = () => {
    if (!selectedGoal) return;
    navigation.navigate('StrategyWizard_DurationSelection');
  };

  const handleGoalPress = (goal: typeof GOALS[0]) => {
    if (goal.proOnly && !isProOrAbove) {
      navigation.navigate('Subscription', { scrollToPlan: 'pro' });
      return;
    }
    setSelectedGoal(goal.id);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Step 2: Select Goal</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={styles.subtitle}>What is the primary objective for this campaign?</Text>

        {GOALS.map((goal) => {
          const Icon = goal.icon;
          const isSelected = selectedGoal === goal.id;
          const isLocked = goal.proOnly && !isProOrAbove;

          return (
            <TouchableOpacity
              key={goal.id}
              onPress={() => handleGoalPress(goal)}
              activeOpacity={0.75}
              style={[
                styles.goalCard,
                isSelected && { borderColor: COLORS.neon, backgroundColor: 'rgba(0,240,255,0.05)' },
                isLocked && { borderColor: COLORS.border, opacity: 0.65 },
              ]}
            >
              <View style={[styles.goalIconWrap, { backgroundColor: `${goal.color}20` }]}>
                <Icon size={24} color={isLocked ? COLORS.muted : isSelected ? COLORS.neon : goal.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <Text style={[styles.goalName, isSelected && { color: '#FFFFFF' }, isLocked && { color: COLORS.muted }]}>
                    {goal.name}
                  </Text>
                  {isLocked && (
                    <View style={styles.proBadge}>
                      <Lock size={9} color={COLORS.purple} />
                      <Text style={styles.proBadgeText}>Pro</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.goalDesc}>
                  {isLocked ? 'Available on Pro & Pro+ plans — tap to upgrade.' : goal.description}
                </Text>
              </View>
              {isSelected && !isLocked && (
                <View style={styles.checkCircle}>
                  <ArrowRight size={14} color="#000" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleNext}
          disabled={!selectedGoal}
          style={[styles.nextBtn, !selectedGoal && { backgroundColor: '#1E293B' }]}
        >
          <Text style={[styles.nextBtnText, !selectedGoal && { color: '#475569' }]}>
            Continue to Duration
          </Text>
          <ArrowRight size={20} color={selectedGoal ? '#020617' : '#64748B'} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { marginRight: 14 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  goalCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: 16,
    borderWidth: 1.5, borderColor: COLORS.border,
    padding: 14, marginBottom: 10, gap: 12,
  },
  goalIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  goalName: { color: '#CBD5E1', fontWeight: '700', fontSize: 15 },
  goalDesc: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(124,58,237,0.15)', borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)', borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  proBadgeText: { color: COLORS.purple, fontSize: 10, fontWeight: '700' },
  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.neon, alignItems: 'center', justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  nextBtn: {
    backgroundColor: COLORS.neon, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  nextBtnText: { color: '#020617', fontWeight: '800', fontSize: 16 },
});
