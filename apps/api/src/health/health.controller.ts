import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma.service';
import { Public } from '../common/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** بدون احراز هویت — برای load-balancer و compose healthcheck */
  @Public()
  @Get()
  async health() {
    const db = await this.prisma.isHealthy();
    return {
      status: db ? 'ok' : 'degraded',
      db: db ? 'up' : 'down',
      version: '0.2.0',
    };
  }
}
