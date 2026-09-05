import { Module } from '@nestjs/common';
import { VisualizationsService } from './visualizations.service';
import { VisualizationsController } from './visualizations.controller';
import { OpenAiImageService } from './openai-image.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [VisualizationsService, OpenAiImageService],
  controllers: [VisualizationsController],
})
export class VisualizationsModule {}
