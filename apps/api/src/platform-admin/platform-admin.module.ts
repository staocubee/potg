import { Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';

@Module({
  providers: [PlatformAdminService],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
