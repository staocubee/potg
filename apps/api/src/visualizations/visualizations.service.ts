import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiImageService } from './openai-image.service';
import { StorageService } from './storage.service';
import { CreateVisualizationDto } from './dto/create-visualization.dto';

@Injectable()
export class VisualizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProvider: OpenAiImageService,
    private readonly storage: StorageService,
  ) {}

  // Synchronous — no job queue exists in this scaffold, and OpenAI's
  // edit endpoint is itself a single request/response (tens of seconds,
  // not minutes), so there's nothing here that genuinely needs one.
  // Persists a `pending` row first so the attempt is on record even if
  // generation fails, then updates it to `completed`/`failed` — same
  // "record what actually happened, then re-throw" shape
  // IdentityService.verifyNin already uses for a third-party call that
  // might fail or might not be configured at all.
  async create(propertyId: string, userId: string, dto: CreateVisualizationDto) {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, propertyId } });
      if (!project) throw new BadRequestException('That project does not belong to this property');
    }

    const record = await this.prisma.renovationVisualization.create({
      data: {
        propertyId,
        projectId: dto.projectId,
        requestedByUserId: userId,
        prompt: dto.prompt,
        beforeImageUrl: dto.beforeImageUrl,
      },
    });

    try {
      const { buffer, contentType } = await this.imageProvider.generateEdit({
        imageUrl: dto.beforeImageUrl,
        prompt: dto.prompt,
      });
      const afterImageUrl = await this.storage.uploadImage(buffer, contentType, `visualizations/${propertyId}`);
      return await this.prisma.renovationVisualization.update({
        where: { id: record.id },
        data: { afterImageUrl, status: 'completed', completedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Visualization generation failed';
      await this.prisma.renovationVisualization.update({
        where: { id: record.id },
        data: { status: 'failed', errorMessage: message },
      });
      throw err;
    }
  }

  findForProperty(propertyId: string) {
    return this.prisma.renovationVisualization.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
