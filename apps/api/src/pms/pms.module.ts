import { Module } from '@nestjs/common';
import { PmsController } from './pms.controller';
import { PmsService } from './pms.service';
import { RoomKindsService } from './roomkinds.service';
import { PlansService } from './plans.service';

/**
 * PmsModule — فاز ۴: نقشه اتاق، رزرواسیون توسعه‌یافته، لیست انتظار،
 * پذیرش (ورود/خروج اقامت چنداتاقه)، خانه‌داری پایه، حسابرسی شبانه.
 * نسخهٔ ۳٫۴: انواع اتاق/مشخصه‌ها + پلان تور/شرکت و تفکیک فولیو.
 */
@Module({
  controllers: [PmsController],
  providers: [PmsService, RoomKindsService, PlansService],
})
export class PmsModule {}
