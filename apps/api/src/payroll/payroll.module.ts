import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [PayrollService, PermissionsGuard],
  controllers: [PayrollController],
  exports: [PayrollService],
})
export class PayrollModule {}
