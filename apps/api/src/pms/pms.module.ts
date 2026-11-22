import { Module } from '@nestjs/common';
import { PmsController } from './pms.controller';
import { PmsService } from './pms.service';

/**
 * PmsModule — فاز ۴: نقشه اتاق، رزرواسیون توسعه‌یافته، لیست انتظار،
 * پذیرش (ورود/خروج اقامت چنداتاقه)، خانه‌داری پایه، حسابرسی شبانه.
 */
@Module({
  controllers: [PmsController],
  providers: [PmsService],
})
export class PmsModule {}
