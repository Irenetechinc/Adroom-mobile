
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  Image, ActivityIndicator, TextInput,
  Alert, ScrollView, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAgentStore } from '../store/agentStore';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  FadeInUp, FadeInRight, FadeInLeft, Layout,
  useSharedValue, withTiming, withSequence, withDelay,
  useAnimatedStyle, withRepeat, runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { DrawerActions } from '@react-navigation/native';
import {
  Menu, Edit2, Check, Upload, DollarSign, Eye, Tag, Rocket, MapPin,
  RefreshCw, Users, Zap, Calendar, TrendingUp, Bot, RotateCcw, ArrowLeft,
  ChevronDown, Package,
} from 'lucide-react-native';
import { IntegrityService } from '../services/integrity';
import { VisionService } from '../services/vision';
import ImageUploadComponent from '../components/ImageUploadComponent';

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

const BackToMenuButton = ({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) => {
  if (disabled) return null;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
        borderWidth: 1, borderColor: 'rgba(100,116,139,0.3)',
        borderRadius: 10, alignSelf: 'flex-start',
      }}
      activeOpacity={0.7}
    >
      <ArrowLeft size={13} color="#64748B" />
      <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '600' }}>Back to Main Menu</Text>
    </TouchableOpacity>
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

const ProductIntakeCard = ({ onUpload, onManual, onWebsite, onBack, disabled }: { onUpload: () => void; onManual: () => void; onWebsite: () => void; onBack?: () => void; disabled?: boolean }) => (
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
      <TouchableOpacity onPress={onWebsite} disabled={disabled} style={[styles.cardHalfBtn, { borderRightWidth: 1, borderRightColor: 'rgba(0,240,255,0.1)' }, disabled && { opacity: 0.4 }]}>
        <Text style={styles.cardHalfText}>Website URL</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onManual} disabled={disabled} style={[styles.cardHalfBtn, disabled && { opacity: 0.4 }]}>
        <Text style={styles.cardHalfText}>Manual Entry</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const WebsiteIntakeCard = ({ onSubmit, onBack, disabled }: { onSubmit: (url: string) => void; onBack?: () => void; disabled?: boolean }) => {
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
        <Text style={styles.primaryBtnText}>Scan Website</Text>
      </TouchableOpacity>
      <BackToMenuButton onPress={onBack!} disabled={disabled} />
    </View>
  );
};

const AttributeEditorCard = ({ product, onSave, onBack, disabled }: { product: any; onSave: (data: any) => void; onBack?: () => void; disabled?: boolean }) => {
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
      <BackToMenuButton onPress={onBack!} disabled={disabled} />
    </View>
  );
};

const GOALS = [
  { id: 'sales', name: 'Sales', icon: DollarSign, color: '#10B981' },
  { id: 'awareness', name: 'Awareness', icon: Eye, color: '#3B82F6' },
  { id: 'promotional', name: 'Promo', icon: Tag, color: '#F59E0B' },
  { id: 'launch', name: 'Launch', icon: Rocket, color: '#8B5CF6' },
];

