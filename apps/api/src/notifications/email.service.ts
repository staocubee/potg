import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// A real email provider — the last "logged + returned raw" scaffold-depth
// tradeoff this codebase carries (password reset, invites). Same "plain
// fetch, no SDK" shape AnthropicLlmProvider/PaystackService already use,
// via Resend's API. Falls back to `isConfigured === false` the same way
// PaystackService does when no key is set, so every caller keeps working
// without one — see AuthService.forgotPassword and
// AccountsService.addMember/resendInvite for how they use that.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly from: string;
  private readonly baseUrl = 'https://api.resend.com';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('RESEND_API_KEY', '');
    // Resend's own sandbox sender — works with no domain verification, but
    // Resend then only actually delivers to the email address the API key's
    // own account is registered with, not arbitrary recipients. A verified
    // custom domain (EMAIL_FROM) lifts that restriction — see the README.
    this.from = this.config.get<string>('EMAIL_FROM', 'PropertyOnTheGo <onboarding@resend.dev>');
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // Returns whether the email was actually accepted for delivery — every
  // caller uses this to decide whether it's still safe to fall back to
  // logging/returning the raw link (only when this comes back false) or
  // whether that fallback would now be a real security regression (once a
  // provider is configured, a caller should stop handing out reset/invite
  // tokens in the response). Never throws: an email provider being down is
  // not a reason to fail the request that triggered the email.
  async send(params: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const res = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: params.to, subject: params.subject, html: params.html, text: params.text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.logger.error(`Resend send to ${params.to} failed (${res.status}): ${JSON.stringify(data)}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Resend send to ${params.to} threw: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
