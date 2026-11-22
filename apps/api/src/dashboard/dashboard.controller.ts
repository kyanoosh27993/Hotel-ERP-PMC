/**
 * dashboard.controller.ts — پنل‌های KPI فاز ۳. مجوزها:
 * مدیرعامل = DASHBOARD_CEO_VIEW (حسابدار ممنوع — نمونه الزامی قرارداد)؛
 * مالی = JOURNAL_VIEW؛ رستوران = POS_ORDER_CREATE؛ خانه‌داری = ROOM_VIEW.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** F3-T1 — اشغال، درآمد روز/ماه، سود، جریان نقد */
  @RequirePermissions(PERMISSIONS.DASHBOARD_CEO_VIEW)
  @Get('ceo')
  async ceo() {
    return { data: await this.dashboards.ceo() };
  }

  /** F3-T2 — بانک‌ها، صندوق‌ها، اسناد معلق، مطالبات + هشدار اقلام معلق */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('finance')
  async finance() {
    return { data: await this.dashboards.finance() };
  }

  /** F3-T3 — پنل رستوران: فروش/میانگین/ارزش افزوده امروز */
  @RequirePermissions(PERMISSIONS.POS_ORDER_CREATE)
  @Get('restaurant')
  async restaurant() {
    return { data: await this.dashboards.restaurant() };
  }

  /** F3-T3 — پنل خانه‌داری: وضعیت اتاق‌ها و ورود/خروج امروز */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('housekeeping')
  async housekeeping() {
    return { data: await this.dashboards.housekeeping() };
  }
}