const GoalSelectionCard = ({ onSelect, onBack, disabled }: { onSelect: (goal: string) => void; onBack?: () => void; disabled?: boolean }) => (
  <View style={{ marginTop: 8 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {GOALS.map((goal) => {
        const Icon = goal.icon;
        return (
          <TouchableOpacity
            key={goal.id}
            onPress={() => onSelect(goal.id)}
            disabled={disabled}
            style={[styles.goalCard, disabled && styles.cardDisabled]}
            activeOpacity={0.75}
          >
            <View style={[styles.goalIcon, { backgroundColor: `${goal.color}20` }]}>
              <Icon size={20} color={disabled ? '#334155' : goal.color} />
            </View>
            <Text style={[styles.goalText, disabled && { color: '#334155' }]}>{goal.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
    <BackToMenuButton onPress={onBack!} disabled={disabled} />
  </View>
);

const DURATIONS = [
  { days: 7, label: '7 Days', icon: Zap },
  { days: 14, label: '14 Days', icon: Calendar },
  { days: 30, label: '30 Days', icon: TrendingUp },
];

const DurationSelectionCard = ({ onSelect, recommended, onBack, disabled }: { onSelect: (days: number) => void; recommended?: number; onBack?: () => void; disabled?: boolean }) => (
  <View>
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
              <Text style={{ color: 'rgba(0,240,255,0.5)', fontSize: 11 }}>Optimised for your goal and price</Text>
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
    <BackToMenuButton onPress={onBack!} disabled={disabled} />
  </View>
);

const STRATEGY_TYPES = [
  { id: 'product', name: 'Product', icon: Tag, description: 'Promote a specific item' },
  { id: 'service', name: 'Service', icon: Users, description: 'Promote a professional service' },
  { id: 'brand', name: 'Brand', icon: Rocket, description: 'Build brand awareness and authority' },
];

const StrategyTypeSelectionCard = ({ onSelect, onCancel, disabled }: { onSelect: (type: string) => void; onCancel?: () => void; disabled?: boolean }) => (
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
  </View>
);

const StrategyPreviewCard = ({ strategy, onLaunch, onBack, disabled }: { strategy: any; onLaunch: () => void; onBack?: () => void; disabled?: boolean }) => (
  <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
      <View>
        <Text style={styles.fieldLabel}>EST. REACH</Text>
        <Text style={styles.stratReach}>{strategy.estimated_outcomes?.reach?.toLocaleString?.() || strategy.estimated_outcomes?.reach || 'N/A'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.fieldLabel}>PAID EQUIVALENT</Text>
        <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 16 }}>
          ${(strategy.estimated_outcomes?.paid_equivalent_value_usd || 0).toLocaleString()}
        </Text>
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
    {!disabled && <BackToMenuButton onPress={onBack!} disabled={disabled} />}
  </View>
);

const ProductManualIntakeCard = ({ onSubmit, onBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

  const toggleSize = (size: string) =>
    setSelectedSizes((prev) => prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]);

  const currencySymbol = CURRENCIES.find(c => c.code === currency)?.symbol || '$';

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>PRODUCT DETAILS</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <TouchableOpacity
            onPress={() => onSubmit({ name, category, price: `${currencySymbol}${price}`, currency, description, color, sizes: selectedSizes, quantity, images })}
            style={[styles.primaryBtn, { marginTop: 12 }]}
            disabled={!name.trim()}
          >
            <Text style={styles.primaryBtnText}>Save Product</Text>
          </TouchableOpacity>
        )}
        <BackToMenuButton onPress={onBack!} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const ServiceIntakeCard = ({ onSubmit, onBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

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
        <TextInput placeholder="Service Description" placeholderTextColor="#475569" multiline style={[styles.input, { height: 70, marginBottom: 12 }]} value={description} onChangeText={setDescription} editable={!disabled} />
        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <TouchableOpacity onPress={() => onSubmit({ name, category, price: `${currencySymbol}${price}`, currency, description, images })} style={[styles.primaryBtn, { marginTop: 12 }]} disabled={!name.trim()}>
            <Text style={styles.primaryBtnText}>Save Service</Text>
          </TouchableOpacity>
        )}
        <BackToMenuButton onPress={onBack!} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const BrandIntakeCard = ({ onSubmit, onBack, disabled }: { onSubmit: (data: any) => void; onBack?: () => void; disabled?: boolean }) => {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [values, setValues] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string | null }[]>([]);

  return (
    <View style={[styles.card, { padding: 14 }, disabled && styles.cardDisabled]}>
      <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>BRAND DETAILS</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput placeholder="Brand Name *" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={name} onChangeText={setName} editable={!disabled} />
        <TextInput placeholder="Mission Statement" placeholderTextColor="#475569" style={[styles.input, { marginBottom: 10 }]} value={mission} onChangeText={setMission} editable={!disabled} />
        <TextInput placeholder="Core Values (e.g. Quality, Innovation)" placeholderTextColor="#475569" multiline style={[styles.input, { height: 70, marginBottom: 12 }]} value={values} onChangeText={setValues} editable={!disabled} />
        {!disabled && <ImageUploadComponent onImagesSelected={setImages} maxImages={5} />}
        {!disabled && (
          <TouchableOpacity onPress={() => onSubmit({ name, mission, values, images })} style={[styles.primaryBtn, { marginTop: 12 }]} disabled={!name.trim()}>
            <Text style={styles.primaryBtnText}>Save Brand</Text>
          </TouchableOpacity>
        )}
        <BackToMenuButton onPress={onBack!} disabled={disabled} />
      </ScrollView>
    </View>
  );
};

const FacebookConnectButton = ({ onPress, isConnected, onDisconnect, platform, onBack, disabled }: { onPress: () => void; isConnected: boolean; onDisconnect: () => void; platform: string; onBack?: () => void; disabled?: boolean }) => (
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
    <BackToMenuButton onPress={onBack!} disabled={disabled} />
  </View>
);

const SelectionList = ({ items, onSelect, type, onBack, disabled }: { items: any[]; onSelect: (item: any) => void; type: string; onBack?: () => void; disabled?: boolean }) => (
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
    <BackToMenuButton onPress={onBack!} disabled={disabled} />
  </View>
);

const RetryActionCard = ({ onRetry, onCancel, onBack, actionName, disabled }: { onRetry: () => void; onCancel: () => void; onBack?: () => void; actionName: string; disabled?: boolean }) => (
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
    <BackToMenuButton onPress={onBack!} disabled={disabled} />
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
    goBackToMenu, dismissStrategyFlow,
  } = useAgentStore();

  const { user } = useAuthStore();
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

  useEffect(() => {
    const skipLoad = !!(route.params?.fromStrategyApproval || route.params?.connectFacebook ||
      route.params?.connectInstagram || route.params?.connectTikTok ||
      route.params?.connectLinkedIn || route.params?.connectTwitter);

    if (!skipLoad) {
      loadMessages().then(() => setHistoryLoaded(true));
    } else {
      setHistoryLoaded(true);
    }
  }, []);

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
    addMessage('Website Scan', 'user');
    addMessage('Please provide your store or product URL below.', 'agent', undefined, 'website_intake_form' as any);
  };

  const isLastInteractiveMessage = (index: number, uiType: string) => {
    if (!uiType) return false;
    const interactiveTypes = [
      'product_intake_form', 'product_manual_form', 'website_intake_form',
      'service_intake_form', 'brand_intake_form', 'attribute_editor',
      'strategy_type_selection', 'goal_selection', 'duration_selection',
      'strategy_preview', 'facebook_connect', 'page_selection',
      'retry_action', 'session_restore', 'create_strategy_prompt',
    ];
    if (!interactiveTypes.includes(uiType)) return false;
    for (let i = index + 1; i < messages.length; i++) {
      if (interactiveTypes.includes(messages[i].uiType || '')) return false;
    }
    return true;
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isLast = isLastInteractiveMessage(index, item.uiType || '');
    const isDisabled = item.uiType && !isLast;

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
          <Text style={item.sender === 'user' ? styles.userBubbleText : styles.agentBubbleText}>
            {item.text}
          </Text>

          {item.uiType === 'product_intake_form' && (
            <ProductIntakeCard onUpload={handleImageUpload} onManual={handleManualEntry} onWebsite={handleWebsiteEntry} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'website_intake_form' && (
            <WebsiteIntakeCard onSubmit={handleWebsiteIntake} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'attribute_editor' && item.uiData?.product && (
            <AttributeEditorCard product={item.uiData.product} onSave={(data) => handleProductIntake(data)} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'product_manual_form' && (
            <ProductManualIntakeCard onSubmit={handleManualProductSubmit} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'service_intake_form' && (
            <ServiceIntakeCard onSubmit={handleServiceIntake} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'brand_intake_form' && (
            <BrandIntakeCard onSubmit={handleBrandIntake} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'strategy_type_selection' && (
            <StrategyTypeSelectionCard onSelect={handleStrategyTypeSelection} onCancel={isDisabled ? undefined : dismissStrategyFlow} disabled={isDisabled} />
          )}
          {item.uiType === 'goal_selection' && (
            <GoalSelectionCard onSelect={handleGoalSelection} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'duration_selection' && (
            <DurationSelectionCard onSelect={handleDurationSelection} recommended={item.uiData?.recommended} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'strategy_preview' && item.uiData?.strategy && (
            <StrategyPreviewCard strategy={item.uiData.strategy} onLaunch={handleStrategySelection} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'retry_action' && (
            <RetryActionCard
              actionName={item.uiData?.action}
              onRetry={() => handleRetry(item.uiData?.action, item.uiData?.data)}
              onCancel={() => addMessage("I'll help you with something else. What would you like to do?", 'agent')}
              onBack={goBackToMenu}
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
              disabled={isDisabled}
            />
          )}
          {item.uiType === 'page_selection' && item.uiData?.pages && (
            <SelectionList items={item.uiData.pages} type="page" onSelect={(account) => handleAccountSelection(item.uiData?.platform || 'facebook', account)} onBack={goBackToMenu} disabled={isDisabled} />
          )}
          {item.uiType === 'completion_card' && (
            <CompletionCard onDashboard={() => navigation.navigate('Main', { screen: 'Dashboard' })} disabled={isDisabled} />
          )}
          {item.uiType === 'create_strategy_prompt' && (
            <CreateStrategyPromptCard onStartStrategy={startStrategyFlow} disabled={isDisabled} />
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
          <Text style={styles.headerTitle}>Agent</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
          <TouchableOpacity onPress={startNewSession} style={styles.resetBtn}>
            <RotateCcw size={16} color="#64748B" />
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
          ListFooterComponent={(isTyping || uploading) ? <TypingIndicator /> : null}
          keyboardShouldPersistTaps="handled"
        />

        {/* Watermark */}
        <WatermarkOverlay visible={!isActive && messages.length === 0} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, gap: 5,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  liveText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  resetBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
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
