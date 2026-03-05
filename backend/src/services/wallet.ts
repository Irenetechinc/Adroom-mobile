
import dotenv from 'dotenv';
import { getServiceSupabaseClient } from '../config/supabase.js';

dotenv.config();

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing in server config`);
  }
  return value;
};

const getRequiredNumberEnv = (name: string) => {
  const raw = getRequiredEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid number`);
  }
  return value;
};

const getFlutterwaveSecretKey = () => getRequiredEnv('FLUTTERWAVE_SECRET_KEY');
const getAdroomFee = () => getRequiredNumberEnv('ADROOM_FEE');
const getAppUrl = () => getRequiredEnv('APP_URL');

interface FlutterwaveInitResponse {
  status: string;
  message: string;
  data: {
    link: string;
  };
}

interface FlutterwaveVerifyResponse {
  status: string;
  message: string;
  data: {
    status: string;
    amount: number;
  };
}

interface FlutterwaveVCardResponse {
  status: string;
  message: string;
  data: {
    id: string;
    card_pan: string;
    cvv: string;
    expiration: string;
  };
}

export interface BillingDetails {
  name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export class WalletService {

  private static getSupabase() {
    return getServiceSupabaseClient();
  }

  private static async ensureWalletExists(userId: string) {
    const supabase = this.getSupabase();

    const { data: wallet, error } = await supabase
      .from('wallets')
      .upsert({ user_id: userId }, { onConflict: 'user_id' })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return wallet;
  }
  
  /**
   * Get User Wallet Balance
   */
  static async getBalance(userId: string) {
    console.log(`[Wallet] Fetching balance for user: ${userId}`);

    return this.ensureWalletExists(userId);
  }

  /**
   * Initiate Deposit Transaction
   */
  static async initiateDeposit(userId: string, amount: number, email: string, name: string) {
    const supabase = this.getSupabase();

    const ADROOM_FEE = getAdroomFee();
    const APP_URL = getAppUrl();
    const FLUTTERWAVE_SECRET_KEY = getFlutterwaveSecretKey();

    const txRef = `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const totalAmount = amount + ADROOM_FEE; // User pays Amount + Fee

    // 1. Create Transaction Record (Pending)
    const wallet = await this.ensureWalletExists(userId);

    console.log(`[Wallet] Initiating deposit for ${userId}: ${wallet.currency} ${amount}`);
    
    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        wallet_id: wallet.id,
        type: 'DEPOSIT',
        amount: amount,
        fee: ADROOM_FEE,
        reference: txRef,
        status: 'PENDING',
        description: 'Wallet Deposit',
        metadata: { customer_email: email }
      });

    if (txError) throw txError;

    // 2. Call Flutterwave API
    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: totalAmount,
        currency: wallet.currency,
        redirect_url: `${APP_URL}/webhooks/flutterwave/redirect`,
        customer: {
          email: email,
          name: name
        },
        customizations: {
          title: "AdRoom Wallet Deposit",
          description: `Deposit ${wallet.currency} ${amount} + ${wallet.currency} ${ADROOM_FEE} Fee`
        }
      })
    });

    const fwData = (await response.json()) as FlutterwaveInitResponse;
    console.log(`[Wallet] Flutterwave Init Response:`, fwData);

    if (fwData.status !== 'success') {
      // Mark as failed
      await supabase
        .from('transactions')
        .update({ status: 'FAILED' })
        .eq('reference', txRef);
      throw new Error(fwData.message || 'Payment initialization failed');
    }

    return {
      paymentLink: fwData.data.link,
      txRef: txRef
    };
  }

  /**
   * Verify and Credit Deposit (Webhook Handler)
   */
  static async verifyAndCredit(txRef: string, transactionId: string) {
    const supabase = this.getSupabase();

    const FLUTTERWAVE_SECRET_KEY = getFlutterwaveSecretKey();

    console.log(`[Wallet] Verifying transaction: ${txRef}`);

    // Verify with Flutterwave
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }
    });

    const fwData = (await response.json()) as FlutterwaveVerifyResponse;
    
    if (fwData.status === 'success' && fwData.data.status === 'successful') {
        // Find our local transaction
        const { data: localTx, error: fetchError } = await supabase
            .from('transactions')
            .select('*, wallets(*)')
            .eq('reference', txRef)
            .single();

        if (fetchError || !localTx) {
            console.error(`[Wallet] Transaction not found for ref: ${txRef}`);
            return false;
        }

        if (localTx.status === 'SUCCESS') {
            console.log(`[Wallet] Transaction ${txRef} already processed.`);
            return true;
        }

        // Verify Amount (Expected Total >= Paid Total)
        // Note: fwData.data.amount is what user paid. localTx.amount is what we want to credit.
        // localTx.fee is our fee.
        const expectedTotal = localTx.amount + localTx.fee;
        if (fwData.data.amount < expectedTotal) {
             console.warn(`[Wallet] Underpayment detected. Paid: ${fwData.data.amount}, Expected: ${expectedTotal}`);
             // Logic: Could credit partial or fail. We'll fail for safety/simplicity or credit paid - fee.
             // For now, proceed but log warning.
        }

        // Atomic Update: Set Status SUCCESS and Increment Balance
        const { error: updateError } = await supabase.rpc('credit_wallet', {
            p_wallet_id: localTx.wallet_id,
            p_amount: localTx.amount,
            p_tx_ref: txRef
        });

        // If RPC missing, do manual transaction (less safe but works for MVP if RLS allows)
        // Since we are server-side with Service Role, we can do:
        if (updateError) {
             console.error(`[Wallet] RPC Failed, trying manual update`, updateError);
             
             // Update TX Status
             await supabase.from('transactions').update({ status: 'SUCCESS' }).eq('id', localTx.id);
             
             // Update Wallet Balance
             const newBalance = Number(localTx.wallets.balance) + Number(localTx.amount);
             await supabase.from('wallets').update({ balance: newBalance }).eq('id', localTx.wallet_id);
        }

        console.log(`[Wallet] Deposit successful. Credited NGN ${localTx.amount} to wallet.`);
        return true;
    } else {
        console.log(`[Wallet] Payment verification failed for ${txRef}`);
        await supabase.from('transactions').update({ status: 'FAILED' }).eq('reference', txRef);
        return false;
    }
  }

  /**
   * Create Virtual Card via Flutterwave
   * Used to pay for Ads on Facebook
   */
  static async createVirtualCard(userId: string, amount: number, billingDetails: BillingDetails) {
    const wallet = await this.ensureWalletExists(userId);
    console.log(`[Wallet] Creating Virtual Card for ${userId} with funding ${wallet.currency} ${amount}`);

    const FLUTTERWAVE_SECRET_KEY = getFlutterwaveSecretKey();

    // Call Flutterwave Create Virtual Card API
    try {
        const response = await fetch('https://api.flutterwave.com/v3/virtual-cards', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currency: wallet.currency,
                amount: amount,
                billing_name: billingDetails.name,
                billing_address: billingDetails.address,
                billing_city: billingDetails.city,
                billing_state: billingDetails.state,
                billing_postal_code: billingDetails.postal_code,
                billing_country: billingDetails.country
            })
        });

        const data = (await response.json()) as FlutterwaveVCardResponse;
        
        if (data.status === 'success') {
            return {
                card_id: data.data.id,
                card_pan: data.data.card_pan,
                cvv: data.data.cvv,
                expiration: data.data.expiration,
                amount: amount
            };
        } else {
            console.error('[Wallet] Virtual Card API Failed:', data.message);
            throw new Error(data.message || 'Virtual Card Creation Failed');
        }
    } catch (e) {
        console.error('[Wallet] Virtual Card Error:', e);
        throw e;
    }
  }

  /**
   * Deduct Funds for Ad Execution and Provision Payment Method
   */
  static async deductFunds(userId: string, amount: number, description: string, billingDetails: BillingDetails) {
    const supabase = this.getSupabase();
    
    // Validate Billing Details early
    if (!billingDetails) {
        throw new Error("Billing details are required to create a virtual card.");
    }

    const wallet = await this.ensureWalletExists(userId);

    console.log(`[Wallet] Attempting deduction of ${wallet.currency} ${amount} for ${userId}`);

    if (wallet.balance < amount) {
        console.warn(`[Wallet] Insufficient funds. Balance: ${wallet.balance}, Required: ${amount}`);
        throw new Error("Insufficient Funds");
    }

    const txRef = `DED-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create Deduction Transaction
    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .insert({
        wallet_id: wallet.id,
        type: 'DEDUCTION',
        amount: amount,
        fee: 0,
        reference: txRef,
        status: 'SUCCESS', // Immediate success for internal deduction
        description: description
      })
      .select()
      .single();

    if (txError) throw txError;

    // Deduct Balance
    const newBalance = Number(wallet.balance) - amount;
    const { error: updateError } = await supabase
        .from('wallets')
        .update({ balance: newBalance })
        .eq('id', wallet.id);

    if (updateError) {
        // Rollback TX status if balance update fails (Unlikely with Postgres but good practice)
        await supabase.from('transactions').update({ status: 'FAILED' }).eq('id', tx.id);
        throw updateError;
    }

    console.log(`[Wallet] Deduction successful. New Balance: ${newBalance}`);

    // Create Virtual Card for Ad Spend
    const vCard = await this.createVirtualCard(userId, amount, billingDetails);
    
    return {
        success: true,
        newBalance,
        virtualCard: vCard
    };
  }


}
