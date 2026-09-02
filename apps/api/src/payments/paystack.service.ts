import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PaystackInitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type PaystackVerifyResult = {
  status: 'success' | 'failed' | 'abandoned' | string;
  amountKobo: number;
  currency: string;
  reference: string;
};

// A real payment gateway integration — see the schema comment on Payment
// for what "provider"/"providerReference" were always meant for. Same
// "plain fetch, no SDK" shape AnthropicLlmProvider already uses, kept
// deliberately small: Initialize + Verify Transaction is the whole
// integration (Section 16's actual minimum — "process real transactions"),
// not the full Paystack API surface. No webhook receiver: this scaffold
// runs on localhost with no public URL for Paystack to call back to, so
// verification is caller-initiated (the buyer clicks "I've paid" and the
// backend asks Paystack directly) rather than push-based. A production
// deployment behind a real domain would add a webhook as the primary path
// and keep this as the fallback for a buyer who closes the tab early.
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY', '');
  }

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  // Paystack amounts are always in the smallest currency unit (kobo for
  // NGN, cents for USD/GHS/ZAR) — this scaffold's own amounts are always
  // whole currency units (e.g. "50000" meaning 50,000 NGN), same as every
  // other Decimal(14,2) amount field in this schema.
  async initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaystackInitializeResult> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Paystack is not configured on this server — set PAYSTACK_SECRET_KEY to accept real payments',
      );
    }
    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify({
        email: params.email,
        amount: Math.round(params.amount * 100),
        currency: params.currency,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      }),
    });

    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { authorization_url: string; access_code: string; reference: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack initialize failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't start this payment: ${data.message}`);
    }
    return {
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });

    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { status: string; amount: number; currency: string; reference: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack verify failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't verify this payment: ${data.message}`);
    }
    return {
      status: data.data.status,
      amountKobo: data.data.amount,
      currency: data.data.currency,
      reference: data.data.reference,
    };
  }
}
