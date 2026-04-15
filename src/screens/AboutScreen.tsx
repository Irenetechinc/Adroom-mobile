import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Bot, Shield, Zap, Brain, Globe, Lock, Mail } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const FEATURES = [
  { icon: Brain, color: '#00F0FF', label: 'AI-Powered Strategy', desc: 'GPT-4o & Gemini generate personalised organic marketing strategies from your product data.' },
  { icon: Zap, color: '#F59E0B', label: 'AdRoom Energy System', desc: 'Credit-based usage that ensures fair, transparent billing for every AI operation.' },
  { icon: Globe, color: '#10B981', label: 'Multi-Platform Execution', desc: 'Autonomous publishing across Facebook, Instagram, TikTok, X, and LinkedIn.' },
  { icon: Shield, color: '#7000FF', label: 'Platform Intelligence', desc: 'Real-time monitoring of algorithm shifts, trends, and market opportunities.' },
  { icon: Bot, color: '#EF4444', label: 'Autonomous Agents', desc: 'Salesman, Awareness, Promotion, and Launch agents work 24/7 to grow your brand.' },
  { icon: Lock, color: '#64748B', label: 'Privacy First', desc: 'Your data is encrypted and never used to train any external model.' },
];

export default function AboutScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Settings</Text>
          <Text style={styles.headerTitle}>About AdRoom AI</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
      >
        {/* Logo / Hero */}
        <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Bot size={40} color="#00F0FF" />
          </View>
          <Text style={styles.heroTitle}>AdRoom AI</Text>
          <Text style={styles.heroVersion}>Version 1.0.0 — Production</Text>
          <Text style={styles.heroTagline}>
            The autonomous marketing intelligence platform built for modern businesses.
          </Text>
        </Animated.View>

        {/* Mission */}
        <Animated.View entering={FadeInDown.delay(160).springify()} style={styles.section}>
          <Text style={styles.sectionTitle}>Our Mission</Text>
          <Text style={styles.bodyText}>
            AdRoom AI exists to democratise world-class marketing. We believe every business —
            from solo entrepreneurs to growing brands — deserves the power of an autonomous,
            always-on marketing team without the agency price tag.
          </Text>
        </Animated.View>

        {/* Features */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.section}>
          <Text style={styles.sectionTitle}>Core Capabilities</Text>
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: `${f.color}18` }]}>
                  <Icon size={18} color={f.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            );
          })}
        </Animated.View>

        {/* AI Models */}
        <Animated.View entering={FadeInDown.delay(260).springify()} style={styles.section}>
          <Text style={styles.sectionTitle}>AI Technology</Text>
          <Text style={styles.bodyText}>
            AdRoom AI is powered by a combination of frontier models — including OpenAI GPT-4o
            for strategy and copy generation, and Google Gemini for vision analysis and image
            scanning. Our Credit Management Agent (CMA) intelligently routes each operation
            to the most cost-effective model, maximising your AdRoom Energy.
          </Text>
        </Animated.View>

        {/* Contact */}
        <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.contactCard}>
          <Mail size={18} color="#00F0FF" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.contactTitle}>Get in Touch</Text>
            <Text style={styles.contactDesc}>Questions, feedback, or partnership enquiries</Text>
          </View>
          <TouchableOpacity
            onPress={() => Linking.openURL('mailto:support@adroomai.com')}
            style={styles.contactBtn}
          >
            <Text style={styles.contactBtnText}>Contact</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.footerText}>
          © {new Date().getFullYear()} AdRoom AI. All rights reserved.{'\n'}
          Built with ❤️ for ambitious marketers worldwide.
        </Text>
      </ScrollView>
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
  backBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  scroll: { padding: 20 },

  hero: {
    alignItems: 'center', paddingVertical: 32,
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.12)', marginBottom: 24,
  },
  heroIcon: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  heroTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginBottom: 4 },
  heroVersion: { color: '#475569', fontSize: 12, fontWeight: '600', marginBottom: 14 },
  heroTagline: { color: '#94A3B8', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },

  section: {
    backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B',
    padding: 18, marginBottom: 16,
  },
  sectionTitle: {
    color: '#00F0FF', fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  bodyText: { color: '#94A3B8', fontSize: 13, lineHeight: 21 },

  featureRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14,
  },
  featureIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2,
  },
  featureLabel: { color: '#E2E8F0', fontWeight: '700', fontSize: 13, marginBottom: 3 },
  featureDesc: { color: '#64748B', fontSize: 12, lineHeight: 18 },

  contactCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,240,255,0.05)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    borderRadius: 16, padding: 16, marginBottom: 20,
  },
  contactTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  contactDesc: { color: '#64748B', fontSize: 11 },
  contactBtn: {
    backgroundColor: 'rgba(0,240,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  contactBtnText: { color: '#00F0FF', fontWeight: '700', fontSize: 12 },

  footerText: { color: '#1E293B', fontSize: 11, textAlign: 'center', lineHeight: 18 },
});
