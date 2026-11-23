/**
 * bi.module.ts — موج ۴ / فاز ۱۱.
 */
import { Module } from '@nestjs/common';
import { BiController } from './bi.controller';
import { BiService } from './bi.service';

@Module({
  controllers: [BiController],
  providers: [BiService],
  exports: [BiService],
})
export class BiModule {}
