import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { isIPv4 } from 'net';

// Security fix: generateEdit used to fetch() an arbitrary client-supplied
// URL with no restriction — a real SSRF, since an authenticated account
// with plain property:write could point beforeImageUrl at
// http://169.254.169.254/... (cloud metadata endpoints) or any internal-
// network host and use this server as a proxy to probe it, with the real
// fetch failure/success distinguishable from the response. Resolves the
// hostname and rejects anything that isn't a public IPv4/IPv6 address —
// doesn't fully close DNS-rebinding (a name could re-resolve between this
// check and the real fetch), but blocks the straightforward case, which
// is the actual threat model for a scaffold with no outbound proxy.
function isPrivateOrReservedIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIp(mapped[1]);
  return false;
}

async function assertPublicHttpUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BadRequestException('That image URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('The before image URL has to be a real http(s) link');
  }
  if (url.hostname === 'localhost') {
    throw new BadRequestException("That image URL isn't reachable — try a different link");
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BadRequestException("Couldn't resolve that image URL's host");
  }
  if (addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new BadRequestException("That image URL isn't reachable — try a different link");
  }
}

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

    await assertPublicHttpUrl(params.imageUrl);
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
