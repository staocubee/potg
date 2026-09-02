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

export type PaystackBank = { name: string; code: string; currency: string };

export type PaystackResolvedAccount = { accountNumber: string; accountName: string };

export type PaystackTransferResult = {
  status: 'success' | 'pending' | 'otp' | 'failed' | string;
  transferCode: string;
};

// A real payment gateway integration — see the schema comment on Payment
// for what "provider"/"providerReference" were always meant for. Same
// "plain fetch, no SDK" shape AnthropicLlmProvider already uses, kept
// deliberately small: Initialize/Verify Transaction for deposits, and
// Transfer Recipient + Transfer for payouts — Section 16's actual
// minimum ("process real transactions"), not the full Paystack API
// surface. No webhook receiver: this scaffold runs on localhost with no
// public URL for Paystack to call back to, so verification is
// caller-initiated (the buyer/owner clicks a "verify"/"check status"
// action and the backend asks Paystack directly) rather than push-based.
// A production deployment behind a real domain would add a webhook as
// the primary path and keep this as the fallback.
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

  // --- Transfers (payouts) — the other half of Section 16's "process
  // real transactions". Bank list + account resolution let the web UI
  // build a real "pick your bank, enter your account number" form instead
  // of asking a vendor to already know a Paystack bank code; resolving
  // confirms the account is real and returns Paystack's own name for it
  // before a recipient is ever created from it.

  async listBanks(currency = 'NGN'): Promise<PaystackBank[]> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/bank?currency=${encodeURIComponent(currency)}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    const data = (await res.json()) as { status: boolean; message: string; data?: PaystackBank[] };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack bank list failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't list banks: ${data.message}`);
    }
    return data.data;
  }

  async resolveAccountNumber(accountNumber: string, bankCode: string): Promise<PaystackResolvedAccount> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(
      `${this.baseUrl}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      { headers: { authorization: `Bearer ${this.secretKey}` } },
    );
    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { account_number: string; account_name: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack account resolve failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Couldn't verify that bank account: ${data.message}`);
    }
    return { accountNumber: data.data.account_number, accountName: data.data.account_name };
  }

  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
    currency: string;
  }): Promise<string> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transferrecipient`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify({
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: params.currency,
      }),
    });
    const data = (await res.json()) as { status: boolean; message: string; data?: { recipient_code: string } };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack recipient creation failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't set up this payout recipient: ${data.message}`);
    }
    return data.data.recipient_code;
  }

  async initiateTransfer(params: {
    amount: number;
    currency: string;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<PaystackTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transfer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(params.amount * 100),
        currency: params.currency,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
      }),
    });
    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { status: string; transfer_code: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack transfer failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't start this payout: ${data.message}`);
    }
    return { status: data.data.status, transferCode: data.data.transfer_code };
  }

  async fetchTransfer(transferCode: string): Promise<PaystackTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transfer/${encodeURIComponent(transferCode)}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { status: string; transfer_code: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack transfer fetch failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't look up this payout: ${data.message}`);
    }
    return { status: data.data.status, transferCode: data.data.transfer_code };
  }

  // A newly created Paystack integration has OTP-based transfer
  // finalization on by default (confirmed live: initiateTransfer above
  // came back "otp", not "success", against this scaffold's own test
  // key) — the OTP goes to whoever owns the Paystack account, by email or
  // SMS, so this scaffold can't obtain one on its own; it can only ever
  // relay one a human types in. Disabling OTP entirely is a dashboard
  // setting (Settings → Preferences → Transfers) only the account holder
  // can change, not something this integration can or should do for them.
  async finalizeTransferOtp(transferCode: string, otp: string): Promise<PaystackTransferResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('Paystack is not configured on this server');
    }
    const res = await fetch(`${this.baseUrl}/transfer/finalize_transfer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify({ transfer_code: transferCode, otp }),
    });
    const data = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { status: string; transfer_code: string };
    };
    if (!res.ok || !data.status || !data.data) {
      this.logger.error(`Paystack transfer finalize failed (${res.status}): ${data.message}`);
      throw new BadRequestException(`Paystack couldn't finalize this payout: ${data.message}`);
    }
    return { status: data.data.status, transferCode: data.data.transfer_code };
  }
}
