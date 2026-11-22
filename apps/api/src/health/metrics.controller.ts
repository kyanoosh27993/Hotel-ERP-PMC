/**
 * metrics.controller.ts — فرمت Prometheus برای Grafana (F1-T7).
 * مسیر عمومی در شبکه داخلی؛ در استقرار واقعی پشت reverse-proxy محدود شود.
 */
import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma.service';

@ApiTags('health')
@Controller('metrics')
export class MetricsController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async prometheus(@Res() res: Response): Promise<void> {
    const dbOk = await this.prisma.isHealthy();
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const outboxPending = dbOk
      ? await this.prisma.outboxEvent.count({ where: { publishedAt: null } })
      : -1;

    const body = [
      `# HELP hotel_erp_api_up API process up`,
      `# TYPE hotel_erp_api_up gauge`,
      `hotel_erp_api_up 1`,
      `# HELP hotel_erp_api_uptime_seconds Process uptime in seconds`,
      `# TYPE hotel_erp_api_uptime_seconds gauge`,
      `hotel_erp_api_uptime_seconds ${uptimeSeconds}`,
      `# HELP hotel_erp_db_up PostgreSQL reachable`,
      `# TYPE hotel_erp_db_up gauge`,
      `hotel_erp_db_up ${dbOk ? 1 : 0}`,
      `# HELP hotel_erp_outbox_pending Events awaiting publication (Outbox)`,
      `# TYPE hotel_erp_outbox_pending gauge`,
      `hotel_erp_outbox_pending ${outboxPending}`,
    ].join('\n');

    res.type('text/plain; version=0.0.4; charset=utf-8').send(body + '\n');
  }
}
