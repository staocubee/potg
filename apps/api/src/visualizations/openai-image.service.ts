import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The image-generation half of the visualizer — same "plain fetch, no
// SDK, isConfigured gate" shape SumsubService/PaystackService already
// use. OpenAI's Images "edit" endpoint takes an existing photo plus a
// text prompt and returns a genuinely edited version (not a from-scratch
// generation) — the actual fit for "renovate this room", not a generic
// text-to-image call.
@Injectable()
export class OpenAiImageService {
  private readonly logger = new Logger(OpenAiImageService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OPENAI_API_KEY', '');
    this.model = this.config.get<string>('OPENAI_IMAGE_MODEL', 'gpt-image-1');
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async generateEdit(params: { imageUrl: string; prompt: string }): Promise<{ buffer: Buffer; contentType: string }> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Image generation is not configured on this server — set OPENAI_API_KEY to enable it',
      );
    }

    const sourceRes = await fetch(params.imageUrl);
    if (!sourceRes.ok) {
      throw new BadRequestException(`Couldn't fetch the before image from ${params.imageUrl}`);
    }
    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
    const sourceContentType = sourceRes.headers.get('content-type') ?? 'image/png';

    const form = new FormData();
    form.append('model', this.model);
    form.append('image', new Blob([sourceBuffer], { type: sourceContentType }), 'before.png');
    form.append('prompt', params.prompt);

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    const b64 = data.data?.[0]?.b64_json;
    if (!res.ok || !b64) {
      const message = data.error?.message ?? `request failed (${res.status})`;
      this.logger.error(`OpenAI image edit failed: ${message}`);
      throw new BadRequestException(`Couldn't generate that visualization: ${message}`);
    }
    return { buffer: Buffer.from(b64, 'base64'), contentType: 'image/png' };
  }
}
