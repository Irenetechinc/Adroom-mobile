import dotenv from 'dotenv';
dotenv.config();

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLW_BASE_URL   = 'https://api.flutterwave.com/v3';

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
}

export class FlutterwaveService {
  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FLW_SECRET_KEY}`,
    };
  }

  /** Verify a transaction by ID — used after user completes payment on the frontend */
  async verifyTransaction(transactionId: string): Promise<FlwChargeResponse> {
    const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
      headers: this.headers(),
    });
    return res.json() as Promise<FlwChargeResponse>;
  }

  /** Charge a saved card token (for renewals, on-demand top-ups, trial→subscription conversion) */
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

  /** Create an inline payment link payload (returned to frontend for FlwBtn) */
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
