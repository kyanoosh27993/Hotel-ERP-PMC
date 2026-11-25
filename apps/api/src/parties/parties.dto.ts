/**
 * parties.dto.ts — نیاز یکتایی کارفرما: DTO ثبت مرکزی اشخاص/شرکت‌ها.
 * فیلدهای هوشمند: نام، نام خانوادگی، کد ملی، شناسه ملی، کد اقتصادی، موبایل، کد پستی.
 * نرمال‌سازی ارقام فارسی/عربی و جداکننده‌ها در سرویس انجام می‌شود؛
 * الگوی نهایی (۱۰/۱۱/۱۲ رقم) هم در سرویس با پیام فارسی کنترل می‌شود.
 */
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class PartyDto {
  @IsOptional()
  @IsIn(['GUEST', 'SUPPLIER', 'COUNTERPARTY', 'OTHER'])
  kind?: 'GUEST' | 'SUPPLIER' | 'COUNTERPARTY' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string;

  // کد ملی — پس از نرمال‌سازی باید ۱۰ رقم باشد
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  idDocNo?: string;

  // شناسهٔ ملی شرکت — پس از نرمال‌سازی باید ۱۱ رقم باشد
  @IsOptional()
  @IsString()
  @MaxLength(40)
  natIdentifier?: string;

  // کد اقتصادی — پس از نرمال‌سازی باید ۱۲ رقم باشد
  @IsOptional()
  @IsString()
  @MaxLength(40)
  economicCode?: string;

  // موبایل — پس از نرمال‌سازی ۱۰ یا ۱۱ رقم
  @IsOptional()
  @IsString()
  @MaxLength(40)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // کد پستی — پس از نرمال‌سازی باید ۱۰ رقم باشد
  @IsOptional()
  @IsString()
  @MaxLength(40)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsIn(['IRANIAN', 'FOREIGNER'])
  nationality?: 'IRANIAN' | 'FOREIGNER';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PartySearchQueryDto {
  @IsString()
  @MaxLength(64)
  q!: string;

  @IsOptional()
  @IsIn(['GUEST', 'SUPPLIER', 'COUNTERPARTY', 'OTHER'])
  kind?: 'GUEST' | 'SUPPLIER' | 'COUNTERPARTY' | 'OTHER';

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,2}$/)
  limit?: string;
}
