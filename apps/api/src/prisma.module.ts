import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** PrismaModule سراسری — در دسترس همه ماژول‌ها (تک منبع دسترسی داده) */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
