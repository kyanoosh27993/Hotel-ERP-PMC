/**
 * housekeeping.module.ts — فاز ۱۰ (موج ۱): چرخهٔ خانه‌داری، تعمیرات، لاندری، اشیای جامانده
 */
import { Module } from '@nestjs/common';
import { HousekeepingController } from './housekeeping.controller';
import { HousekeepingService } from './housekeeping.service';
import { PrismaModule } from '../prisma.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [PrismaModule, OutboxModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
