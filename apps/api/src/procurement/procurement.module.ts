/**
 * procurement.module.ts — فاز ۷ (موج ۲): خرید و تدارکات
 */
import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { PrismaModule } from '../prisma.module';
import { OutboxModule } from '../outbox/outbox.module';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [PrismaModule, OutboxModule, StoresModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
