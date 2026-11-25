/**
 * admin.dto.ts — DTOهای مدیریت کاربران/گروه‌ها (نسخهٔ ۳٫۳ — درخواست کارفرما)
 */
import {
  IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches,
  MaxLength, MinLength, ArrayUnique,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Matches(/^[a-z0-9_]{3,40}$/, { message: 'نام گروه باید انگلیسی/کوچک با _ باشد (۳ تا ۴۰ نویسه)' })
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayNameFa!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayNameEn?: string;

  @IsOptional()
  @IsBoolean()
  sensitiveMfa?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{3,40}$/, { message: 'نام گروه باید انگلیسی/کوچک با _ باشد (۳ تا ۴۰ نویسه)' })
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayNameFa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayNameEn?: string;

  @IsOptional()
  @IsBoolean()
  sensitiveMfa?: boolean;
}

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  codes!: string[];
}

export class CreateUserDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,64}$/, { message: 'نام کاربری فقط حروف انگلیسی، رقم، نقطه، خط تیره/زیرین (۳ تا ۶۴ نویسه)' })
  username!: string;

  @IsString()
  @MinLength(8, { message: 'رمز عبور حداقل ۸ نویسه است' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'ایمیل معتبر نیست' })
  @MaxLength(190)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  position?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,64}$/, { message: 'نام کاربری فقط حروف انگلیسی، رقم، نقطه، خط تیره/زیرین (۳ تا ۶۴ نویسه)' })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  /** تغییر رمز توسط مدیر — پس از ثبت، همهٔ نشست‌های فعال کاربر باطل می‌شود */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'رمز عبور حداقل ۸ نویسه است' })
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsEmail({}, { message: 'ایمیل معتبر نیست' })
  @MaxLength(190)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  position?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** جایگزینی کامل گروه‌های کاربری کاربر */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
}

/** افزودن/حذف یک عضو از یک گروه */
export class MemberDto {
  @IsString()
  userId!: string;
}
