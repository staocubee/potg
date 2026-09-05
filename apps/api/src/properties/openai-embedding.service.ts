import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The embeddings half of "vector infrastructure for AI context retrieval"
// — same "plain fetch, no SDK, isConfigured gate" shape
// OpenAiImageService/SumsubService already use. text-embedding-3-small
// (1536 dimensions) is the cheapest OpenAI embedding model, chosen since
// this is a portfolio-search feature, not a precision-critical one.
@Injectable()
export class OpenAiEmbeddingService {
  private readonly logger = new Logger(OpenAiEmbeddingService.name);
  private readonly apiKey: string;
  private readonly model = 'text-embedding-3-small';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OPENAI_API_KEY', '');
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Semantic search is not configured on this server — set OPENAI_API_KEY to enable it',
      );
    }

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { embedding?: number[] }[];
      error?: { message?: string };
    };
    const embedding = data.data?.[0]?.embedding;
    if (!res.ok || !embedding) {
      const message = data.error?.message ?? `request failed (${res.status})`;
      this.logger.error(`OpenAI embedding failed: ${message}`);
      throw new BadRequestException(`Couldn't generate that embedding: ${message}`);
    }
    return embedding;
  }
}
