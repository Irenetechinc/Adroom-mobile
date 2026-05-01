
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  Image, ActivityIndicator, TextInput,
  Alert, ScrollView, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore, type ChatSession } from '../store/agentStore';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  FadeInUp, FadeInRight, FadeInLeft, Layout,
  useSharedValue, withTiming, withSequence, withDelay,
  useAnimatedStyle, withRepeat, runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { DrawerActions, useFocusEffect } from '@react-navigation/native';
import {
  Menu, Edit2, Check, Upload, DollarSign, Eye, Tag, Rocket, MapPin,
  RefreshCw, Users, Zap, Calendar, TrendingUp, Bot, MessageSquarePlus, ArrowLeft,
  ChevronDown, Package, History, Clock, Sparkles, Trash2,
} from 'lucide-react-native';
import { IntegrityService } from '../services/integrity';
import { VisionService } from '../services/vision';
import ImageUploadComponent from '../components/ImageUploadComponent';
import VideoUploadComponent, { type VideoAsset } from '../components/VideoUploadComponent';
import { AgentChatSkeleton } from '../components/Skeleton';
import { useEnergyStore } from '../store/energyStore';
import { useStrategyCreationStore } from '../store/strategyCreationStore';
import Constants from 'expo-constants';
import { supabase } from '../services/supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string) || '';

// ─── Currency Data ────────────────────────────────────────────────────────────

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
];

