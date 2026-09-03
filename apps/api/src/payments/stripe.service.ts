import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type StripeInitializeResult = {
  authorizationUrl: string;
  reference: string; // Stripe's own Checkout Session id — it assigns this, not the reference this scaffold generated
};

export type StripeVerifyResult = {
  status: 'success' | 'failed' | 'pending' | string;
  amount: number;
  currency: string;
  reference: string;
};

// The fourth gateway Section 16 named, deliberately left inactive: not
// ready to be plugged in yet, so this exists as a correctly-shaped
// deposit gateway (same "plain fetch, no SDK" contract as
// Paystack/Flutterwave/PaypalService) gated by the same isConfigured
// pattern PaystackService already established — set STRIPE_SECRET_KEY
// later and this starts working with no code changes, exactly the way
// PAYSTACK_SECRET_KEY being unset already falls every deposit back to the
// "manual" simulated path with nothing breaking.
//
// Deposit-only, on purpose — payouts are explicitly NOT covered here.
// Paystack/Flutterwave/PayPal all pay a vendor directly (a bank account
// or an email address) from this platform's own gateway balance; Stripe's
// equivalent is Stripe Connect, a materially different product requiring
// each vendor to onboard their own connected account through a separate
// flow before this platform could ever pay one — not something a single
// service class can "complete in advance" the way a checkout integration
// can. Building a payout path against the wrong API shape would be worse
// than not building one at all, so this scaffold doesn't pretend to.
//
// One real API-shape difference from the other three gateways: Stripe's
// REST API takes `application/x-www-form-urlencoded` bodies with
// bracket-notation keys for nested objects/arrays (e.g.
// `line_items[0][price_data][unit_amount]`), not JSON — toFormBody below
// exists only to build that encoding correctly.
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.stripe.com/v1';

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('STRIPE_SECRET_KEY', '');
  }

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  private headers() {
    return {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Bearer ${this.secretKey}`,
    };
  }

  async initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<StripeInitializeResult> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Stripe is not configured on this server — set STRIPE_SECRET_KEY to accept real payments',
      );
    }
    const body = toFormBody({
      mode: 'payment',
      success_url: params.callbackUrl,
      cancel_url: params.callbackUrl,
      customer_email: params.email,
      client_reference_id: params.reference,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: Math.round(params.amount * 100),
            product_data: { name: 'PropertyOnTheGo escrow deposit' },
          },
        },
      ],
      metadata: params.metadata ?? {},
    });
    const res = await fetch(`${this.baseUrl}/checkout/sessions`, { method: 'POST', headers: this.headers(), body });
    const data = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !data.id || !data.url) {
      this.logger.error(`Stripe checkout session creation failed (${res.status}): ${data.error?.message}`);
      throw new BadRequestException(`Stripe couldn't start this payment: ${data.error?.message ?? 'unknown error'}`);
    }
    return { authorizationUrl: data.url, reference: data.id };
  }

  async verifyTransaction(sessionId: string): Promise<StripeVerifyResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Stripe is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    const data = (await res.json()) as {
      status?: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      error?: { message: string };
    };
    if (!res.ok) {
      this.logger.error(`Stripe session fetch failed (${res.status}): ${data.error?.message}`);
      throw new BadRequestException(`Stripe couldn't look up this payment: ${data.error?.message ?? 'unknown error'}`);
    }
    if (data.status === 'expired') {
      return { status: 'failed', amount: 0, currency: '', reference: sessionId };
    }
    if (data.payment_status === 'paid' || data.payment_status === 'no_payment_required') {
      return {
        status: 'success',
        amount: (data.amount_total ?? 0) / 100,
        currency: (data.currency ?? '').toUpperCase(),
        reference: sessionId,
      };
    }
    return { status: 'pending', amount: 0, currency: '', reference: sessionId };
  }
}

// Flattens a nested object into Stripe's bracket-notation form encoding —
// { line_items: [{ a: 1 }] } becomes "line_items[0][a]=1". Only handles
// the shapes this file's own request bodies actually use (objects,
// arrays, and primitives), not every case the full Stripe API surface
// could throw at it.
function toFormBody(value: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (key: string, val: unknown) => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) {
      val.forEach((item, i) => walk(`${key}[${i}]`, item));
    } else if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        walk(`${key}[${k}]`, v);
      }
    } else {
      params.append(key, String(val));
    }
  };
  for (const [key, val] of Object.entries(value)) walk(key, val);
  return params.toString();
}
