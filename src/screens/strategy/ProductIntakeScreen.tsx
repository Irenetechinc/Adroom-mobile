import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image, ActivityIndicator,
  TextInput, Alert, StyleSheet, Modal, FlatList,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useStrategyCreationStore } from '../../store/strategyCreationStore';
import { VisionService } from '../../services/vision';
import { VideoAssetService } from '../../services/videoAsset';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Upload, ArrowRight, Video, Globe, Lock,
  ChevronRight, ChevronDown, X, Sparkles, Trash2,
} from 'lucide-react-native';
import { useEnergyStore, PLAN_DETAILS } from '../../store/energyStore';
import { CURRENCIES } from '../../constants/currencies';

const COLORS = {
  bg: '#0B0F19', card: '#151B2B', border: '#1E293B',
  neon: '#00F0FF', purple: '#7C3AED', amber: '#F59E0B',
  green: '#10B981', text: '#E2E8F0', muted: '#64748B', danger: '#EF4444',
};

export default function ProductIntakeScreen() {
  const navigation = useNavigation<any>();
  const { productData, setProductData } = useStrategyCreationStore();
  const { subscription, planLimitsUsage, fetchPlanLimits } = useEnergyStore();
  const [loading, setLoading] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const selectedCurrency = CURRENCIES.find(c => c.code === (productData.currency || 'USD')) ?? CURRENCIES[0];

  const plan = subscription?.plan ?? 'none';
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const planInfo = PLAN_DETAILS[plan];
  const canUseWebsiteScraping = isActive && planInfo?.websiteScraping;
  const canGenerateAiVideo = isActive && planInfo?.aiVideoGen;

  // Real-time limits from backend
  const videoRemaining = planLimitsUsage?.remaining?.videoAssets ?? (canGenerateAiVideo ? planInfo?.videoAssets ?? 0 : 0);
  const videoLimit = planLimitsUsage?.limits?.videoAssets ?? planInfo?.videoAssets ?? 0;
  const videoUsed = planLimitsUsage?.usage?.videoAssets ?? 0;

  useEffect(() => {
    if (isActive) fetchPlanLimits();
  }, [isActive]);

  // ─── Image Picker ───────────────────────────────────────────
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload product images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setProductData({ imageUri: result.assets[0].uri });
      analyzeImage(result.assets[0].uri);
    }
  };

  // ─── Video File Picker (all plans including Starter) ────────
  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need media library permissions to upload videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      videoMaxDuration: 60,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setProductData({ videoUri: result.assets[0].uri });
      Alert.alert(
        'Video Attached',
        'Your product video has been attached. AdRoom AI will use it in your campaign assets.',
        [{ text: 'Great!' }],
      );
    }
  };

  // ─── AI Video Generation (Pro/Pro+ only, server enforced) ───
  const handleGenerateAiVideo = async () => {
    if (!productData.name) {
      Alert.alert('Product Name Required', 'Enter a product name first so AdRoom AI can generate a relevant video.');
      return;
    }
    if (!canGenerateAiVideo) {
      Alert.alert(
        'Pro Feature',
        'AI video generation is available on Pro (2 videos) and Pro+ (4 videos) plans. Starter users can upload their own video above.',
        [
          { text: 'Upgrade to Pro', onPress: () => navigation.navigate('Subscription', { scrollToPlan: 'pro' }) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    if (videoRemaining <= 0) {
      Alert.alert(
        'Video Limit Reached',
        `You've used all ${videoLimit} AI video generation${videoLimit > 1 ? 's' : ''} on your ${planInfo?.name} plan this billing period.`,
        [{ text: 'OK' }],
      );
      return;
    }

    setGeneratingVideo(true);
    try {
      const result = await VideoAssetService.generateVideoAsset(
        productData.name,
        productData.description ? `Marketing video showcasing: ${productData.description}` : undefined,
      );
      setProductData({ videoUri: result.url });
      await fetchPlanLimits();
      Alert.alert('AI Video Ready', `Your video asset has been generated! You have ${result.remaining} video generation${result.remaining !== 1 ? 's' : ''} remaining this period.`);
    } catch (err: any) {
      if (err.code === 'PLAN_LIMIT_EXCEEDED') {
        Alert.alert('Limit Reached', err.message ?? 'Video generation limit reached for your plan.');
      } else {
        Alert.alert('Generation Failed', err.message ?? 'Could not generate video. Please try again.');
      }
    } finally {
      setGeneratingVideo(false);
    }
  };

  // ─── Image Analysis ─────────────────────────────────────────
  const analyzeImage = async (uri: string) => {
    setLoading(true);
    try {
      const attributes = await VisionService.analyzeProductImage(uri);
      setProductData({
        scanResult: attributes,
        name: attributes.name || '',
        description: attributes.description || '',
        price: attributes.estimatedPrice || '',
        category: attributes.category || '',
        targetAudience: attributes.suggested_target_audience || '',
      });
    } catch (error) {
      Alert.alert('Analysis Failed', 'Could not analyze image. Please enter details manually.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (!productData.name || !productData.description) {
      Alert.alert('Missing Information', 'Please provide at least a product name and description.');
      return;
    }
    navigation.navigate('StrategyWizard_GoalSelection');
  };

  const handleUpgradeToPro = () => {
    navigation.navigate('Subscription', { scrollToPlan: 'pro' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.title}>New Strategy Setup</Text>
        <Text style={styles.subtitle}>Step 1: Product Intake</Text>

        {/* ── Image Upload ────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Product Image</Text>
        <TouchableOpacity onPress={pickImage} style={styles.mediaBox}>
          {productData.imageUri ? (
            <Image source={{ uri: productData.imageUri }} style={styles.mediaPreview} resizeMode="cover" />
          ) : (
            <View style={styles.mediaPlaceholder}>
              <Upload size={40} color={COLORS.muted} />
              <Text style={styles.mediaPlaceholderText}>Tap to upload product image</Text>
              <Text style={styles.mediaPlaceholderSub}>AI will scan and extract product details</Text>
            </View>
          )}
          {loading && (
            <View style={styles.analyzeOverlay}>
              <ActivityIndicator size="large" color={COLORS.neon} />
              <Text style={styles.analyzeText}>AI Analyzing Image...</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Video Section ────────────────────────────────────── */}
        <View style={styles.videoSectionHeader}>
          <Text style={styles.sectionLabel}>Product Video</Text>
          <Text style={styles.optionalBadge}>Optional</Text>
        </View>

        {/* Uploaded/Generated Video Preview */}
        {productData.videoUri ? (
          <View style={styles.videoAttachedCard}>
            <Video size={28} color={COLORS.neon} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.videoAttachedTitle}>Video Ready</Text>
              <Text style={styles.videoAttachedSub} numberOfLines={1}>
                {productData.videoUri.startsWith('http') ? 'AI Generated Asset' : productData.videoUri.split('/').pop()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setProductData({ videoUri: null })} style={styles.removeBtn}>
              <Trash2 size={16} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Upload your own video — available to ALL plans */}
        <TouchableOpacity onPress={pickVideo} style={[styles.videoActionBtn, { borderColor: COLORS.border }]}>
          <Upload size={18} color={COLORS.text} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.videoActionBtnTitle}>Upload Your Video</Text>
            <Text style={styles.videoActionBtnSub}>All plans • Max 60 seconds • Any format</Text>
          </View>
          <ChevronRight size={16} color={COLORS.muted} />
        </TouchableOpacity>

        {/* AI Generate Video — gated by plan, enforced on backend */}
        <TouchableOpacity
          onPress={handleGenerateAiVideo}
          disabled={generatingVideo}
          style={[
            styles.videoActionBtn,
            {
              borderColor: canGenerateAiVideo && videoRemaining > 0 ? 'rgba(124,58,237,0.5)' : COLORS.border,
              backgroundColor: canGenerateAiVideo && videoRemaining > 0 ? 'rgba(124,58,237,0.08)' : 'transparent',
              marginTop: 8,
            },
          ]}
        >
          {generatingVideo ? (
            <ActivityIndicator size="small" color={COLORS.purple} />
          ) : (
            <Sparkles size={18} color={canGenerateAiVideo ? COLORS.purple : COLORS.muted} />
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.videoActionBtnTitle, { color: canGenerateAiVideo ? COLORS.text : COLORS.muted }]}>
              {generatingVideo ? 'Generating AI Video...' : 'Generate AI Video'}
            </Text>
            {canGenerateAiVideo ? (
              <Text style={[styles.videoActionBtnSub, { color: videoRemaining > 0 ? COLORS.green : COLORS.danger }]}>
                {videoRemaining > 0
                  ? `${videoRemaining} of ${videoLimit} remaining this period`
                  : `Limit reached — ${videoLimit} used this period`}
              </Text>
            ) : (
              <Text style={styles.videoActionBtnSub}>
                Pro: 2 videos/period • Pro+: 4 videos/period — Starter: upload only
              </Text>
            )}
          </View>
          {!canGenerateAiVideo && (
            <View style={styles.proBadge}>
              <Lock size={10} color={COLORS.purple} />
              <Text style={styles.proBadgeText}>Pro</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Form Fields ─────────────────────────────────────── */}
        <View style={styles.formSection}>
          <FormField
            label="Product Name"
            value={productData.name}
            onChangeText={(text) => setProductData({ name: text })}
            placeholder="e.g. Wireless Noise-Cancelling Headphones"
          />
          <FormField
            label="Category"
            value={productData.category}
            onChangeText={(text) => setProductData({ category: text })}
            placeholder="e.g. Electronics"
          />
          <FormField
            label="Target Audience"
            value={productData.targetAudience}
            onChangeText={(text) => setProductData({ targetAudience: text })}
            placeholder="e.g. Remote workers, audiophiles"
            multiline
            height={88}
          />
          <FormField
            label="Description"
            value={productData.description}
            onChangeText={(text) => setProductData({ description: text })}
            placeholder="Detailed description of your product..."
            multiline
            height={112}
          />

          {/* Price + Currency */}
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.fieldLabel}>Price</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => setShowCurrencyPicker(true)}
                style={[styles.input, {
                  flexDirection: 'row', alignItems: 'center',
                  gap: 4, paddingHorizontal: 12, minWidth: 90,
                }]}
              >
                <Text style={{ color: COLORS.text, fontWeight: '700', fontSize: 14 }}>{selectedCurrency.symbol}</Text>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>{selectedCurrency.code}</Text>
                <ChevronDown size={12} color={COLORS.muted} />
              </TouchableOpacity>
              <TextInput
                value={productData.price}
                onChangeText={(text) => setProductData({ price: text })}
                placeholder="0.00"
                placeholderTextColor={COLORS.muted}
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
          </View>
        </View>

        {/* ── Connect Website ─────────────────────────────────── */}
        <View style={styles.websiteSection}>
          <View style={styles.websiteHeader}>
            <Globe size={18} color={canUseWebsiteScraping ? COLORS.neon : COLORS.muted} />
            <Text style={[styles.websiteTitle, { color: canUseWebsiteScraping ? COLORS.text : COLORS.muted }]}>
              Connect Website
            </Text>
            {!canUseWebsiteScraping && (
              <View style={styles.proBadge}>
                <Lock size={10} color={COLORS.purple} />
                <Text style={styles.proBadgeText}>Pro</Text>
              </View>
            )}
          </View>
          <Text style={styles.websiteDesc}>
            AdRoom AI scrapes your website to enrich product intelligence and tailor your strategy.
          </Text>
          {canUseWebsiteScraping ? (
            <TextInput
              value={productData.websiteUrl}
              onChangeText={(text) => setProductData({ websiteUrl: text })}
              placeholder="https://yourwebsite.com"
              placeholderTextColor={COLORS.muted}
              keyboardType="url"
              autoCapitalize="none"
              style={styles.websiteInput}
            />
          ) : (
            <TouchableOpacity onPress={handleUpgradeToPro} style={styles.upgradeCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.upgradeCardTitle}>Upgrade to Pro to unlock</Text>
                <Text style={styles.upgradeCardSub}>Website scraping included in Pro & Pro+ plans</Text>
              </View>
              <ChevronRight size={18} color={COLORS.purple} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={handleNext} style={styles.nextBtn}>
          <Text style={styles.nextBtnText}>Continue to Goal</Text>
          <ArrowRight size={20} color="#020617" />
        </TouchableOpacity>
      </View>

      {/* Currency Picker Modal */}
      <Modal visible={showCurrencyPicker} transparent animationType="slide">
        <View style={styles.currencyModalOverlay}>
          <View style={styles.currencyModalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: COLORS.text, fontWeight: '800', fontSize: 16 }}>Select Currency</Text>
              <TouchableOpacity onPress={() => setShowCurrencyPicker(false)}>
                <X size={20} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={CURRENCIES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => {
                const isSelected = item.code === selectedCurrency.code;
                return (
                  <TouchableOpacity
                    onPress={() => { setProductData({ currency: item.code }); setShowCurrencyPicker(false); }}
                    style={[styles.currencyRow, isSelected && { backgroundColor: 'rgba(0,240,255,0.08)', borderColor: 'rgba(0,240,255,0.3)' }]}
                  >
                    <Text style={[styles.currencySymbol, { color: isSelected ? COLORS.neon : COLORS.text }]}>{item.symbol}</Text>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: isSelected ? COLORS.neon : COLORS.text, fontWeight: '600', fontSize: 14 }}>{item.code}</Text>
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>{item.name}</Text>
                    </View>
                    {isSelected && <Text style={{ color: COLORS.neon, fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FormField({
  label, value, onChangeText, placeholder, multiline, height, keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  multiline?: boolean;
  height?: number;
  keyboardType?: any;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && { height: height ?? 88 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 20 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginTop: 20, marginBottom: 4 },
  subtitle: { color: COLORS.muted, fontSize: 14, marginBottom: 20 },
  sectionLabel: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  optionalBadge: { color: COLORS.muted, fontWeight: '400', fontSize: 12, marginLeft: 6 },
  videoSectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 16 },
  mediaBox: {
    width: '100%', height: 180, backgroundColor: COLORS.card,
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: COLORS.border, overflow: 'hidden', marginBottom: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  mediaPreview: { width: '100%', height: '100%' },
  mediaPlaceholder: { alignItems: 'center', paddingHorizontal: 20 },
  mediaPlaceholderText: { color: COLORS.muted, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  mediaPlaceholderSub: { color: '#475569', fontSize: 12, marginTop: 4, textAlign: 'center' },
  analyzeOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center',
  },
  analyzeText: { color: COLORS.neon, fontWeight: '700', marginTop: 12 },
  videoAttachedCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,240,255,0.06)', borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.2)', borderRadius: 14,
    padding: 14, marginBottom: 10,
  },
  videoAttachedTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  videoAttachedSub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  removeBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10,
  },
  videoActionBtn: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.card, marginBottom: 4,
  },
  videoActionBtnTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  videoActionBtnSub: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(124,58,237,0.15)', borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)', borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  proBadgeText: { color: COLORS.purple, fontSize: 11, fontWeight: '700' },
  formSection: { marginTop: 20, marginBottom: 8 },
  fieldLabel: { color: '#CBD5E1', fontWeight: '600', fontSize: 13, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.card, color: COLORS.text,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, fontSize: 14,
  },
  websiteSection: {
    backgroundColor: COLORS.card, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 16, marginBottom: 24, marginTop: 8,
  },
  websiteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  websiteTitle: { fontWeight: '700', fontSize: 15, flex: 1 },
  websiteDesc: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  websiteInput: {
    backgroundColor: '#0B0F19', color: COLORS.text,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, fontSize: 14,
  },
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(124,58,237,0.08)', borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)', borderRadius: 12, padding: 12,
  },
  upgradeCardTitle: { color: COLORS.purple, fontWeight: '700', fontSize: 13 },
  upgradeCardSub: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  footer: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg,
  },
  nextBtn: {
    backgroundColor: COLORS.neon, paddingVertical: 16, borderRadius: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  nextBtnText: { color: '#020617', fontWeight: '800', fontSize: 16 },
  currencyModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  currencyModalCard: {
    backgroundColor: COLORS.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: COLORS.border, padding: 20, maxHeight: '70%',
  },
  currencyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: 'transparent',
  },
  currencySymbol: { fontSize: 18, fontWeight: '800', width: 28, textAlign: 'center' },
});
