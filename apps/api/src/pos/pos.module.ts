import { Module } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { PermissionsGuard } from '../iam/permissions.guard';

@Module({
  providers: [PosService, PermissionsGuard],
  controllers: [PosController],
})
export class PosModule {}
