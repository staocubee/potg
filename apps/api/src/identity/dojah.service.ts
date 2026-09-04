import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type DojahNinRecord = {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string;
  gender?: string;
  phoneNumber?: string;
};

// Real identity (KYC) verification — Module 6's actual gap that isn't
// about a business (Vendor/Supplier.verificationStatus) or a document
// (Document.verificationStatus): the person behind an account. Same
// "plain fetch, no SDK, isConfigured gate" shape every other gateway
// service in this scaffold already uses (PaystackService et al.).
//
// Dojah's NIN Lookup is a single GET call, not a multi-step flow — no
// webhook needed, matching the pull-based verification reasoning
// PaystackService's own comment already gives for why this scaffold
// doesn't run webhook receivers. Unlike a payment gateway's secret key,
// Dojah auth is two headers together (AppId + a raw secret key in
// Authorization — not a Bearer token).
@Injectable()
export class DojahService {
  private readonly logger = new Logger(DojahService.name);
  private readonly appId: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.appId = this.config.get<string>('DOJAH_APP_ID', '');
    this.secretKey = this.config.get<string>('DOJAH_SECRET_KEY', '');
    // Defaults to Dojah's sandbox host — same "nothing here ever needs to
    // be live for this scaffold" stance every other gateway's env var
    // takes. DOJAH_ENV=production is an explicit opt-in only.
    const env = this.config.get<string>('DOJAH_ENV', 'sandbox');
    this.baseUrl = env === 'production' ? 'https://api.dojah.io' : 'https://sandbox.dojah.io';
  }

  get isConfigured(): boolean {
    return this.appId.length > 0 && this.secretKey.length > 0;
  }

  async lookupNin(nin: string): Promise<DojahNinRecord> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Identity verification is not configured on this server — set DOJAH_APP_ID/DOJAH_SECRET_KEY to enable it',
      );
    }
    const res = await fetch(`${this.baseUrl}/api/v1/kyc/nin?nin=${encodeURIComponent(nin)}`, {
      headers: { AppId: this.appId, Authorization: this.secretKey },
    });
    const data = (await res.json()) as {
      entity?: {
        first_name?: string;
        last_name?: string;
        middle_name?: string;
        date_of_birth?: string;
        gender?: string;
        phone_number?: string;
        telephone_number?: string;
      };
      error?: string;
      message?: string;
    };
    if (!res.ok || !data.entity?.first_name || !data.entity?.last_name) {
      const message = data.error ?? data.message ?? `no record found for that NIN`;
      this.logger.error(`Dojah NIN lookup failed (${res.status}): ${message}`);
      throw new BadRequestException(`Couldn't verify that NIN: ${message}`);
    }
    return {
      firstName: data.entity.first_name,
      lastName: data.entity.last_name,
      middleName: data.entity.middle_name,
      dateOfBirth: data.entity.date_of_birth,
      gender: data.entity.gender,
      phoneNumber: data.entity.phone_number ?? data.entity.telephone_number,
    };
  }
}
