import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FlutterwaveInitializeResult = {
  authorizationUrl: string;
  reference: string;
};

export type FlutterwaveVerifyResult = {
  status: 'success' | 'failed' | 'pending' | string;
  amount: number; // Flutterwave amounts are already in the currency's major unit — NOT kobo/cents like Paystack's
  currency: string;
  reference: string;
};

export type FlutterwaveBank = { name: string; code: string; currency: string };

export type FlutterwaveResolvedAccount = { accountNumber: string; accountName: string };

export type FlutterwaveTransferResult = {
  status: 'success' | 'pending' | 'failed' | string;
  transferReference: string;
};

// The second real gateway integration, next to PaystackService — same
// "plain fetch, no SDK" shape, same Initialize/Verify for deposits and
// Transfer for payouts. One structural difference worth flagging: unlike
// Paystack, Flutterwave's Transfer API takes the destination bank account
// directly on every transfer call — there's no separate "create a
// recipient first, cache its id" step, so this has no equivalent to
// PaystackService.createTransferRecipient or Vendor.paystackRecipientCode.
// Also unlike Paystack: Flutterwave amounts are already in the currency's
// major unit (5000 means 5000 NGN, not 50 NGN in kobo) — every method
// here reflects that directly rather than multiplying/dividing by 100.
@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.flutterwave.com/v3';

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('FLUTTERWAVE_SECRET_KEY', '');
  }

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  private headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.secretKey}` };
  }

  async initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<FlutterwaveInitializeResult> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Flutterwave is not configured on this server — set FLUTTERWAVE_SECRET_KEY to accept real payments',
      );
    }
    const res = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        tx_ref: params.reference,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.callbackUrl,
        customer: { email: params.email },
        meta: params.metadata,
      }),
    });
    const data = (await res.json()) as { status: string; message: string; data?: { link: string } };
    if (!res.ok || data.status !== 'success' || !data.data) {
      this.logger.error(`Flutterwave initialize failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Flutterwave couldn't start this payment: ${data.message}`);
    }
    return { authorizationUrl: data.data.link, reference: params.reference };
  }

  // Flutterwave verifies by the tx_ref this scaffold itself generated,
  // same reference-in-reference-out shape PaystackService.verifyTransaction
  // already gives PaymentsService to dispatch on generically.
  async verifyTransaction(reference: string): Promise<FlutterwaveVerifyResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Flutterwave is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: this.headers(),
    });
    const data = (await res.json()) as {
      status: string;
      message: string;
      data?: { status: string; amount: number; currency: string; tx_ref: string };
    };
    if (!res.ok || data.status !== 'success' || !data.data) {
      // A tx_ref the buyer never completed checkout for 404s here rather
      // than returning a "pending" record — same "not a final answer yet"
      // treatment verifyDeposit already gives Paystack's "abandoned".
      return { status: 'pending', amount: 0, currency: '', reference };
    }
    const mapped = data.data.status === 'successful' ? 'success' : data.data.status === 'failed' ? 'failed' : 'pending';
    return { status: mapped, amount: data.data.amount, currency: data.data.currency, reference: data.data.tx_ref };
  }

  // Bank list + account resolution — same purpose as PaystackService's own
  // pair, against Flutterwave's own (different) bank code list. A bank
  // code valid for Paystack is not valid for Flutterwave and vice versa,
  // even for the same physical bank — this is why Vendor.bankCode is only
  // ever meaningful alongside whichever payoutProvider it was resolved
  // against.
  async listBanks(currency = 'NGN'): Promise<FlutterwaveBank[]> {
    if (!this.isConfigured) {
      throw new BadRequestException('Flutterwave is not configured on this server');
    }
    const countryCode = currency === 'NGN' ? 'NG' : currency === 'GHS' ? 'GH' : currency === 'KES' ? 'KE' : 'NG';
    const res = await fetch(`${this.baseUrl}/banks/${countryCode}`, { headers: this.headers() });
    const data = (await res.json()) as { status: string; message: string; data?: { name: string; code: string }[] };
    if (!res.ok || data.status !== 'success' || !data.data) {
      this.logger.error(`Flutterwave bank list failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Flutterwave couldn't list banks: ${data.message}`);
    }
    return data.data.map((b) => ({ name: b.name, code: b.code, currency }));
  }

  async resolveAccountNumber(accountNumber: string, bankCode: string): Promise<FlutterwaveResolvedAccount> {
    if (!this.isConfigured) {
      throw new BadRequestException('Flutterwave is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/accounts/resolve`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
    });
    const data = (await res.json()) as {
      status: string;
      message: string;
      data?: { account_number: string; account_name: string };
    };
    if (!res.ok || data.status !== 'success' || !data.data) {
      this.logger.error(`Flutterwave account resolve failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Couldn't verify that bank account: ${data.message}`);
    }
    return { accountNumber: data.data.account_number, accountName: data.data.account_name };
  }

  // One-step transfer — no recipient object to create first (see this
  // class's own top comment).
  async initiateTransfer(params: {
    amount: number;
    currency: string;
    accountNumber: string;
    bankCode: string;
    accountName: string;
    reference: string;
    reason: string;
  }): Promise<FlutterwaveTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Flutterwave is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transfers`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        account_bank: params.bankCode,
        account_number: params.accountNumber,
        amount: params.amount,
        currency: params.currency,
        narration: params.reason,
        reference: params.reference,
        beneficiary_name: params.accountName,
      }),
    });
    const data = (await res.json()) as { status: string; message: string; data?: { status: string; reference: string } };
    if (!res.ok || data.status !== 'success' || !data.data) {
      this.logger.error(`Flutterwave transfer failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Flutterwave couldn't start this payout: ${data.message}`);
    }
    // NEW/pending transfers settle asynchronously on Flutterwave's side —
    // mapped the same way Paystack's non-immediate statuses are: leave it
    // "processing" until fetchTransfer confirms a final answer.
    const mapped = data.data.status === 'SUCCESSFUL' ? 'success' : data.data.status === 'FAILED' ? 'failed' : 'pending';
    return { status: mapped, transferReference: data.data.reference };
  }

  async fetchTransfer(reference: string): Promise<FlutterwaveTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Flutterwave is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transfers?reference=${encodeURIComponent(reference)}`, {
      headers: this.headers(),
    });
    const data = (await res.json()) as {
      status: string;
      message: string;
      data?: { status: string; reference: string }[];
    };
    const match = data.data?.[0];
    if (!res.ok || data.status !== 'success' || !match) {
      this.logger.error(`Flutterwave transfer fetch failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Flutterwave couldn't look up this payout: ${data.message}`);
    }
    const mapped = match.status === 'SUCCESSFUL' ? 'success' : match.status === 'FAILED' ? 'failed' : 'pending';
    return { status: mapped, transferReference: match.reference };
  }
}
