import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export type SumsubApplicantStatus = {
  reviewStatus: 'init' | 'pending' | 'queued' | 'completed' | 'onHold' | string;
  reviewAnswer?: 'GREEN' | 'RED' | null;
  rejectLabels?: string[];
};

// Real identity (KYC) verification, the same Module 6 gap
// DojahService used to close — swapped for Sumsub, a document+selfie
// review platform rather than a single-field (NIN) lookup, so the shape
// of this integration is genuinely different, not just a renamed
// DojahService. Same "plain fetch, no SDK, isConfigured gate" spirit
// every other gateway service in this scaffold already uses; the one
// real difference is auth — Sumsub signs every request with an
// HMAC-SHA256 over (timestamp + method + path + body) rather than a
// bearer token or two static headers, so `sign()` below does that once,
// shared by every call.
//
// Deliberately pull-based, same reasoning PaystackService's and
// DojahService's own comments already give for why this scaffold
// doesn't run webhook receivers: Sumsub's own document review happens
// asynchronously on their side, and normally you'd register a webhook
// URL for them to call back — but there's no stable public URL for a
// local dev environment to receive one, so IdentityService.refreshStatus
// polls GET /resources/applicants/:id/status on demand instead of
// waiting on a webhook this scaffold has nowhere to receive.
@Injectable()
export class SumsubService {
  private readonly logger = new Logger(SumsubService.name);
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly levelName: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.appToken = this.config.get<string>('SUMSUB_APP_TOKEN', '');
    this.secretKey = this.config.get<string>('SUMSUB_SECRET_KEY', '');
    // The verification flow configured in the Sumsub dashboard (Settings
    // > Verification levels) — applicants are created against one by
    // name, there's no sandbox-vs-production URL split the way Dojah
    // had (sandbox/production is which app token+secret pair you use,
    // both against the same host).
    this.levelName = this.config.get<string>('SUMSUB_LEVEL_NAME', '');
    this.baseUrl = this.config.get<string>('SUMSUB_BASE_URL', 'https://api.sumsub.com');
  }

  get isConfigured(): boolean {
    return this.appToken.length > 0 && this.secretKey.length > 0 && this.levelName.length > 0;
  }

  private sign(method: string, pathWithQuery: string, body: string): { ts: string; sig: string } {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', this.secretKey)
      .update(ts + method.toUpperCase() + pathWithQuery + body)
      .digest('hex');
    return { ts, sig };
  }

  private async request<T>(method: string, pathWithQuery: string, body?: unknown): Promise<T> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Identity verification is not configured on this server — set SUMSUB_APP_TOKEN/SUMSUB_SECRET_KEY/SUMSUB_LEVEL_NAME to enable it',
      );
    }
    const rawBody = body !== undefined ? JSON.stringify(body) : '';
    const { ts, sig } = this.sign(method, pathWithQuery, rawBody);
    const res = await fetch(`${this.baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        'X-App-Token': this.appToken,
        'X-App-Access-Sig': sig,
        'X-App-Access-Ts': ts,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? rawBody : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data as { description?: string })?.description ?? `request failed (${res.status})`;
      this.logger.error(`Sumsub ${method} ${pathWithQuery} failed: ${message}`);
      throw new BadRequestException(`Couldn't reach Sumsub: ${message}`);
    }
    return data as T;
  }

  // externalUserId is this scaffold's own User.id — an opaque identifier
  // from Sumsub's point of view, never anything sensitive.
  async createApplicant(externalUserId: string): Promise<{ applicantId: string }> {
    const data = await this.request<{ id: string }>(
      'POST',
      `/resources/applicants?levelName=${encodeURIComponent(this.levelName)}`,
      { externalUserId },
    );
    return { applicantId: data.id };
  }

  // A short-lived token (Sumsub's own default: ~10 minutes) the frontend
  // hands straight to the WebSDK to launch the document/selfie capture
  // flow — this backend never sees or stores the images themselves.
  async getAccessToken(externalUserId: string): Promise<{ token: string }> {
    const data = await this.request<{ token: string }>(
      'POST',
      `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(this.levelName)}`,
    );
    return { token: data.token };
  }

  async getApplicantStatus(applicantId: string): Promise<SumsubApplicantStatus> {
    const data = await this.request<{
      reviewStatus: string;
      reviewResult?: { reviewAnswer?: 'GREEN' | 'RED'; rejectLabels?: string[] };
    }>('GET', `/resources/applicants/${encodeURIComponent(applicantId)}/status`);
    return {
      reviewStatus: data.reviewStatus,
      reviewAnswer: data.reviewResult?.reviewAnswer ?? null,
      rejectLabels: data.reviewResult?.rejectLabels,
    };
  }
}
