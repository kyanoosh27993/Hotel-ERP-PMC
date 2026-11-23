import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma.service';
import { Public } from '../common/public.decorator';

// نسخهٔ API از package.json خوانده می‌شود تا با هر انتشار هم‌خوان بماند
// (رفع باگ #۴ لاگ باگ: نسخهٔ هاردکد ۰.۸.۰ با انتشار v0.8.1 ناسازگار شده بود)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require('../../package.json').version;

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
      version: APP_VERSION,
    };
  }
}
