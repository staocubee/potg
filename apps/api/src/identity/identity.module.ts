import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { DojahService } from './dojah.service';
import { IdentityController } from './identity.controller';

@Module({
  providers: [IdentityService, DojahService],
  controllers: [IdentityController],
})
export class IdentityModule {}
