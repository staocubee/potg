import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { OpenAiEmbeddingService } from './openai-embedding.service';
import { GoogleGeocodingService } from './google-geocoding.service';
import { NotificationsModule } from '../notifications/notifications.module';

// NotificationsModule — Module 19 Phase 1's own real-time trigger for a
// resolved maintenance request (see PropertiesService.
// resolveMaintenanceRequest's own comment).
@Module({
  imports: [NotificationsModule],
  providers: [PropertiesService, OpenAiEmbeddingService, GoogleGeocodingService],
  controllers: [PropertiesController],
  exports: [PropertiesService],
})
export class PropertiesModule {}
