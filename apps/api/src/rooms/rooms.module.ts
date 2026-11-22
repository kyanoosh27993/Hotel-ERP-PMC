import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [RoomsService, PermissionsGuard],
  controllers: [RoomsController],
  exports: [RoomsService],
})
export class RoomsModule {}
