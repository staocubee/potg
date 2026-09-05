import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// The one place in this scaffold something durable needs to live for two
// different reasons: something this codebase generates (a visualization
// image, not a URL the caller already hosts), and now — see uploadFile
// below — something a USER uploads directly (a document, a piece of
// evidence), closing "a general file-upload/media pipeline" the README
// used to flag as still missing (StorageService existed, but was wired
// only into the one narrow AI-visualization path). Real object storage
// (Cloudflare R2, S3-compatible), not a fake "just keep the provider's
// own URL" shortcut: OpenAiImageService's own result URL typically
// expires in hours, so without this, a generated visualization would go
// dead the day after it was created — and a raw upload has nowhere to
// live at all without it.
//
// Uses the official @aws-sdk/client-s3 rather than this scaffold's usual
// "plain fetch, no SDK" convention (AnthropicLlmProvider, PaystackService,
// SumsubService, ...) — the one real exception, because what makes those
// integrations simple enough to hand-roll is that they're plain bearer-
// token REST calls. S3's protocol is SigV4-signed requests: canonical
// request construction plus an HMAC-SHA256 signing chain. Reimplementing
// that correctly (and securely) by hand is real cryptographic protocol
// work a well-audited SDK already does right, not a shortcut worth
// avoiding a dependency for.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly bucket: string;
  // The bucket's own public base URL (an R2 "public bucket" domain, or a
  // custom domain mapped to it) — what the returned URL is actually built
  // from. Distinct from the R2 API endpoint used to PUT the object.
  private readonly publicBaseUrl: string;
  private readonly client: S3Client | null;

  constructor(private readonly config: ConfigService) {
    this.accountId = this.config.get<string>('R2_ACCOUNT_ID', '');
    this.accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID', '');
    this.secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY', '');
    this.bucket = this.config.get<string>('R2_BUCKET', '');
    this.publicBaseUrl = this.config.get<string>('R2_PUBLIC_BASE_URL', '');
    this.client = this.isConfigured
      ? new S3Client({
          region: 'auto',
          endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
        })
      : null;
  }

  get isConfigured(): boolean {
    return !!(this.accountId && this.accessKeyId && this.secretAccessKey && this.bucket && this.publicBaseUrl);
  }

  // Extension comes from the original filename when there is one (a real
  // upload always has one) — a lookup table can't cover every content
  // type a user might upload (PDFs, Office docs, ...) the way it could
  // for the fixed 3-format image output the visualizer produces. Falls
  // back to the old image-only lookup, then to no extension at all,
  // rather than guessing wrong.
  private extensionFor(contentType: string, originalFilename?: string): string {
    if (originalFilename) {
      const match = /\.([a-zA-Z0-9]+)$/.exec(originalFilename);
      if (match) return match[1].toLowerCase();
    }
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'image/jpeg') return 'jpg';
    if (contentType === 'image/png') return 'png';
    if (contentType === 'application/pdf') return 'pdf';
    return '';
  }

  // The general-purpose form — any caller with a Buffer in hand, uploaded
  // file or otherwise. uploadImage below is the AI-visualization path's
  // own thin wrapper around this, kept so that call site didn't need to
  // change.
  async upload(buffer: Buffer, contentType: string, keyPrefix: string, originalFilename?: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Object storage is not configured on this server — set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL to enable it',
      );
    }
    const extension = this.extensionFor(contentType, originalFilename);
    const key = `${keyPrefix}/${randomUUID()}${extension ? `.${extension}` : ''}`;
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
      );
    } catch (err) {
      this.logger.error(`R2 upload failed for key ${key}: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException("Couldn't save the uploaded file to storage");
    }
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  uploadImage(buffer: Buffer, contentType: string, keyPrefix: string): Promise<string> {
    return this.upload(buffer, contentType, keyPrefix);
  }
}
