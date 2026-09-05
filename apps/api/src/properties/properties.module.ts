import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { OpenAiEmbeddingService } from './openai-embedding.service';

@Module({
  providers: [PropertiesService, OpenAiEmbeddingService],
  controllers: [PropertiesController],
  exports: [PropertiesService],
})
export class PropertiesModule {}
