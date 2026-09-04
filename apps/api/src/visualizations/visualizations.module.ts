import { Module } from '@nestjs/common';
import { VisualizationsService } from './visualizations.service';
import { VisualizationsController } from './visualizations.controller';
import { OpenAiImageService } from './openai-image.service';
import { StorageService } from './storage.service';

@Module({
  providers: [VisualizationsService, OpenAiImageService, StorageService],
  controllers: [VisualizationsController],
})
export class VisualizationsModule {}
