import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxPublisher } from './outbox.publisher';
import { PrismaOutboxStore } from './prisma-outbox.store';

@Global()
@Module({
  providers: [
    OutboxService,
    PrismaOutboxStore,
    {
      provide: 'OUTBOX_STORE',
      useExisting: PrismaOutboxStore,
    },
    {
      provide: OutboxPublisher,
      useFactory: (store: PrismaOutboxStore, outbox: OutboxService) =>
        new OutboxPublisher(store, outbox),
      inject: [PrismaOutboxStore, OutboxService],
    },
  ],
  exports: [OutboxService, OutboxPublisher],
})
export class OutboxModule {}