const CurrencySelector = ({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) => {
  const [visible, setVisible] = useState(false);
  const selected = CURRENCIES.find(c => c.code === value) || CURRENCIES[0];
  return (
    <>
      <TouchableOpacity
        onPress={() => !disabled && setVisible(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
          borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, minWidth: 52,
        }}
        disabled={disabled}
      >
        <Text style={{ color: '#00F0FF', fontWeight: '700', fontSize: 13 }}>{selected.symbol}</Text>
        <ChevronDown size={10} color="#00F0FF" />
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 20 }} activeOpacity={1} onPress={() => setVisible(false)}>
          <View style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)', overflow: 'hidden' }}>
            <Text style={{ color: '#00F0FF', fontWeight: '800', fontSize: 13, letterSpacing: 1, padding: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)' }}>SELECT CURRENCY</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => { onChange(c.code); setVisible(false); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', backgroundColor: c.code === value ? 'rgba(0,240,255,0.07)' : 'transparent' }}
                >
                  <Text style={{ color: '#00F0FF', fontWeight: '700', width: 36 }}>{c.symbol}</Text>
                  <Text style={{ color: '#E2E8F0', fontSize: 14 }}>{c.name}</Text>
                  <Text style={{ color: '#475569', fontSize: 11, marginLeft: 6 }}>({c.code})</Text>
                  {c.code === value && <Check size={14} color="#00F0FF" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// ─── Size Chips ──────────────────────────────────────────────────────────────

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size', 'Custom'];

const SizeChips = ({ selected, onToggle, disabled }: { selected: string[]; onToggle: (size: string) => void; disabled?: boolean }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
    {SIZE_OPTIONS.map((s) => {
      const isSelected = selected.includes(s);
      return (
        <TouchableOpacity
          key={s}
          onPress={() => !disabled && onToggle(s)}
          style={{
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
            backgroundColor: isSelected ? 'rgba(0,240,255,0.15)' : '#0B0F19',
            borderWidth: 1, borderColor: isSelected ? '#00F0FF' : '#1E293B',
          }}
        >
          <Text style={{ color: isSelected ? '#00F0FF' : '#64748B', fontSize: 12, fontWeight: '600' }}>{s}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ─── Back to Menu Button ─────────────────────────────────────────────────────

const FormNavRow = ({
  onBack, onStepBack, disabled,
}: {
  onBack?: () => void;
  onStepBack?: () => void;
  disabled?: boolean;
}) => {
  if (disabled || (!onBack && !onStepBack)) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
      {onStepBack && (
        <TouchableOpacity
          onPress={onStepBack}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingVertical: 7, paddingHorizontal: 11,
            borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
            borderRadius: 10, backgroundColor: 'rgba(0,240,255,0.06)',
          }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={12} color="#00F0FF" />
          <Text style={{ color: '#00F0FF', fontSize: 12, fontWeight: '700' }}>Back</Text>
        </TouchableOpacity>
      )}
      {onBack && (
        <TouchableOpacity
          onPress={onBack}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingVertical: 7, paddingHorizontal: 11,
            borderWidth: 1, borderColor: 'rgba(100,116,139,0.3)',
            borderRadius: 10,
          }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={12} color="#64748B" />
          <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '600' }}>Main Menu</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// ─── Watermark Overlay ──────────────────────────────────────────────────────

const WATERMARK_PHRASES = [
  '100% Autonomy',
  'Smart Digital Marketing',
  'Intelligence',
  'Workforce',
  'Smart Autonomous AI',
  "Let's Go AdRoom AI",
];

const WatermarkOverlay = ({ visible }: { visible: boolean }) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const opacity = useSharedValue(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const nextPhrase = useCallback(() => {
    setPhraseIndex((i) => (i + 1) % WATERMARK_PHRASES.length);
  }, []);

  useEffect(() => {
    if (!visible) {
      opacity.value = withTiming(0, { duration: 400 });
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const cycle = () => {
      opacity.value = withSequence(
        withTiming(0.18, { duration: 800 }),
        withDelay(1800, withTiming(0, { duration: 700 })),
      );
      setTimeout(() => runOnJS(nextPhrase)(), 2800);
    };

    cycle();
    intervalRef.current = setInterval(cycle, 3400);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!visible) return null;
  return (
    <Animated.View style={[styles.watermark, animStyle]} pointerEvents="none">
      <Text style={styles.watermarkText}>{WATERMARK_PHRASES[phraseIndex]}</Text>
    </Animated.View>
  );
};

// ─── Interactive Cards ────────────────────────────────────────────────────────

const ProductIntakeCard = ({ onUpload, onManual, onWebsite, onWebsiteUpgrade, isWebsiteRestricted, onBack, onStepBack, disabled }: { onUpload: () => void; onManual: () => void; onWebsite: () => void; onWebsiteUpgrade?: () => void; isWebsiteRestricted?: boolean; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => (
  <View style={[styles.card, disabled && styles.cardDisabled]}>
    <TouchableOpacity
      onPress={onUpload}
      disabled={disabled}
      style={[styles.cardUploadBtn, disabled && { opacity: 0.4 }]}
      activeOpacity={0.8}
    >
      <View style={styles.uploadIconWrap}>
        <Upload size={30} color="#00F0FF" />
      </View>
      <Text style={styles.cardTitle}>Upload Product Image</Text>
      <Text style={styles.cardSub}>AI will scan for attributes automatically</Text>
    </TouchableOpacity>
    <View style={{ flexDirection: 'row' }}>
      <TouchableOpacity
        onPress={isWebsiteRestricted ? onWebsiteUpgrade : onWebsite}
        disabled={disabled}
        style={[
          styles.cardHalfBtn,
          { borderRightWidth: 1, borderRightColor: 'rgba(0,240,255,0.1)' },
          disabled && { opacity: 0.4 },
          isWebsiteRestricted && { opacity: 0.5 },
        ]}
      >
        <Text style={[styles.cardHalfText, isWebsiteRestricted && { color: '#7C3AED' }]}>Connect Website</Text>
        {isWebsiteRestricted && !disabled && (
          <Text style={{ color: '#7C3AED', fontSize: 9, fontWeight: '800', marginTop: 2 }}>UPGRADE TO PRO</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={onManual} disabled={disabled} style={[styles.cardHalfBtn, disabled && { opacity: 0.4 }]}>
        <Text style={styles.cardHalfText}>Manual Entry</Text>
      </TouchableOpacity>
    </View>
    {(onBack || onStepBack) && !disabled && (
      <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
        <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
      </View>
    )}
  </View>
);

const WebsiteIntakeCard = ({ onSubmit, onBack, onStepBack, disabled }: { onSubmit: (url: string) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => {
  const [url, setUrl] = useState('');
  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <TextInput
        placeholder="https://yourstore.com"
        placeholderTextColor="#475569"
        style={[styles.input, { marginBottom: 10 }]}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        editable={!disabled}
      />
      <TouchableOpacity onPress={() => onSubmit(url)} disabled={disabled || !url.trim()} style={[styles.primaryBtn, (disabled || !url.trim()) && { opacity: 0.4 }]}>
        <Text style={styles.primaryBtnText}>Connect Website</Text>
      </TouchableOpacity>
      <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
    </View>
  );
};

const AttributeEditorCard = ({ product, onSave, onBack, onStepBack, disabled }: { product: any; onSave: (data: any) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => {
  const [editedProduct, setEditedProduct] = useState({ price: '', ...product });
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [currency, setCurrency] = useState(product?.currency || 'USD');

  const handleUpdate = (key: string, value: string) => setEditedProduct((p: any) => ({ ...p, [key]: value }));
  const handleAddField = () => {
    if (newFieldKey && newFieldValue) {
      setEditedProduct((p: any) => ({ ...p, [newFieldKey]: newFieldValue }));
      setNewFieldKey('');
      setNewFieldValue('');
    }
  };
  const handleRemoveField = (key: string) => {
    const updated = { ...editedProduct };
    delete updated[key];
    setEditedProduct(updated);
  };

  const images: string[] = Array.isArray(product?.images) ? product.images : [];

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={styles.cardTitle}>Review & Edit Product Details</Text>

      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {images.map((imgUri, idx) => (
            <Image
              key={idx}
              source={{ uri: imgUri }}
              style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)' }}
              resizeMode="cover"
            />
          ))}
        </ScrollView>
      )}

      <ScrollView style={{ maxHeight: 260, marginBottom: 12 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {Object.entries(editedProduct).map(([key, value]) => {
          if (key === 'id' || key === 'images' || key === 'metadata' || typeof value === 'object') return null;
          const isPrice = key === 'price';
          return (
            <View key={key} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.fieldLabel}>{key.replace(/_/g, ' ')}</Text>
                {!disabled && (
                  <TouchableOpacity onPress={() => handleRemoveField(key)}>
                    <Text style={{ color: '#EF4444', fontSize: 11 }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
              {isPrice ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <CurrencySelector value={currency} onChange={setCurrency} disabled={disabled} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={String(value)}
                    onChangeText={(val) => handleUpdate(key, val)}
                    keyboardType="numeric"
                    editable={!disabled}
                    placeholder="0.00"
                    placeholderTextColor="#475569"
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.input}
                  value={String(value)}
                  onChangeText={(val) => handleUpdate(key, val)}
                  multiline={key === 'description'}
                  editable={!disabled}
                />
              )}
            </View>
          );
        })}
        {!disabled && (
          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,240,255,0.1)', paddingTop: 10, marginTop: 4 }}>
            <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>ADD MISSING FIELD</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput placeholder="Label" placeholderTextColor="#475569" style={[styles.input, { flex: 1 }]} value={newFieldKey} onChangeText={setNewFieldKey} />
              <TextInput placeholder="Value" placeholderTextColor="#475569" style={[styles.input, { flex: 2 }]} value={newFieldValue} onChangeText={setNewFieldValue} />
              <TouchableOpacity onPress={handleAddField} style={styles.addFieldBtn}>
                <Text style={{ color: '#00F0FF', fontWeight: '700' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
      {!disabled && (
        <TouchableOpacity onPress={() => onSave({ ...editedProduct, currency })} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Confirm & Continue</Text>
        </TouchableOpacity>
      )}
      <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
    </View>
  );
};

const GOALS = [
  { id: 'sales', name: 'Sales', icon: DollarSign, color: '#10B981', proOnly: true },
  { id: 'awareness', name: 'Awareness', icon: Eye, color: '#3B82F6', proOnly: false },
  { id: 'promotional', name: 'Promo', icon: Tag, color: '#F59E0B', proOnly: false },
  { id: 'launch', name: 'Launch', icon: Rocket, color: '#8B5CF6', proOnly: false },
  { id: 'leads', name: 'Leads', icon: Users, color: '#06B6D4', proOnly: true },
];

const GoalSelectionCard = ({ onSelect, onBack, onStepBack, disabled, navigation }: { onSelect: (goal: string) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean; navigation?: any }) => {
  const { subscription } = useEnergyStore();
  const plan = subscription?.plan ?? 'none';
  const isProOrAbove = subscription?.status === 'active' && (plan === 'pro' || plan === 'pro_plus');

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GOALS.map((goal) => {
          const Icon = goal.icon;
          const isLocked = goal.proOnly && !isProOrAbove;
          return (
            <TouchableOpacity
              key={goal.id}
              onPress={() => {
                if (disabled) return;
                if (isLocked) {
                  navigation?.navigate('Subscription', { scrollToPlan: 'pro' });
                  return;
                }
                onSelect(goal.id);
              }}
              style={[
                styles.goalCard,
                disabled && styles.cardDisabled,
                isLocked && { opacity: 0.55, borderColor: 'rgba(124,58,237,0.3)' },
              ]}
              activeOpacity={0.75}
            >
              <View style={[styles.goalIcon, { backgroundColor: `${goal.color}20` }]}>
                <Icon size={20} color={disabled ? '#334155' : isLocked ? '#7C3AED' : goal.color} />
              </View>
              <Text style={[styles.goalText, disabled && { color: '#334155' }, isLocked && { color: '#7C3AED' }]}>
                {goal.name}
              </Text>
              {isLocked && !disabled && (
                <Text style={{ fontSize: 8, color: '#7C3AED', fontWeight: '800', marginTop: 1 }}>PRO</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
    </View>
  );
};

const DURATIONS = [
  { days: 7, label: '7 Days', icon: Zap },
  { days: 14, label: '14 Days', icon: Calendar },
  { days: 30, label: '30 Days', icon: TrendingUp },
];

const DurationSelectionCard = ({
  onSelect, recommended, onBack, onStepBack, disabled,
  productName, price, currencySymbol, currencyCode,
}: {
  onSelect: (days: number) => void;
  recommended?: number;
  onBack?: () => void;
  onStepBack?: () => void;
  disabled?: boolean;
  productName?: string;
  price?: string;
  currencySymbol?: string;
  currencyCode?: string;
}) => (
  <View>
    {/* Product + price summary strip */}
    {(productName || price) && (
      <View style={{
        backgroundColor: 'rgba(0,240,255,0.06)', borderRadius: 12,
        borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
        padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
      }}>
        <View style={{ flex: 1 }}>
          {productName ? <Text style={{ color: '#E2E8F0', fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{productName}</Text> : null}
          {price ? (
            <Text style={{ color: '#94A3B8', fontSize: 12 }}>
              Price: <Text style={{ color: '#00F0FF', fontWeight: '700' }}>{currencySymbol}{price}</Text>
              {currencyCode ? <Text style={{ color: '#475569' }}> {currencyCode}</Text> : null}
            </Text>
          ) : null}
        </View>
      </View>
    )}
    <View style={[styles.card, { overflow: 'hidden' }, disabled && styles.cardDisabled]}>
      {recommended && (
        <TouchableOpacity
          onPress={() => onSelect(recommended)}
          disabled={disabled}
          style={[styles.durationRecommendedRow, disabled && { opacity: 0.4 }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Zap size={18} color="#00F0FF" />
            <View style={{ marginLeft: 10 }}>
              <Text style={{ color: '#00F0FF', fontWeight: '700' }}>Recommended: {recommended} Days</Text>
              <Text style={{ color: 'rgba(0,240,255,0.5)', fontSize: 11 }}>Optimised for your goal and market</Text>
            </View>
          </View>
          {!disabled && <Text style={{ color: '#00F0FF', fontWeight: '700' }}>Select ›</Text>}
        </TouchableOpacity>
      )}
      {DURATIONS.filter(d => d.days !== recommended).map((d, i, arr) => {
        const Icon = d.icon;
        return (
          <TouchableOpacity
            key={d.days}
            onPress={() => onSelect(d.days)}
            disabled={disabled}
            style={[styles.durationRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)' }, disabled && { opacity: 0.4 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon size={18} color={disabled ? '#334155' : '#64748B'} />
              <Text style={[styles.durationText, disabled && { color: '#334155' }]}>{d.label}</Text>
            </View>
            {!disabled && <Text style={{ color: '#00F0FF', fontWeight: '700' }}>Select ›</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
    <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const STRATEGY_TYPES = [
  { id: 'product', name: 'Product', icon: Tag, description: 'Promote a specific item' },
  { id: 'service', name: 'Service', icon: Users, description: 'Promote a professional service' },
  { id: 'brand', name: 'Brand', icon: Rocket, description: 'Build brand awareness and authority' },
];

const StrategyTypeSelectionCard = ({ onSelect, onCancel, onStepBack, disabled }: { onSelect: (type: string) => void; onCancel?: () => void; onStepBack?: () => void; disabled?: boolean }) => (
  <View style={{ marginTop: 8, gap: 8 }}>
    {STRATEGY_TYPES.map((type) => (
      <TouchableOpacity
        key={type.id}
        onPress={() => onSelect(type.id)}
        disabled={disabled}
        style={[styles.stratTypeRow, disabled && styles.cardDisabled]}
        activeOpacity={0.75}
      >
        <View style={styles.stratTypeIcon}>
          <type.icon size={20} color={disabled ? '#334155' : '#00F0FF'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.stratTypeName, disabled && { color: '#334155' }]}>{type.name}</Text>
          <Text style={styles.stratTypeDesc}>{type.description}</Text>
        </View>
        {!disabled && <Text style={{ color: '#00F0FF' }}>›</Text>}
      </TouchableOpacity>
    ))}
    {!disabled && onCancel && (
      <TouchableOpacity onPress={onCancel} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text style={{ color: '#475569', fontSize: 13 }}>Not now</Text>
      </TouchableOpacity>
    )}
    <FormNavRow onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const PaidEquivalentValue = ({ strategy }: { strategy: any }) => {
  const { productData } = useStrategyCreationStore();
  const currencyCode = productData?.currency ?? 'USD';
  const currencySymbol = CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';
  const value = strategy.estimated_outcomes?.paid_equivalent_value_usd || 0;
  return (
    <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 16 }}>
      {currencySymbol}{value.toLocaleString()}
    </Text>
  );
};

const StrategyPreviewCard = ({ strategy, onLaunch, onBack, onStepBack, disabled }: { strategy: any; onLaunch: () => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => (
  <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
      <View>
        <Text style={styles.fieldLabel}>EST. REACH</Text>
        <Text style={styles.stratReach}>{strategy.estimated_outcomes?.reach?.toLocaleString?.() || strategy.estimated_outcomes?.reach || 'N/A'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.fieldLabel}>PAID EQUIVALENT</Text>
        <PaidEquivalentValue strategy={strategy} />
      </View>
    </View>
    <View style={styles.stratRationale}>
      <Text style={{ color: '#94A3B8', fontSize: 13, lineHeight: 20 }}>
        {strategy.rationale || 'Optimized strategy based on real-time intelligence.'}
      </Text>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      {strategy.platforms?.map((p: string) => (
        <View key={p} style={styles.platformTag}>
          <Text style={styles.platformTagText}>{p}</Text>
        </View>
      ))}
    </View>
    {!disabled && (
      <TouchableOpacity onPress={onLaunch} style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>APPROVE & LAUNCH STRATEGY</Text>
      </TouchableOpacity>
    )}
    {disabled && (
      <View style={[styles.primaryBtn, { backgroundColor: '#1E293B' }]}>
        <Text style={[styles.primaryBtnText, { color: '#475569' }]}>STRATEGY LAUNCHED</Text>
      </View>
    )}
    <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const DELIVERY_TYPES = [
  { key: 'payment_on_delivery', label: 'Cash on Delivery' },
  { key: 'pay_before_delivery', label: 'Pay Before Delivery' },
  { key: 'pay_for_delivery', label: 'Customer Pays Shipping' },
];

const ProductManualIntakeCard = ({ onSubmit, onBack, onStepBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);
  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [productType, setProductType] = useState<'physical' | 'digital'>('physical');
  const [deliveryType, setDeliveryType] = useState('payment_on_delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [bankAccount, setBankAccount] = useState('');

  const toggleSize = (size: string) =>
    setSelectedSizes((prev) => prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]);

  const currencySymbol = CURRENCIES.find(c => c.code === currency)?.symbol || '$';

  const chipBase: any = {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, marginRight: 8, marginBottom: 4,
  };
  const chipActive: any = { backgroundColor: 'rgba(0,240,255,0.12)', borderColor: '#00F0FF' };
  const chipInactive: any = { backgroundColor: 'rgba(30,41,59,0.7)', borderColor: '#334155' };

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>PRODUCT DETAILS</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Product type toggle */}
        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>PRODUCT TYPE</Text>
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          {(['physical', 'digital'] as const).map(type => (
            <TouchableOpacity
              key={type}
              onPress={() => !disabled && setProductType(type)}
              style={[chipBase, productType === type ? chipActive : chipInactive]}
            >
              <Text style={{ color: productType === type ? '#00F0FF' : '#94A3B8', fontWeight: '600', fontSize: 13 }}>
                {type === 'physical' ? 'Physical Product' : 'Digital Product'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput placeholder="Product Name *" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={name} onChangeText={setName} editable={!disabled} />
        <TextInput placeholder="Category (e.g. Fashion, Electronics)" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={category} onChangeText={setCategory} editable={!disabled} />

        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>PRICE</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <CurrencySelector value={currency} onChange={setCurrency} disabled={disabled} />
          <TextInput
            placeholder="0.00"
            placeholderTextColor="#475569"
            keyboardType="numeric"
            style={[styles.input, { flex: 1 }]}
            value={price}
            onChangeText={setPrice}
            editable={!disabled}
          />
        </View>

        <TextInput placeholder="Color (e.g. Red, Navy Blue)" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={color} onChangeText={setColor} editable={!disabled} />

        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>AVAILABLE SIZES</Text>
        <View style={{ marginBottom: 10 }}>
          <SizeChips selected={selectedSizes} onToggle={toggleSize} disabled={disabled} />
        </View>

        <TextInput placeholder="Quantity in Stock" placeholderTextColor="#475569" keyboardType="numeric" style={[styles.input, { marginBottom: 10 }]} value={quantity} onChangeText={setQuantity} editable={!disabled} />

        <TextInput placeholder="Product Description" placeholderTextColor="#475569" multiline style={[styles.input, { height: 70, marginBottom: 12 }]} value={description} onChangeText={setDescription} editable={!disabled} />

        {/* Physical-only fields */}
        {productType === 'physical' && (
          <>
            <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>DELIVERY TYPE</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
              {DELIVERY_TYPES.map(dt => (
                <TouchableOpacity
                  key={dt.key}
                  onPress={() => !disabled && setDeliveryType(dt.key)}
                  style={[chipBase, deliveryType === dt.key ? chipActive : chipInactive]}
                >
                  <Text style={{ color: deliveryType === dt.key ? '#00F0FF' : '#94A3B8', fontWeight: '600', fontSize: 12 }}>
                    {dt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              placeholder="Delivery / Pickup Address"
              placeholderTextColor="#475569"
              style={[styles.input, { marginBottom: 10 }]}
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
              editable={!disabled}
            />

            {deliveryType === 'pay_before_delivery' && (
              <>
                <TextInput
                  placeholder="Contact Phone *"
                  placeholderTextColor="#475569"
                  keyboardType="phone-pad"
                  style={[styles.input, { marginBottom: 10 }]}
                  value={phone}
                  onChangeText={setPhone}
                  editable={!disabled}
                />
                <TextInput
                  placeholder="Bank Account / Payment Details *"
                  placeholderTextColor="#475569"
                  multiline
                  style={[styles.input, { height: 60, marginBottom: 10 }]}
                  value={bankAccount}
                  onChangeText={setBankAccount}
                  editable={!disabled}
                />
              </>
            )}
          </>
        )}

        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <VideoUploadComponent onVideoSelected={setVideo} selectedVideo={video} disabled={disabled} />
        )}
        {!disabled && (
          <TouchableOpacity
            onPress={() => onSubmit({
              name, category,
              price: `${currencySymbol}${price}`,
              currency, description, color,
              sizes: selectedSizes, quantity, images, video,
              productType,
              ...(productType === 'physical' ? {
                deliveryType, deliveryAddress,
                phone: phone || undefined,
                bankAccount: bankAccount || undefined,
              } : {}),
            })}
            style={[styles.primaryBtn, { marginTop: 12 }]}
            disabled={!name.trim() || (productType === 'physical' && deliveryType === 'pay_before_delivery' && (!phone.trim() || !bankAccount.trim()))}
          >
            <Text style={styles.primaryBtnText}>Save Product</Text>
          </TouchableOpacity>
        )}
        <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const ServiceIntakeCard = ({ onSubmit, onBack, onStepBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);
  const [video, setVideo] = useState<VideoAsset | null>(null);

  const currencySymbol = CURRENCIES.find(c => c.code === currency)?.symbol || '$';

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>SERVICE DETAILS</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput placeholder="Service Name *" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={name} onChangeText={setName} editable={!disabled} />
        <TextInput placeholder="Category (e.g. Consulting, Design)" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={category} onChangeText={setCategory} editable={!disabled} />
        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>PRICE / RATE</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <CurrencySelector value={currency} onChange={setCurrency} disabled={disabled} />
          <TextInput placeholder="Amount or rate (e.g. 100/hr)" placeholderTextColor="#475569" style={[styles.input, { flex: 1 }]} value={price} onChangeText={setPrice} editable={!disabled} />
        </View>
        <TextInput placeholder="Service Description" placeholderTextColor="#475569" multiline style={[styles.input, { height: 70, marginBottom: 10 }]} value={description} onChangeText={setDescription} editable={!disabled} />
        <TextInput
          placeholder="Portfolio Link (optional — e.g. https://yourportfolio.com)"
          placeholderTextColor="#475569"
          keyboardType="url"
          autoCapitalize="none"
          style={[styles.input, { marginBottom: 12 }]}
          value={portfolioUrl}
          onChangeText={setPortfolioUrl}
          editable={!disabled}
        />
        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <VideoUploadComponent onVideoSelected={setVideo} selectedVideo={video} disabled={disabled} />
        )}
        {!disabled && (
          <TouchableOpacity
            onPress={() => onSubmit({ name, category, price: `${currencySymbol}${price}`, currency, description, portfolioUrl: portfolioUrl.trim() || null, images, video })}
            style={[styles.primaryBtn, { marginTop: 12 }]}
            disabled={!name.trim()}
          >
            <Text style={styles.primaryBtnText}>Save Service</Text>
          </TouchableOpacity>
        )}
        <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const BrandIntakeCard = ({ onSubmit, onBack, onStepBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [values, setValues] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);
  const [video, setVideo] = useState<VideoAsset | null>(null);

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>BRAND DETAILS</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput placeholder="Brand Name *" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={name} onChangeText={setName} editable={!disabled} />
        <TextInput placeholder="Mission Statement" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={mission} onChangeText={setMission} editable={!disabled} />
        <TextInput placeholder="Core Values (e.g. Quality, Innovation)" placeholderTextColor="#475569" multiline style={[styles.input, { height: 70, marginBottom: 12 }]} value={values} onChangeText={setValues} editable={!disabled} />
        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <VideoUploadComponent onVideoSelected={setVideo} selectedVideo={video} disabled={disabled} />
        )}
        {!disabled && (
          <TouchableOpacity onPress={() => onSubmit({ name, mission, values, images, video })} style={[styles.primaryBtn, { marginTop: 12 }]} disabled={!name.trim()}>
            <Text style={styles.primaryBtnText}>Save Brand</Text>
          </TouchableOpacity>
        )}
        <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const FacebookConnectButton = ({ onPress, isConnected, onDisconnect, platform, onBack, onStepBack, disabled }: { onPress: () => void; isConnected: boolean; onDisconnect: () => void; platform: string; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => (
  <View>
    <TouchableOpacity
      onPress={isConnected ? onDisconnect : onPress}
      disabled={disabled && !isConnected}
      style={[
        styles.connectBtn,
        isConnected ? styles.connectBtnConnected : styles.connectBtnPrimary,
        disabled && !isConnected && styles.cardDisabled,
      ]}
      activeOpacity={0.8}
    >
      <Text style={styles.connectBtnLetter}>{platform.charAt(0).toUpperCase()}</Text>
      <Text style={[styles.connectBtnText, isConnected && { color: '#FFFFFF' }]}>
        {isConnected ? `Disconnect ${platform}` : `Connect ${platform}`}
      </Text>
    </TouchableOpacity>
    <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const SelectionList = ({ items, onSelect, type, onBack, onStepBack, disabled }: { items: any[]; onSelect: (item: any) => void; type: string; onBack?: () => void; onStepBack?: () => void; disabled?: boolean }) => (
  <View>
    <View style={[styles.card, { overflow: 'hidden' }, disabled && styles.cardDisabled]}>
      {items.map((item, index) => (
        <TouchableOpacity
          key={item.id || index}
          onPress={() => onSelect(item)}
          disabled={disabled}
          style={[styles.selectionRow, index < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)' }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.selectionName}>{item.name}</Text>
            <Text style={styles.selectionSub}>{item.category || item.username || item.sub || ''}</Text>
          </View>
          {!disabled && <Text style={{ color: '#00F0FF', fontSize: 20 }}>›</Text>}
        </TouchableOpacity>
      ))}
    </View>
    <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const RetryActionCard = ({ onRetry, onCancel, onBack, onStepBack, actionName, disabled }: { onRetry: () => void; onCancel: () => void; onBack?: () => void; onStepBack?: () => void; actionName: string; disabled?: boolean }) => (
  <View style={[styles.card, styles.retryCard, disabled && styles.cardDisabled]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
      <View style={styles.retryIcon}>
        <Text style={{ color: '#EF4444', fontSize: 18 }}>⚠</Text>
      </View>
      <View>
        <Text style={styles.cardTitle}>{actionName} Failed</Text>
        <Text style={styles.cardSub}>Would you like to try again?</Text>
      </View>
    </View>
    {!disabled && (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity onPress={onCancel} style={styles.retrySkipBtn}>
          <Text style={{ color: '#64748B', fontWeight: '700' }}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRetry} style={[styles.primaryBtn, { flex: 1 }]}>
          <Text style={styles.primaryBtnText}>Retry Now</Text>
        </TouchableOpacity>
      </View>
    )}
    {disabled && (
      <Text style={{ color: '#334155', fontSize: 12 }}>This step has been skipped.</Text>
    )}
    <FormNavRow onBack={onBack} onStepBack={onStepBack} disabled={disabled} />
  </View>
);

const CompletionCard = ({ onDashboard, disabled }: { onDashboard: () => void; disabled?: boolean }) => (
  <View style={[styles.card, styles.completionCard]}>
    <View style={styles.completionIcon}>
      <Text style={{ color: '#10B981', fontSize: 24 }}>✓</Text>
    </View>
    <Text style={[styles.cardTitle, { marginBottom: 4 }]}>Campaign Launched</Text>
    <Text style={[styles.cardSub, { textAlign: 'center', marginBottom: 16 }]}>
      Your strategy is now active and running autonomously.
    </Text>
    <TouchableOpacity onPress={onDashboard} disabled={disabled} style={styles.primaryBtn}>
      <Text style={styles.primaryBtnText}>Go to Dashboard</Text>
    </TouchableOpacity>
  </View>
);

const SessionRestorePromptCard = ({
  lastMessageAt, windowDays, onRestore, onStartNew, disabled, busy,
}: {
  lastMessageAt?: number;
  windowDays?: number;
  onRestore: () => void;
  onStartNew: () => void;
  disabled?: boolean;
  busy?: boolean;
}) => {
  const formatRelative = (ts?: number): string => {
    if (!ts || isNaN(ts)) return 'recently';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };
  return (
    <View style={[styles.card, { paddingVertical: 16, paddingHorizontal: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, marginBottom: 6 }}>
        <Clock size={14} color="#00F0FF" />
        <Text style={{ color: '#00F0FF', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'left' }}>
          Last activity {formatRelative(lastMessageAt)}
        </Text>
      </View>
      <Text style={[styles.cardSub, { marginBottom: 14, textAlign: 'left' }]}>
        Pick up where you left off, or start a fresh session. You can restore your last {windowDays ?? 7} days at any time from the history icon in the header.
      </Text>
      <TouchableOpacity
        onPress={onRestore}
        disabled={disabled || busy}
        style={[styles.primaryBtn, { flexDirection: 'row' }, (disabled || busy) && { opacity: 0.5 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#020617" />
        ) : (
          <>
            <History size={15} color="#0B0F19" />
            <Text style={[styles.primaryBtnText, { marginLeft: 6 }]}>Restore previous session</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onStartNew}
        disabled={disabled || busy}
        style={{
          marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
          borderWidth: 1, borderColor: 'rgba(0,240,255,0.3)', backgroundColor: 'transparent',
          opacity: (disabled || busy) ? 0.5 : 1,
        }}
      >
        <Sparkles size={15} color="#00F0FF" />
        <Text style={{ color: '#00F0FF', fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Start a new session</Text>
      </TouchableOpacity>
    </View>
  );
};

const CreateStrategyPromptCard = ({ onStartStrategy, disabled }: { onStartStrategy: () => void; disabled?: boolean }) => (
  <View style={[styles.card, styles.completionCard]}>
    <View style={[styles.completionIcon, { backgroundColor: 'rgba(0,240,255,0.1)' }]}>
      <Rocket size={22} color="#00F0FF" />
    </View>
    <Text style={[styles.cardTitle, { marginBottom: 4 }]}>Ready to Grow?</Text>
    <Text style={[styles.cardSub, { textAlign: 'center', marginBottom: 16 }]}>
      You are connected! Create a strategy now to start running ads.
    </Text>
    {!disabled && (
      <TouchableOpacity onPress={onStartStrategy} style={styles.primaryBtn}>
        <Text style={[styles.primaryBtnText, { flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Create New Strategy</Text>
      </TouchableOpacity>
    )}
  </View>
);

const TypingIndicator = () => {
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);
  const dot3 = useSharedValue(0.3);
  useEffect(() => {
    dot1.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    setTimeout(() => {
      dot2.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    }, 160);
    setTimeout(() => {
      dot3.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    }, 320);
  }, []);
  const s1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: dot3.value }));
  return (
    <View style={styles.typingWrap}>
      <Animated.View style={[styles.typingDot, s1]} />
      <Animated.View style={[styles.typingDot, s2]} />
      <Animated.View style={[styles.typingDot, s3]} />
    </View>
  );
};

// ─── Typewriter (per-character reveal for agent messages) ────────────────
//
// Renders `text` one character at a time with a tiny delay between each
// character. We deliberately keep `revealedRef` outside React state so a
// parent re-render (e.g. a sibling message updating) doesn't reset the
// reveal animation mid-way through. Once `done` flips true we render the
// full text without any further timers.
const TypewriterText = ({
  text,
  style,
  speedMs = 4,
  startDelay = 0,
  onTick,
  onDone,
  enabled = true,
}: {
  text: string;
  style: any;
  speedMs?: number;
  startDelay?: number;
  onTick?: () => void;
  onDone?: () => void;
  enabled?: boolean;
}) => {
  const [displayed, setDisplayed] = useState<string>(enabled ? '' : text);
  const indexRef = useRef<number>(enabled ? 0 : text.length);
  const doneRef = useRef<boolean>(!enabled);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!enabled || doneRef.current) {
      setDisplayed(text);
      indexRef.current = text.length;
      if (!doneRef.current) {
        doneRef.current = true;
        onDoneRef.current?.();
      }
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (indexRef.current >= text.length) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDoneRef.current?.();
        }
        return;
      }
      indexRef.current += 1;
      setDisplayed(text.slice(0, indexRef.current));
      onTick?.();
      setTimeout(tick, speedMs);
    };
    // startDelay lets sequential messages wait for previous ones to finish.
    const t = setTimeout(tick, startDelay > 0 ? startDelay : speedMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // We intentionally do NOT depend on `text` changing — the text passed
    // in for an existing message id is immutable once added, and changing
    // the dependency would re-trigger the typewriter on every parent
    // re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Text style={style}>{displayed || (enabled ? ' ' : text)}</Text>;
};

// Card fade-in wrapper — animates opacity 0→1 when mounted.
// Used to reveal cards/forms smoothly after the text finishes streaming.
const CardReveal = ({ children }: { children: React.ReactNode }) => {
  const opacity = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 350 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};

// ─── Thinking Indicator (rotating, generic phrases) ──────────────────────
//
// Replaces the plain "•••" while AdRoom AI is composing a strategy. The
// phrases are intentionally generic and do NOT name any internal pipeline
// stage — users see "Analyzing your goals…" / "Drafting your strategy…",
// never "Calling DecisionEngine" or "Fetching memory context".
const THINKING_PHRASES = [
  'Analyzing your goals…',
  'Reviewing what has worked before…',
  'Considering your audience…',
  'Mapping the best channels…',
  'Drafting your strategy…',
  'Putting it all together…',
];

const ThinkingIndicator = () => {
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);
  const dot3 = useSharedValue(0.3);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    dot1.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    setTimeout(() => {
      dot2.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    }, 160);
    setTimeout(() => {
      dot3.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    }, 320);

    const interval = setInterval(() => {
      // Quick fade out → swap phrase → fade in.
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) {
          runOnJS(setPhraseIdx)((Math.floor(Math.random() * 100000)));
          opacity.value = withTiming(1, { duration: 220 });
        }
      });
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  const s1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: dot3.value }));
  const phraseStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const phrase = THINKING_PHRASES[phraseIdx % THINKING_PHRASES.length];

  return (
    <View style={[styles.typingWrap, { flexDirection: 'column', alignItems: 'flex-start', gap: 6, paddingVertical: 10 }]}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Animated.View style={[styles.typingDot, s1]} />
        <Animated.View style={[styles.typingDot, s2]} />
        <Animated.View style={[styles.typingDot, s3]} />
      </View>
      <Animated.Text style={[{ color: '#94A3B8', fontSize: 12, fontStyle: 'italic' }, phraseStyle]}>
        {phrase}
      </Animated.Text>
    </View>
  );
};

// ─── Credit Ticker ───────────────────────────────────────────────────────────

function CreditTicker({ balance, onPress }: { balance: number; onPress: () => void }) {
  const scale = useSharedValue(1);
  const prevBalance = useRef(balance);

  useEffect(() => {
    if (prevBalance.current !== balance) {
      scale.value = withSequence(
        withTiming(1.2, { duration: 180 }),
        withTiming(1, { duration: 180 }),
      );
      prevBalance.current = balance;
    }
  }, [balance]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const color = balance <= 0 ? '#EF4444' : balance <= 5 ? '#F59E0B' : '#10B981';
  const bg = balance <= 0 ? 'rgba(239,68,68,0.12)' : balance <= 5 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)';
  const border = balance <= 0 ? 'rgba(239,68,68,0.3)' : balance <= 5 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, gap: 4 }, animStyle]}>
        <Zap size={11} color={color} fill={color} />
        <Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>
          {balance <= 0 ? '0' : balance < 10 ? balance.toFixed(1) : Math.floor(balance).toString()}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'AgentChat'>;

export default function AgentChatScreen({ navigation, route }: Props) {
  const {
    messages, addMessage, isTyping, setTyping, isInputDisabled, setInputDisabled,
    flowState, handleProductIntake, handleGoalSelection, handleDurationSelection,
    handleStrategySelection, initiateConnection, handleLogin, handleAccountSelection,
    connectionState, loadMessages, restoreSession, startNewSession, tokens,
    disconnectPlatform, handleStrategyTypeSelection, handleServiceIntake,
    handleBrandIntake, handleManualProductSubmit, handleRetry,
    handleImageUpload: handleImageUploadStore, startStrategyFlow, handleWebsiteIntake,
    goBackToMenu, goBackOneStep, dismissStrategyFlow, loadConnectedPlatforms,
    fetchRecentSessions, applySession, restoreLastSession, deleteSession,
  } = useAgentStore();

  // Tracks which agent message IDs have finished streaming their text.
  // Cards/forms inside a bubble are hidden until the text is done.
  const [doneTextIds, setDoneTextIds] = useState<Set<string>>(new Set());
  const markTextDone = useCallback((id: string) => {
    setDoneTextIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const [restoringHistory, setRestoringHistory] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyModalLoading, setHistoryModalLoading] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatSession[]>([]);

  // Used to decide which agent messages should typewriter on screen.
  // Anything older than this timestamp was loaded from chat history (or
  // was already on screen at mount) and renders instantly. Anything newer
  // is a freshly-arrived agent reply and animates in character-by-character.
  const mountedAtRef = useRef<number>(Date.now());

  // True while any newly-arrived agent message is still mid-stream.
  // Used to prevent the ThinkingIndicator / TypingIndicator from overlapping
  // with live typewriter text — they should only appear once all bubbles are
  // done animating.
  const hasStreamingInProgress = messages.some(
    (m) => m.sender === 'agent' && m.timestamp > mountedAtRef.current && !doneTextIds.has(m.id)
  );

  // Count of restorable sessions in the last 7 days. Surfaced as a small
  // numeric badge on the History icon so users can see at a glance whether
  // there's anything to come back to. Refreshed on mount, on screen focus,
  // after the History modal closes, and after the local message list grows
  // (debounced so the just-saved message has time to land in chat_history).
  const [historySessionCount, setHistorySessionCount] = useState<number>(0);

  const refreshHistoryCount = useCallback(async () => {
    try {
      const sessions = await fetchRecentSessions(7);
      setHistorySessionCount(sessions.length);
    } catch {
      // Leave the previous count in place rather than flickering to zero
      // on a transient network error.
    }
  }, [fetchRecentSessions]);

  // Open the History picker. Loads recent sessions on demand so the modal
  // always shows fresh data (e.g. just-finished conversations).
  const openHistoryModal = useCallback(async () => {
    setHistoryModalVisible(true);
    setHistoryModalLoading(true);
    try {
      const sessions = await fetchRecentSessions(7);
      setHistorySessions(sessions);
      // Reuse the same fetch to keep the badge in sync — saves a round trip.
      setHistorySessionCount(sessions.length);
    } catch {
      setHistorySessions([]);
    } finally {
      setHistoryModalLoading(false);
    }
  }, [fetchRecentSessions]);

  const handlePickSession = useCallback((session: ChatSession) => {
    setHistoryModalVisible(false);
    setRestoringHistory(true);
    try {
      applySession(session);
    } catch {
      Alert.alert('Couldn\'t restore', 'Something went wrong while loading that session. Please try again.');
    } finally {
      setRestoringHistory(false);
    }
  }, [applySession]);

  // Track which session row is mid-delete so we can dim it / show a spinner
  // and prevent double-taps without blocking other rows in the list.
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const handleDeleteSession = useCallback(
    (session: ChatSession) => {
      if (deletingSessionId) return;
      const start = new Date(session.startTime);
      const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      Alert.alert(
        'Delete this session?',
        `This will permanently remove the conversation from ${dateStr} at ${timeStr} (${session.messageCount} message${session.messageCount === 1 ? '' : 's'}). This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setDeletingSessionId(session.id);
              try {
                const ok = await deleteSession(session);
                if (!ok) {
                  Alert.alert('Couldn\'t delete', 'Something went wrong while removing that session. Please try again.');
                  return;
                }
                // Drop it from the open list immediately and refresh the badge
                // so both views agree without needing a manual close-and-reopen.
                setHistorySessions((prev) => prev.filter((s) => s.id !== session.id));
                setHistorySessionCount((prev) => Math.max(0, prev - 1));
              } catch {
                Alert.alert('Couldn\'t delete', 'Something went wrong while removing that session. Please try again.');
              } finally {
                setDeletingSessionId(null);
              }
            },
          },
        ],
      );
    },
    [deleteSession, deletingSessionId],
  );

  const handleSessionPromptRestore = useCallback(async () => {
    setRestoringHistory(true);
    try {
      const ok = await restoreLastSession();
      if (!ok) {
        Alert.alert('No recent session', 'I couldn\'t find a previous conversation. Starting a fresh session.');
        await startNewSession({ keepServerHistory: true });
      }
    } catch {
      await startNewSession({ keepServerHistory: true });
    } finally {
      setRestoringHistory(false);
    }
  }, [restoreLastSession, startNewSession]);

  const handleSessionPromptStartNew = useCallback(async () => {
    // Keep server history so the user can still hit the History icon later
    // and restore a past session if they change their mind.
    await startNewSession({ keepServerHistory: true });
  }, [startNewSession]);

  const { user } = useAuthStore();
  const { subscription: userSubscription, account: energyAccount, fetchEnergy } = useEnergyStore();
  const isProOrAboveUser = userSubscription?.status === 'active' && (userSubscription?.plan === 'pro' || userSubscription?.plan === 'pro_plus');
  const [activeWebsiteInfo, setActiveWebsiteInfo] = useState<{ canConnect: boolean; activeWebsites: number; maxWebsites: number } | null>(null);
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const activityTimer = useRef<NodeJS.Timeout | null>(null);

  const markActive = () => {
    setIsActive(true);
    if (activityTimer.current) clearTimeout(activityTimer.current);
    activityTimer.current = setTimeout(() => setIsActive(false), 4000);
  };

  const fetchActiveWebsiteInfo = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !BACKEND_URL) return;
      const res = await fetch(`${BACKEND_URL}/api/strategy/active-websites`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setActiveWebsiteInfo(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const skipLoad = !!(route.params?.fromStrategyApproval || route.params?.connectFacebook ||
      route.params?.connectInstagram || route.params?.connectTikTok ||
      route.params?.connectLinkedIn || route.params?.connectTwitter);

    if (!skipLoad) {
      loadMessages().then(() => setHistoryLoaded(true));
    } else {
      setHistoryLoaded(true);
    }
    fetchActiveWebsiteInfo();
    fetchEnergy();
    refreshHistoryCount();

    const creditPoll = setInterval(() => { fetchEnergy(); }, 15000);
    return () => clearInterval(creditPoll);
  }, []);

  // Keep the History badge in sync with the underlying chat_history. We wait
  // ~1.5s after the local message list grows to give the async insert into
  // chat_history time to commit before re-counting sessions.
  useEffect(() => {
    const t = setTimeout(() => { refreshHistoryCount(); }, 1500);
    return () => clearTimeout(t);
  }, [messages.length, refreshHistoryCount]);

  // Refresh connected platforms whenever the screen regains focus.
  // This ensures the in-chat connect button updates after a user returns
  // from completing OAuth in another screen / browser without manual reload.
  // Also refreshes the History badge so a session started or completed on
  // another device is reflected immediately when the user comes back.
  useFocusEffect(
    useCallback(() => {
      loadConnectedPlatforms?.().catch(() => {});
      fetchActiveWebsiteInfo();
      fetchEnergy();
      refreshHistoryCount();
    }, [loadConnectedPlatforms, fetchActiveWebsiteInfo, fetchEnergy, refreshHistoryCount])
  );

  useEffect(() => {
    if (connectionState !== 'IDLE') return;
    if (route.params?.fromStrategyApproval) {
      initiateConnection('facebook', true);
      return;
    }
    if (route.params?.connectFacebook) initiateConnection('facebook', false);
    if (route.params?.connectInstagram) initiateConnection('instagram', false);
    if (route.params?.connectTikTok) initiateConnection('tiktok', false);
    if (route.params?.connectLinkedIn) initiateConnection('linkedin', false);
    if (route.params?.connectTwitter) initiateConnection('twitter', false);
  }, [route.params]);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  const handleImageUpload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera roll access is needed to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets?.length) {
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('Upload Error', 'Image encoding failed. Please try another image.');
        return;
      }
      setUploading(true);
      markActive();
      addMessage('Uploading product image...', 'user', asset.uri);
      try {
        await handleImageUploadStore(asset.uri, asset.base64);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleManualEntry = () => {
    setInputDisabled(true);
    addMessage('Manual Entry', 'user');
    addMessage('Please provide your product details below.', 'agent', undefined, 'product_manual_form');
  };

  const handleWebsiteEntry = () => {
    setInputDisabled(true);
    addMessage('Website Connect', 'user');
    addMessage('Please provide your store or product URL below.', 'agent', undefined, 'website_intake_form');
  };

  const INTERACTIVE_TYPES = [
    'product_intake_form', 'product_manual_form', 'website_intake_form',
    'service_intake_form', 'brand_intake_form', 'attribute_editor',
    'strategy_type_selection', 'goal_selection', 'duration_selection',
    'strategy_preview', 'facebook_connect', 'page_selection',
    'retry_action', 'session_restore', 'session_restore_prompt', 'create_strategy_prompt',
  ];

  const isLastInteractiveMessage = (index: number, uiType: string) => {
    if (!uiType) return false;
    if (!INTERACTIVE_TYPES.includes(uiType)) return false;
    for (let i = index + 1; i < messages.length; i++) {
      if (INTERACTIVE_TYPES.includes(messages[i].uiType || '')) return false;
    }
    return true;
  };

  // Returns true only if there is a PREVIOUS interactive card before this index
  const hasPreviousStep = (index: number): boolean => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].uiType && INTERACTIVE_TYPES.includes(messages[i].uiType!)) return true;
    }
    return false;
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isLast = isLastInteractiveMessage(index, item.uiType || '');
    const isDisabled = item.uiType && !isLast;
    const stepBackProp = hasPreviousStep(index) ? goBackOneStep : undefined;

    // Sequential streaming: count chars from preceding new agent messages so
    // each message waits for the previous one to finish before it starts.
    const isNewAgentMsg = item.sender === 'agent' && item.timestamp > mountedAtRef.current;
    const charsBeforeMe = isNewAgentMsg
      ? messages
          .filter(m => m.sender === 'agent' && m.timestamp > mountedAtRef.current && m.text && m.id !== item.id && m.timestamp <= item.timestamp)
          .reduce((sum, m) => sum + (m.text?.length || 0), 0)
      : 0;
    const streamDelay = charsBeforeMe * 4;

    // Cards and forms only appear after the text in this bubble finishes
    // streaming. History messages (not new) are always immediately visible.
    const cardReady = !item.uiType || !isNewAgentMsg || doneTextIds.has(item.id);

    const cardContent = (
      <>
        {item.uiType === 'product_intake_form' && (
          <ProductIntakeCard
            onUpload={handleImageUpload}
            onManual={handleManualEntry}
            onWebsite={handleWebsiteEntry}
            isWebsiteRestricted={!isProOrAboveUser || (activeWebsiteInfo !== null && !activeWebsiteInfo.canConnect)}
            onWebsiteUpgrade={() => navigation.navigate('Subscription', { scrollToPlan: 'pro' })}
            onBack={goBackToMenu}
            onStepBack={stepBackProp}
            disabled={isDisabled}
          />
        )}
        {item.uiType === 'website_intake_form' && (
          <WebsiteIntakeCard onSubmit={handleWebsiteIntake} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'attribute_editor' && item.uiData?.product && (
          <AttributeEditorCard product={item.uiData.product} onSave={(data) => handleProductIntake(data)} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'product_manual_form' && (
          <ProductManualIntakeCard onSubmit={handleManualProductSubmit} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'service_intake_form' && (
          <ServiceIntakeCard onSubmit={handleServiceIntake} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'brand_intake_form' && (
          <BrandIntakeCard onSubmit={handleBrandIntake} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'strategy_type_selection' && (
          <StrategyTypeSelectionCard onSelect={handleStrategyTypeSelection} onCancel={isDisabled ? undefined : dismissStrategyFlow} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'goal_selection' && (
          <GoalSelectionCard onSelect={handleGoalSelection} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} navigation={navigation} />
        )}
        {item.uiType === 'duration_selection' && (
          <DurationSelectionCard
            onSelect={handleDurationSelection}
            recommended={item.uiData?.recommended}
            onBack={goBackToMenu}
            onStepBack={stepBackProp}
            disabled={isDisabled}
            productName={item.uiData?.productName}
            price={item.uiData?.price}
            currencySymbol={item.uiData?.currencySymbol}
            currencyCode={item.uiData?.currencyCode}
          />
        )}
        {item.uiType === 'strategy_preview' && item.uiData?.strategy && (
          <StrategyPreviewCard strategy={item.uiData.strategy} onLaunch={handleStrategySelection} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'retry_action' && (
          <RetryActionCard
            actionName={item.uiData?.action}
            onRetry={() => handleRetry(item.uiData?.action, item.uiData?.data)}
            onCancel={() => addMessage("I'll help you with something else. What would you like to do?", 'agent')}
            onBack={goBackToMenu}
            onStepBack={stepBackProp}
            disabled={isDisabled}
          />
        )}
        {item.uiType === 'facebook_connect' && (
          <FacebookConnectButton
            onPress={() => handleLogin(item.uiData?.platform || 'facebook')}
            isConnected={!!tokens[item.uiData?.platform || 'facebook']}
            onDisconnect={() => disconnectPlatform(item.uiData?.platform || 'facebook')}
            platform={item.uiData?.platform || 'facebook'}
            onBack={goBackToMenu}
            onStepBack={stepBackProp}
            disabled={isDisabled}
          />
        )}
        {item.uiType === 'page_selection' && item.uiData?.pages && (
          <SelectionList items={item.uiData.pages} type="page" onSelect={(account) => handleAccountSelection(item.uiData?.platform || 'facebook', account)} onBack={goBackToMenu} onStepBack={stepBackProp} disabled={isDisabled} />
        )}
        {item.uiType === 'completion_card' && (
          <CompletionCard onDashboard={() => navigation.navigate('Main', { screen: 'Dashboard' })} disabled={isDisabled} />
        )}
        {item.uiType === 'create_strategy_prompt' && (
          <CreateStrategyPromptCard onStartStrategy={startStrategyFlow} disabled={isDisabled} />
        )}
        {item.uiType === 'session_restore_prompt' && (
          <SessionRestorePromptCard
            lastMessageAt={item.uiData?.lastMessageAt}
            windowDays={item.uiData?.windowDays}
            onRestore={handleSessionPromptRestore}
            onStartNew={handleSessionPromptStartNew}
            disabled={isDisabled}
            busy={restoringHistory}
          />
        )}
      </>
    );

    return (
      <Animated.View
        entering={item.sender === 'user' ? FadeInRight.duration(300) : FadeInLeft.duration(300)}
        layout={Layout.springify()}
        style={[styles.messageRow, item.sender === 'user' ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}
      >
        {item.sender === 'agent' && (
          <View style={styles.agentAvatar}>
            <Bot size={14} color="#00F0FF" />
          </View>
        )}
        <View style={[
          styles.messageBubble,
          item.sender === 'user' ? styles.userBubble : styles.agentBubble,
        ]}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={styles.messageImage} resizeMode="cover" />
          ) : null}
          {item.sender === 'agent' ? (
            <TypewriterText
              text={item.text}
              style={styles.agentBubbleText}
              enabled={isNewAgentMsg}
              startDelay={streamDelay}
              onDone={() => markTextDone(item.id)}
              onTick={() => {
                flatListRef.current?.scrollToEnd({ animated: false });
              }}
            />
          ) : (
            <Text style={styles.userBubbleText}>{item.text}</Text>
          )}

          {/* Cards/forms — only shown after text finishes streaming */}
          {item.uiType && (
            cardReady
              ? isNewAgentMsg
                ? <CardReveal key={`card-${item.id}`}>{cardContent}</CardReveal>
                : cardContent
              : null
          )}
        </View>
      </Animated.View>
    );
  };

  const isStackEntry = !!(
    route.params?.connectFacebook ||
    route.params?.connectInstagram ||
    route.params?.connectTikTok ||
    route.params?.connectLinkedIn ||
    route.params?.connectTwitter ||
    route.params?.fromStrategyApproval
  );

  if (!historyLoaded) {
    return <AgentChatSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {isStackEntry ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerMenuBtn}>
            <ArrowLeft color="#E2E8F0" size={22} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.headerMenuBtn}>
            <Menu color="#E2E8F0" size={22} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Intelligence</Text>
        </View>
        <View style={styles.headerRight}>
          <CreditTicker balance={parseFloat(String(energyAccount?.balance_credits ?? '0'))} onPress={() => (navigation as any).navigate('Subscription', { tab: 'topup' })} />
          <View>
            <TouchableOpacity
              onPress={openHistoryModal}
              disabled={restoringHistory}
              style={[styles.resetBtn, restoringHistory && { opacity: 0.5 }]}
              accessibilityLabel={
                historySessionCount > 0
                  ? `Open chat history, ${historySessionCount} restorable session${historySessionCount === 1 ? '' : 's'}`
                  : 'Open chat history'
              }
            >
              {restoringHistory ? <ActivityIndicator size="small" color="#00F0FF" /> : <History size={16} color="#00F0FF" />}
            </TouchableOpacity>
            {historySessionCount > 0 && !restoringHistory && (
              <View style={styles.historyBadge} pointerEvents="none">
                <Text style={styles.historyBadgeText}>
                  {historySessionCount > 9 ? '9+' : String(historySessionCount)}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => startNewSession({ keepServerHistory: true })} style={styles.resetBtn} accessibilityLabel="Start a new chat">
            <MessageSquarePlus size={16} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onScrollBeginDrag={() => markActive()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.flatListContent, { paddingBottom: insets.bottom + 24 }]}
          ListFooterComponent={
            hasStreamingInProgress
              ? null
              : flowState === 'STRATEGY_GENERATION' && isTyping
                ? <ThinkingIndicator />
                : (isTyping || uploading)
                  ? <TypingIndicator />
                  : null
          }
          keyboardShouldPersistTaps="handled"
        />

        {/* Credits Exhausted Banner */}
        {(() => {
          const bal = parseFloat(String(energyAccount?.balance_credits ?? '1'));
          if (bal > 0) return null;
          return (
            <View style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(12, insets.bottom + 8), flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.12)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Text style={{ fontSize: 16 }}>⚡</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FCA5A5', fontWeight: '700', fontSize: 13, marginBottom: 2 }}>Energy Credits Exhausted</Text>
                <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 17 }}>Your active campaigns are paused. Top up to resume.</Text>
              </View>
              <TouchableOpacity
                onPress={() => (navigation as any).navigate('Subscription', { tab: 'topup' })}
                style={{ backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>Top Up</Text>
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* Watermark */}
        <WatermarkOverlay visible={!isActive && messages.length === 0} />
      </KeyboardAvoidingView>

      {/* History picker modal — shows the last 7 days of conversations,
          grouped into sessions, so the user can pick which one to restore. */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={historyModalStyles.backdrop}>
          <View style={historyModalStyles.card}>
            <View style={historyModalStyles.headerRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <History size={18} color="#00F0FF" />
                <Text style={historyModalStyles.title}>Chat history</Text>
              </View>
              <TouchableOpacity
                onPress={() => setHistoryModalVisible(false)}
                accessibilityLabel="Close history"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={historyModalStyles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            <Text style={historyModalStyles.subtitle}>
              Pick a session from the last 7 days to bring it back into the chat.
            </Text>

            {historyModalLoading ? (
              <View style={historyModalStyles.loadingBox}>
                <ActivityIndicator size="small" color="#00F0FF" />
                <Text style={historyModalStyles.loadingText}>Loading your sessions…</Text>
              </View>
            ) : historySessions.length === 0 ? (
              <View style={historyModalStyles.emptyBox}>
                <Text style={historyModalStyles.emptyTitle}>No recent sessions</Text>
                <Text style={historyModalStyles.emptyBody}>
                  You don't have any chat from the past 7 days yet. Start a new conversation and it'll show up here.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {historySessions.map((session) => {
                  const start = new Date(session.startTime);
                  const end = new Date(session.endTime);
                  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                  const startTimeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                  const endTimeStr = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                  const sameTime = startTimeStr === endTimeStr;
                  const isDeleting = deletingSessionId === session.id;
                  return (
                    <View
                      key={session.id}
                      style={[historyModalStyles.sessionRow, isDeleting && { opacity: 0.5 }]}
                    >
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                        onPress={() => handlePickSession(session)}
                        disabled={isDeleting}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={historyModalStyles.sessionDate}>{dateStr}</Text>
                          <Text style={historyModalStyles.sessionTime}>
                            {sameTime ? startTimeStr : `${startTimeStr} – ${endTimeStr}`} · {session.messageCount} message{session.messageCount === 1 ? '' : 's'}
                          </Text>
                          <Text style={historyModalStyles.sessionPreview} numberOfLines={2}>
                            {session.preview}
                          </Text>
                        </View>
                        <Clock size={16} color="#64748B" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteSession(session)}
                        disabled={isDeleting}
                        style={historyModalStyles.deleteBtn}
                        accessibilityLabel="Delete this session"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {isDeleting
                          ? <ActivityIndicator size="small" color="#EF4444" />
                          : <Trash2 size={16} color="#EF4444" />}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const historyModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0B0F19',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)',
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  closeText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 14,
  },
  loadingBox: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
  },
  emptyBox: {
    paddingVertical: 22,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyBody: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  sessionDate: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionTime: {
    color: '#00F0FF',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  sessionPreview: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  deleteBtn: {
    width: 34, height: 34,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    marginLeft: 8,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: '#0B0F19',
  },
  headerMenuBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: '#64748B', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resetBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  historyBadge: {
    position: 'absolute',
    top: -4, right: -4,
    minWidth: 18, height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#00F0FF',
    borderWidth: 2, borderColor: '#0B0F19',
    alignItems: 'center', justifyContent: 'center',
  },
  historyBadgeText: {
    color: '#020617', fontSize: 10, fontWeight: '800',
    lineHeight: 12, includeFontPadding: false,
  },

  // Watermark
  watermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  },
  watermarkText: {
    color: 'rgba(0,240,255,0.25)', fontSize: 26, fontWeight: '900',
    letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
  },

  // Messages
  flatListContent: { paddingHorizontal: 14, paddingTop: 14 },
  messageRow: { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-end' },
  agentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#00F0FF',
    alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 2,
  },
  messageBubble: { maxWidth: '85%', borderRadius: 18, padding: 14 },
  userBubble: {
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
    borderTopRightRadius: 4,
  },
  agentBubble: {
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    borderTopLeftRadius: 4,
  },
  userBubbleText: { color: '#00F0FF', fontSize: 14, lineHeight: 20 },
  agentBubbleText: { color: '#E2E8F0', fontSize: 14, lineHeight: 20 },
  messageImage: { width: 180, height: 120, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)' },

  // Typing
  typingWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, paddingVertical: 10 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00F0FF' },

  // Input Bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#0B0F19', borderTopWidth: 1, borderTopColor: '#1E293B',
    gap: 8,
  },
  inputCameraBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  inputField: {
    flex: 1, backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 16, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    color: '#E2E8F0', fontSize: 15, maxHeight: 100, minHeight: 40,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#00F0FF', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: '#0B0F19', fontSize: 20, fontWeight: '900', marginTop: -2 },

  // Cards
  card: {
    marginTop: 10, backgroundColor: '#0F1520',
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    overflow: 'hidden',
  },
  cardDisabled: { borderColor: '#1E293B', opacity: 0.55 },
  cardUploadBtn: { padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)' },
  uploadIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  cardHalfBtn: { flex: 1, padding: 14, alignItems: 'center' },
  cardHalfText: { color: '#00F0FF', fontWeight: '600', fontSize: 13 },
  cardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  cardSub: { color: '#64748B', fontSize: 12, textAlign: 'center' },

  input: {
    backgroundColor: '#0B0F19', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: '#E2E8F0', fontSize: 14,
  },
  fieldLabel: { color: '#00F0FF', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.5 },
  addFieldBtn: {
    backgroundColor: 'rgba(0,240,255,0.1)', paddingHorizontal: 12,
    borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
  },

  primaryBtn: {
    backgroundColor: '#00F0FF', borderRadius: 12,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },

  // Goal cards
  goalCard: {
    width: '48%', backgroundColor: '#0F1520', padding: 14,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    alignItems: 'center',
  },
  goalIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  goalText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  // Duration
  durationRecommendedRow: {
    padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,240,255,0.04)', borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
  },
  durationRow: { padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  durationText: { color: '#FFFFFF', fontWeight: '700', marginLeft: 12 },

  // Strategy type
  stratTypeRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: '#0F1520', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
  },
  stratTypeIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,240,255,0.08)', alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  stratTypeName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  stratTypeDesc: { color: '#64748B', fontSize: 12, marginTop: 2 },

  // Strategy preview
  stratReach: { color: '#FFFFFF', fontSize: 26, fontWeight: '800' },
  stratRationale: { backgroundColor: '#0B0F19', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#1E293B' },
  platformTag: { backgroundColor: 'rgba(0,240,255,0.08)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)' },
  platformTagText: { color: '#00F0FF', fontSize: 11, textTransform: 'capitalize' },

  // Connect button
  connectBtn: { marginTop: 10, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  connectBtnPrimary: { backgroundColor: '#00F0FF' },
  connectBtnConnected: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  connectBtnLetter: { color: '#0B0F19', fontWeight: '900', fontSize: 16 },
  connectBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 14 },

  // Selection list
  selectionRow: { padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectionName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  selectionSub: { color: '#64748B', fontSize: 11, marginTop: 2 },

  // Retry
  retryCard: { borderColor: 'rgba(239,68,68,0.4)', padding: 14 },
  retryIcon: {
    width: 40, height: 40, backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  retrySkipBtn: {
    flex: 1, backgroundColor: '#151B2B', paddingVertical: 12,
    borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
  },

  // Completion
  completionCard: { alignItems: 'center', padding: 20, borderColor: 'rgba(16,185,129,0.3)' },
  completionIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(16,185,129,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
});
