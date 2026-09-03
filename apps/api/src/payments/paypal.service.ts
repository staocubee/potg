import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PaypalInitializeResult = {
  authorizationUrl: string;
  reference: string; // PayPal's own Order id — it assigns this, not the reference this scaffold generated
};

export type PaypalVerifyResult = {
  status: 'success' | 'failed' | 'pending' | string;
  amount: number;
  currency: string;
  reference: string;
};

export type PaypalTransferResult = {
  status: 'success' | 'pending' | 'failed' | string;
  transferReference: string; // PayPal's payout_batch_id
};

// The third real gateway integration. Structurally different from
// Paystack/Flutterwave in three ways worth flagging up front:
//  1. OAuth2 client-credentials, not a single secret key — PAYPAL_CLIENT_ID
//     + PAYPAL_CLIENT_SECRET exchange for a short-lived access token
//     (cached here, re-fetched once it's close to expiring), rather than a
//     static bearer header.
//  2. Deposits use PayPal's Orders API (create → buyer approves via the
//     returned link → capture), so verifyTransaction's job is actually
//     "capture the order", not just "read its status" — the capture call
//     itself only succeeds once the buyer has approved it, so an
//     unapproved order correctly reports "pending" rather than erroring.
//  3. Payouts target an email address (the PayPal Payouts API), not a bank
//     account — there is no bank code/account number involved at all,
//     hence Vendor.paypalPayoutEmail existing as its own field rather than
//     reusing bankAccountNumber/bankCode.
// Same "plain fetch, no SDK" shape as PaystackService/FlutterwaveService
// otherwise, and the same no-webhook, caller-initiated verification
// reasoning (see PaystackService's own comment).
@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('PAYPAL_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET', '');
    // Defaults to PayPal's sandbox host — same "nothing here ever needs to
    // be a live key for this scaffold" stance PAYSTACK_SECRET_KEY's own
    // .env.example comment already takes; PAYPAL_MODE=live is an explicit,
    // separate opt-in, never the default.
    const mode = this.config.get<string>('PAYPAL_MODE', 'sandbox');
    this.baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  get isConfigured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.accessToken;
    }
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      this.logger.error(`PayPal auth failed (${res.status}): ${data.error_description ?? data.error}`);
      throw new BadRequestException(`PayPal authentication failed: ${data.error_description ?? 'unknown error'}`);
    }
    // 60s safety margin so a token never expires mid-request.
    this.cachedToken = { accessToken: data.access_token, expiresAt: now + (data.expires_in ?? 300) * 1000 - 60_000 };
    return data.access_token;
  }

  private async headers() {
    const token = await this.getAccessToken();
    return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  }

  async initializeTransaction(params: {
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
  }): Promise<PaypalInitializeResult> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'PayPal is not configured on this server — set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET to accept real payments',
      );
    }
    const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: params.reference,
            amount: { currency_code: params.currency, value: params.amount.toFixed(2) },
          },
        ],
        application_context: { return_url: params.callbackUrl, cancel_url: params.callbackUrl },
      }),
    });
    const data = (await res.json()) as { id?: string; message?: string; links?: { rel: string; href: string }[] };
    const approveLink = data.links?.find((l) => l.rel === 'approve')?.href;
    if (!res.ok || !data.id || !approveLink) {
      this.logger.error(`PayPal order creation failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`PayPal couldn't start this payment: ${data.message ?? 'unknown error'}`);
    }
    return { authorizationUrl: approveLink, reference: data.id };
  }

  // Capturing IS the verification here — PayPal only lets a capture
  // succeed once the buyer has approved the order via the link above, so
  // "not yet approved" is reported as "pending" (a normal, expected state
  // to poll past) rather than an error, and an order this method already
  // captured once is looked up read-only instead of erroring on a second
  // call — see this class's own top comment.
  async verifyTransaction(orderId: string): Promise<PaypalVerifyResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('PayPal is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: await this.headers(),
    });
    const data = (await res.json()) as {
      status?: string;
      name?: string;
      details?: { issue: string }[];
      purchase_units?: { payments?: { captures?: { amount: { value: string; currency_code: string } }[] } }[];
    };

    if (res.ok && data.status === 'COMPLETED') {
      const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
      return {
        status: 'success',
        amount: capture ? Number(capture.amount.value) : 0,
        currency: capture?.amount.currency_code ?? '',
        reference: orderId,
      };
    }

    const issue = data.details?.[0]?.issue;
    if (issue === 'ORDER_NOT_APPROVED') {
      return { status: 'pending', amount: 0, currency: '', reference: orderId };
    }
    if (issue === 'ORDER_ALREADY_CAPTURED') {
      // Already captured by an earlier call — read its final state
      // instead of erroring on the second one, the same "callable more
      // than once safely" guarantee verifyDeposit already gives callers.
      const getRes = await fetch(`${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        headers: await this.headers(),
      });
      const getData = (await getRes.json()) as {
        status?: string;
        purchase_units?: { payments?: { captures?: { amount: { value: string; currency_code: string } }[] } }[];
      };
      const capture = getData.purchase_units?.[0]?.payments?.captures?.[0];
      return {
        status: getData.status === 'COMPLETED' ? 'success' : 'pending',
        amount: capture ? Number(capture.amount.value) : 0,
        currency: capture?.amount.currency_code ?? '',
        reference: orderId,
      };
    }

    this.logger.error(`PayPal capture failed (${res.status}): ${data.name} ${issue ?? ''}`);
    return { status: 'failed', amount: 0, currency: '', reference: orderId };
  }

  // Payouts API — pays a receiver by email rather than a bank account, so
  // there's no bank list/account-resolution pair here the way
  // Paystack/FlutterwaveService both have.
  async initiateTransfer(params: {
    amount: number;
    currency: string;
    email: string;
    reference: string;
    reason: string;
  }): Promise<PaypalTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('PayPal is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: params.reference,
          email_subject: 'You have a payout',
          email_message: params.reason,
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { value: params.amount.toFixed(2), currency: params.currency },
            receiver: params.email,
            note: params.reason,
            sender_item_id: params.reference,
          },
        ],
      }),
    });
    const data = (await res.json()) as {
      batch_header?: { payout_batch_id: string; batch_status: string };
      message?: string;
      details?: { issue?: string; description?: string; field?: string }[];
    };
    if (!res.ok || !data.batch_header) {
      const detail = data.details?.map((d) => `${d.field ?? d.issue ?? ''}: ${d.description ?? ''}`).join('; ');
      this.logger.error(`PayPal payout failed (${res.status}): ${data.message} ${detail ?? ''}`);
      throw new BadRequestException(`PayPal couldn't start this payout: ${data.message ?? 'unknown error'}${detail ? ` (${detail})` : ''}`);
    }
    return { status: this.mapBatchStatus(data.batch_header.batch_status), transferReference: data.batch_header.payout_batch_id };
  }

  async fetchTransfer(batchId: string): Promise<PaypalTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('PayPal is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
      headers: await this.headers(),
    });
    const data = (await res.json()) as { batch_header?: { payout_batch_id: string; batch_status: string }; message?: string };
    if (!res.ok || !data.batch_header) {
      this.logger.error(`PayPal payout fetch failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`PayPal couldn't look up this payout: ${data.message ?? 'unknown error'}`);
    }
    return { status: this.mapBatchStatus(data.batch_header.batch_status), transferReference: data.batch_header.payout_batch_id };
  }

  private mapBatchStatus(batchStatus: string): 'success' | 'pending' | 'failed' {
    if (batchStatus === 'SUCCESS') return 'success';
    if (batchStatus === 'DENIED' || batchStatus === 'FAILED') return 'failed';
    return 'pending'; // PENDING | PROCESSING | NEW
  }
}
