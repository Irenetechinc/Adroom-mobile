
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Menu, CreditCard, History, Plus, AlertCircle, RefreshCw } from 'lucide-react-native';
import { DrawerActions } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../services/supabase';

const formatCurrency = (amount: number, currency: string | null) => {
  if (!currency) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(amount);
};

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL; 
const MIN_DEPOSIT_RAW = process.env.EXPO_PUBLIC_MIN_DEPOSIT;
const ADROOM_FEE_RAW = process.env.EXPO_PUBLIC_ADROOM_FEE;

export default function WalletScreen({ navigation }: any) {
  const { user, session } = useAuthStore();
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWalletData = async () => {
    if (!user || !session || !BACKEND_URL) {
      if (!BACKEND_URL) {
        Alert.alert('Configuration Error', 'Backend URL is not configured.');
      }
      return;
    }
    setLoading(true);
    try {
      // Fetch Balance
      const response = await fetch(`${BACKEND_URL}/api/wallet/balance`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const wallet = await response.json();

      if (!response.ok) {
        throw new Error(wallet?.error || 'Failed to fetch wallet');
      }

      if (wallet && wallet.balance !== undefined) {
        setBalance(Number(wallet.balance));
      }

      if (wallet?.currency) {
        setCurrency(String(wallet.currency));
      }

      // Fetch Transactions
      const { data: txs, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (txs) setTransactions(txs);

    } catch (error) {
      console.error('Error fetching wallet data:', error);
      Alert.alert('Error', 'Failed to load wallet data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWalletData();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWalletData();
  };

  const handleDeposit = async () => {
    const minDeposit = MIN_DEPOSIT_RAW ? Number(MIN_DEPOSIT_RAW) : null;
    if (!minDeposit || !Number.isFinite(minDeposit)) {
      Alert.alert('Configuration Error', 'Minimum deposit is not configured.');
      return;
    }

    if (!depositAmount || isNaN(Number(depositAmount)) || Number(depositAmount) < minDeposit) {
      Alert.alert('Invalid Amount', `Please enter a valid amount (Min ${minDeposit})`);
      return;
    }

    setLoading(true);
    try {
      if (!BACKEND_URL || !session) {
        Alert.alert('Configuration Error', 'Backend URL is not configured.');
        return;
      }

      const response = await fetch(`${BACKEND_URL}/api/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: Number(depositAmount),
          name: user?.user_metadata?.full_name || user?.user_metadata?.name
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Could not initiate payment');
      }

      if (data.paymentLink) {
        // Open WebBrowser
        const result = await WebBrowser.openBrowserAsync(data.paymentLink);
        
        // When user returns (closes browser)
        if (result.type === 'cancel' || result.type === 'dismiss') {
            // Refresh to check if they completed it
            fetchWalletData();
        }
      } else {
        throw new Error('No payment link received');
      }

    } catch (error: any) {
      Alert.alert('Deposit Failed', error.message || 'Could not initiate payment');
    } finally {
      setLoading(false);
      setDepositAmount('');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-adroom-dark" edges={['top']}>
      {/* Header */}
      <View className="px-4 py-3 border-b border-adroom-neon/20 flex-row items-center justify-between">
        <View className="flex-row items-center">
            <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} className="mr-3">
                <Menu color="#E2E8F0" size={24} />
            </TouchableOpacity>
            <Text className="text-adroom-text font-bold text-lg tracking-wider">AD <Text className="text-adroom-neon">WALLET</Text></Text>
        </View>
        <TouchableOpacity onPress={onRefresh}>
             <RefreshCw color="#64748B" size={20} className={refreshing ? "animate-spin" : ""} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        className="flex-1 px-4 pt-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
      >
        {/* Balance Card */}
        <View className="bg-adroom-card p-6 rounded-2xl border border-adroom-neon/30 mb-6 relative overflow-hidden">
            <View className="absolute right-[-20] top-[-20] opacity-10">
                <CreditCard size={150} color="#00F0FF" />
            </View>
            
            <Text className="text-adroom-text-muted mb-1 font-medium uppercase tracking-widest text-xs">Available Balance</Text>
            <Text className="text-white text-4xl font-bold mb-4">{formatCurrency(balance, currency)}</Text>
            
            <View className="flex-row items-center space-x-2">
                <View className="bg-green-500/20 px-3 py-1 rounded-full border border-green-500/30">
                    <Text className="text-green-400 text-xs font-bold">● Active</Text>
                </View>
                <Text className="text-gray-500 text-xs">ID: {user?.id.slice(0, 8)}...</Text>
            </View>
        </View>

        {/* Deposit Section */}
        <View className="mb-8">
            <Text className="text-white font-bold text-lg mb-3">Add Funds</Text>
            <View className="flex-row space-x-3">
                <View className="flex-1">
                    <TextInput 
                        className="bg-adroom-card border border-gray-700 rounded-xl px-4 py-3 text-white font-bold text-lg"
                        placeholder={currency ? `Amount (${currency})` : 'Amount'}
                        placeholderTextColor="#64748B"
                        keyboardType="numeric"
                        value={depositAmount}
                        onChangeText={setDepositAmount}
                    />
                </View>
                <TouchableOpacity 
                    onPress={handleDeposit}
                    disabled={loading}
                    className={`bg-adroom-neon px-6 rounded-xl justify-center items-center ${loading ? 'opacity-50' : ''}`}
                >
                    {loading ? (
                        <RefreshCw size={24} color="#0B0F19" className="animate-spin" />
                    ) : (
                        <Text className="text-adroom-dark font-bold text-lg">Deposit</Text>
                    )}
                </TouchableOpacity>
            </View>
            {!!ADROOM_FEE_RAW && Number.isFinite(Number(ADROOM_FEE_RAW)) && (
              <Text className="text-gray-500 text-xs mt-2 ml-1">
                <AlertCircle size={10} color="#64748B" /> Note: A transaction fee of {formatCurrency(Number(ADROOM_FEE_RAW), currency)} applies.
              </Text>
            )}
        </View>

        {/* Transaction History */}
        <View className="mb-4 flex-row items-center space-x-2">
            <History size={20} color="#00F0FF" />
            <Text className="text-white font-bold text-lg">Recent Transactions</Text>
        </View>

        {transactions.length === 0 ? (
            <View className="items-center py-10 opacity-50">
                <Text className="text-gray-500">No transactions found.</Text>
            </View>
        ) : (
            transactions.map((tx) => (
                <View key={tx.id} className="bg-adroom-card p-4 rounded-xl border border-gray-800 mb-3 flex-row justify-between items-center">
                    <View>
                        <Text className="text-white font-bold text-base">{tx.description || tx.type}</Text>
                        <Text className="text-gray-500 text-xs">{new Date(tx.created_at).toLocaleDateString()} • {new Date(tx.created_at).toLocaleTimeString()}</Text>
                    </View>
                    <View className="items-end">
                        <Text className={`font-bold text-base ${tx.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>
                            {tx.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(tx.amount, currency)}
                        </Text>
                        <Text className={`text-xs ${
                            tx.status === 'SUCCESS' ? 'text-green-500' : 
                            tx.status === 'PENDING' ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                            {tx.status}
                        </Text>
                    </View>
                </View>
            ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
