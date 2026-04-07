import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Zap, Calendar, TrendingUp } from 'lucide-react-native';
import { ProductService } from '../../services/product';
import { StrategyService } from '../../services/strategy';
import { getCurrencySymbol } from '../../constants/currencies';

const COLORS = {
  bg: '#0B0F19', card: '#151B2B', border: '#1E293B',
  neon: '#00F0FF', amber: '#F59E0B', blue: '#3B82F6', green: '#10B981',
  text: '#E2E8F0', muted: '#64748B',
};

const DURATIONS = [
  {
    days: 7,
    label: '7 Days',
    description: 'Quick test. Best for flash sales or validating a new idea.',
    reachEstimate: '500–2,000',
    icon: Zap,
    color: COLORS.amber,
  },
  {
    days: 14,
    label: '14 Days',
    description: 'Standard duration. Good balance of data gathering and results.',
    reachEstimate: '1,500–6,000',
    icon: Calendar,
    color: COLORS.blue,
  },
  {
    days: 30,
    label: '30 Days',
    description: 'Comprehensive campaign. Allows for full optimization and scaling.',
    reachEstimate: '4,000–15,000',
    icon: TrendingUp,
    color: COLORS.green,
  },
];

export default function DurationSelectionScreen() {
  const navigation = useNavigation<any>();
  const { productData, selectedGoal, selectedDuration, setSelectedDuration, setGeneratedStrategies } = useStrategyCreationStore();
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const currencySymbol = getCurrencySymbol(productData.currency || 'USD');
  const currencyCode = productData.currency || 'USD';
  const productPrice = productData.price ? `${currencySymbol}${productData.price}` : null;

  const handleGenerate = async () => {
    if (!selectedDuration) {
      Alert.alert('Selection Required', 'Please select a campaign duration.');
      return;
    }

    setLoading(true);
    setLoadingMessage('Saving product details...');

    try {
      const productId = await ProductService.saveProduct(productData);
      setLoadingMessage('AI Brain is generating your strategy...');
      const strategies = await StrategyService.generateStrategies(productId, selectedGoal!, selectedDuration);
      setGeneratedStrategies(strategies);
      navigation.navigate('StrategyWizard_Comparison');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate strategy. Please try again.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={24} color={COLORS.muted} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Step 3: Duration</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, paddingTop: 16 }}>
        <Text style={styles.subtitle}>How long should this campaign run?</Text>

        {/* Product summary */}
        {productData.name ? (
          <View style={styles.productSummary}>
            <Text style={styles.productSummaryLabel}>Campaign for:</Text>
            <Text style={styles.productSummaryName} numberOfLines={1}>{productData.name}</Text>
            {productPrice && (
              <Text style={styles.productSummaryPrice}>
                Price: <Text style={{ color: COLORS.neon }}>{productPrice}</Text>
                {' '}<Text style={{ color: COLORS.muted, fontSize: 11 }}>({currencyCode})</Text>
              </Text>
            )}
            {selectedGoal && (
              <Text style={styles.productSummaryGoal}>
                Goal: <Text style={{ color: COLORS.amber, textTransform: 'capitalize' }}>{selectedGoal.replace(/_/g, ' ')}</Text>
              </Text>
            )}
          </View>
        ) : null}

        {/* Duration options */}
        <View style={{ gap: 12 }}>
          {DURATIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = selectedDuration === option.days;
            return (
              <TouchableOpacity
                key={option.days}
                onPress={() => setSelectedDuration(option.days)}
                style={[
                  styles.durationCard,
                  isSelected && { borderColor: option.color, backgroundColor: `${option.color}0D` },
                ]}
                activeOpacity={0.8}
              >
                <View style={[styles.durationIcon, { backgroundColor: isSelected ? `${option.color}20` : COLORS.card }]}>
                  <Icon size={24} color={isSelected ? option.color : COLORS.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.durationLabel, { color: isSelected ? COLORS.text : '#94A3B8' }]}>
                    {option.label}
                  </Text>
                  <Text style={styles.durationDesc}>{option.description}</Text>
                  <Text style={styles.reachEstimate}>
                    Est. organic reach: <Text style={{ color: option.color }}>{option.reachEstimate} people</Text>
                  </Text>
                </View>
                {isSelected && (
                  <View style={[styles.selectedDot, { backgroundColor: option.color }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Currency note */}
        <View style={styles.currencyNote}>
          <Text style={styles.currencyNoteText}>
            Strategy insights and projections are tailored for your market currency:{' '}
            <Text style={{ color: COLORS.neon, fontWeight: '700' }}>{currencyCode}</Text>
          </Text>
        </View>
      </ScrollView>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.neon} />
          <Text style={styles.loadingText}>{loadingMessage}</Text>
          <Text style={styles.loadingSubtext}>Analyzing market data & trends...</Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={!selectedDuration || loading}
          style={[styles.generateBtn, !selectedDuration && styles.generateBtnDisabled]}
        >
          {loading ? (
            <Text style={styles.generateBtnText}>Processing...</Text>
          ) : (
            <>
              <Text style={[styles.generateBtnText, !selectedDuration && { color: COLORS.muted }]}>
                Generate Strategy
              </Text>
              <Zap size={20} color={selectedDuration ? '#020617' : COLORS.muted} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.muted, fontSize: 14, marginBottom: 16 },
  productSummary: {
    backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1,
    borderColor: COLORS.border, padding: 14, marginBottom: 20,
  },
  productSummaryLabel: { color: COLORS.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  productSummaryName: { color: COLORS.text, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  productSummaryPrice: { color: COLORS.muted, fontSize: 13, marginBottom: 2 },
  productSummaryGoal: { color: COLORS.muted, fontSize: 13 },
  durationCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 16,
    backgroundColor: `${COLORS.card}`, borderWidth: 1.5, borderColor: COLORS.border,
  },
  durationIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  durationLabel: { fontWeight: '700', fontSize: 16, marginBottom: 4 },
  durationDesc: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  reachEstimate: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  selectedDot: { width: 10, height: 10, borderRadius: 5 },
  currencyNote: {
    marginTop: 20, backgroundColor: COLORS.card, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, padding: 12,
  },
  currencyNoteText: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(11,15,25,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  loadingText: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginTop: 20, textAlign: 'center', paddingHorizontal: 32 },
  loadingSubtext: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  footer: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg,
  },
  generateBtn: {
    backgroundColor: COLORS.neon, paddingVertical: 16, borderRadius: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  generateBtnDisabled: { backgroundColor: COLORS.card },
  generateBtnText: { color: '#020617', fontWeight: '800', fontSize: 16 },
});
