import { Module } from '@nestjs/common';
import { JournalService } from './journal.service';
import { LedgerService } from './ledger.service';
import { EventJournalConsumer } from './event-journal-consumer';
import { AccountingController } from './accounting.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [JournalService, LedgerService, EventJournalConsumer, PermissionsGuard],
  controllers: [AccountingController],
  exports: [JournalService],
})
export class AccountingModule {}
