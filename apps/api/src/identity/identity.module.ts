import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { SumsubService } from './sumsub.service';
import { IdentityController } from './identity.controller';

@Module({
  providers: [IdentityService, SumsubService],
  controllers: [IdentityController],
})
export class IdentityModule {}
