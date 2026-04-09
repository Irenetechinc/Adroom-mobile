import dotenv from 'dotenv';
import forge from 'node-forge';
dotenv.config();

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLW_ENCRYPTION_KEY = process.env.FLW_ENCRYPTION_KEY || '';
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

interface FlwChargeResponse {
  status: string;
  message: string;
  data?: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: string;
    card?: {
      first_6digits: string;
      last_4digits: string;
      issuer: string;
      country: string;
      type: string;
      token: string;
      expiry: string;
    };
    customer: {
      id: number;
      email: string;
      name: string;
    };
  };
  meta?: {
    authorization?: {
      mode: string;
      redirect?: string;
      validate_instructions?: string;
    };
  };
}

export class FlutterwaveService {
  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FLW_SECRET_KEY}`,
    };
  }

  /**
   * Encrypt card payload using 3DES-ECB — exactly matching the official Flutterwave Node.js SDK.
   * Uses node-forge to ensure byte-perfect compatibility with Flutterwave's decryption.
   */
  private encrypt3DES(data: string, encryptionKey: string): string {
    const key = forge.util.createBuffer(encryptionKey);
    const cipher = forge.cipher.createCipher('3DES-ECB', key);
    cipher.start({ iv: '' });
    cipher.update(forge.util.createBuffer(data, 'utf8'));
    cipher.finish();
    return forge.util.encode64(cipher.output.getBytes());
  }

  /**
   * Directly charge a card via Flutterwave's card charge endpoint.
   * The card payload is encrypted with 3DES-ECB using the Flutterwave encryption key.
   *
   * NOTE: Flutterwave requires merchants to contact support to enable direct card charging
   * on their account. If you receive "merchant is not enabled for Rave v3", please contact
   * Flutterwave support and request activation of the "Direct Charge" feature.
   *
   * Returns one of:
   *   { mode: 'success' }  — payment captured immediately
   *   { mode: 'redirect', auth_url } — 3DS redirect needed (open in WebView)
   *   { mode: 'pin', flw_ref } — OTP/PIN required (show in-app modal)
   */
  async chargeCard(params: {
    cardNumber: string;
    cvv: string;
    expiryMonth: string;
    expiryYear: string;
    email: string;
    fullname: string;
    amount: number;
    currency: string;
    tx_ref: string;
    redirect_url: string;
    enckey?: string;
  }): Promise<any> {
    const encryptionKey = params.enckey || FLW_ENCRYPTION_KEY;

    if (!encryptionKey) {
      throw new Error(
        'FLW_ENCRYPTION_KEY is not configured. Please add your Flutterwave encryption key to the environment variables.',
      );
    }

    if (!FLW_SECRET_KEY) {
      throw new Error('FLW_SECRET_KEY is not configured.');
    }

    const cardPayload = {
      card_number: params.cardNumber.replace(/\s/g, ''),
      cvv: params.cvv,
      expiry_month: params.expiryMonth.trim(),
      expiry_year: params.expiryYear.trim(),
      currency: params.currency,
      amount: params.amount,
      email: params.email,
      fullname: params.fullname,
      tx_ref: params.tx_ref,
      redirect_url: params.redirect_url,
    };

    const encryptedClient = this.encrypt3DES(JSON.stringify(cardPayload), encryptionKey);

    const res = await fetch(`${FLW_BASE_URL}/charges?type=card`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ client: encryptedClient }),
    });

    const result = await res.json();

    if (result.message && typeof result.message === 'string') {
      const msg = result.message.toLowerCase();
      if (msg.includes('not enabled') || msg.includes('rave v3')) {
        console.error(
          '[Flutterwave] Direct card charge not enabled for this merchant.',
          'Please contact Flutterwave support to activate the Direct Charge feature.',
          'Error:', result.message,
        );
      }
    }

    return result;
  }

  /** Verify a transaction by ID */
  async verifyTransaction(transactionId: string): Promise<FlwChargeResponse> {
    const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
      headers: this.headers(),
    });
    return res.json() as Promise<FlwChargeResponse>;
  }

  /**
   * Look up and verify a transaction by tx_ref.
   * Used as a fallback when the numeric transaction_id is not available
   * (e.g. the mobile WebView couldn't extract it from the redirect URL).
   * Returns the first matching successful transaction, or null.
   */
  async verifyByTxRef(txRef: string): Promise<FlwChargeResponse | null> {
    if (!txRef) return null;
    try {
      const res = await fetch(
        `${FLW_BASE_URL}/transactions?tx_ref=${encodeURIComponent(txRef)}`,
        { headers: this.headers() },
      );
      const data: any = await res.json();
      if (data.status !== 'success' || !Array.isArray(data.data) || data.data.length === 0) {
        return null;
      }
      const tx = data.data.find((t: any) => t.status === 'successful') ?? data.data[0];
      if (!tx?.id) return null;
      return this.verifyTransaction(String(tx.id));
    } catch {
      return null;
    }
  }

  /** Charge a saved card token */
  async chargeToken(params: {
    token: string;
    email: string;
    amount: number;
    currency?: string;
    tx_ref: string;
    narration: string;
  }): Promise<FlwChargeResponse> {
    const payload = {
      token: params.token,
      currency: params.currency ?? 'USD',
      amount: params.amount,
      email: params.email,
      tx_ref: params.tx_ref,
      narration: params.narration,
    };

    const res = await fetch(`${FLW_BASE_URL}/tokenized-charges`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    return res.json() as Promise<FlwChargeResponse>;
  }

  /** Generate a unique transaction reference */
  generateTxRef(prefix = 'ADROOM'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  }

  /** Build inline payment link payload */
  buildPaymentPayload(params: {
    amount: number;
    currency: string;
    email: string;
    name: string;
    phone?: string;
    tx_ref: string;
    redirect_url: string;
    title: string;
    description: string;
    meta?: Record<string, string>;
  }) {
    return {
      public_key: process.env.FLW_PUBLIC_KEY || '',
      tx_ref: params.tx_ref,
      amount: params.amount,
      currency: params.currency,
      redirect_url: params.redirect_url,
      meta: params.meta ?? {},
      customer: {
        email: params.email,
        name: params.name,
        phonenumber: params.phone ?? '',
      },
      customizations: {
        title: params.title,
        description: params.description,
        logo: 'https://adroom.app/logo.png',
      },
    };
  }
}

export const flutterwaveService = new FlutterwaveService();
