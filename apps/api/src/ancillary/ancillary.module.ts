/**
 * ancillary.module.ts — فاز ۱۰ (موج ۱): خدمات جانبی و شارژ فولیو
 */
import { Module } from '@nestjs/common';
import { AncillaryController } from './ancillary.controller';
import { AncillaryService } from './ancillary.service';
import { PrismaModule } from '../prisma.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [PrismaModule, OutboxModule],
  controllers: [AncillaryController],
  providers: [AncillaryService],
  exports: [AncillaryService],
})
export class AncillaryModule {}
