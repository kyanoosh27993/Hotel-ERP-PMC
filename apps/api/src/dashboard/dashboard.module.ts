import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [DashboardService, PermissionsGuard],
  controllers: [DashboardController],
  exports: [DashboardService],
})
export class DashboardModule {}
