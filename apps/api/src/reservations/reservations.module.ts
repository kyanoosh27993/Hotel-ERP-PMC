import { Module } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationsController } from './reservations.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [ReservationService, PermissionsGuard],
  controllers: [ReservationsController],
  exports: [ReservationService],
})
export class ReservationsModule {}
