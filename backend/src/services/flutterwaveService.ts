import dotenv from 'dotenv';
import * as crypto from 'crypto';
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
   * Encrypt card payload using 3DES-ECB (required by Flutterwave direct card charge API).
   * Key is padded/trimmed to 24 bytes as required by Triple DES.
   */
  private encrypt3DES(data: string, encryptionKey: string): string {
    const keyBuf = Buffer.alloc(24);
    const rawKey = Buffer.from(encryptionKey, 'utf-8');
    rawKey.copy(keyBuf, 0, 0, Math.min(24, rawKey.length));
    const cipher = crypto.createCipheriv('des-ede3', keyBuf, '');
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(data, 'utf-8')),
      cipher.final(),
    ]);
    return encrypted.toString('base64');
  }

  /**
   * Directly charge a card (card-not-present flow) with Flutterwave 3DES-24 encryption.
   * Returns:
   *   { mode: 'success' }  — payment captured
   *   { mode: 'redirect', auth_url } — 3DS authentication needed
   *   { mode: 'pin', flw_ref } — OTP/PIN needed
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
      throw new Error('Flutterwave encryption key (FLW_ENCRYPTION_KEY) is not configured.');
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

    return res.json();
  }

  /** Verify a transaction by ID */
  async verifyTransaction(transactionId: string): Promise<FlwChargeResponse> {
    const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
      headers: this.headers(),
    });
    return res.json() as Promise<FlwChargeResponse>;
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
      country: 'NG',
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
