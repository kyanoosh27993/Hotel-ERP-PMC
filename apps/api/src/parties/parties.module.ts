/**
 * parties.module.ts — نیاز یکتایی کارفرما: ثبت مرکزی اشخاص/شرکت‌ها.
 */
import { Module } from '@nestjs/common';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';

@Module({
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
