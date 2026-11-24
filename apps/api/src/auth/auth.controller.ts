import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { CurrentUser } from '../iam/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/public.decorator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  totp?: string;

  /** U1 — کپچای تصویری (الگوی آسا): id + متن حروف امنیتی */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  captchaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  captchaText?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(16)
  refreshToken!: string;
}

export class MfaVerifyDto {
  @IsString()
  @MaxLength(10)
  code!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly captchaSvc: CaptchaService) {}

  /** U1 — تصویر حروف امنیتی صفحهٔ ورود (معادل simple-php-captcha.php آسا) */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('captcha')
  captcha() {
    return { data: this.captchaSvc.issue() };
  }

  /** ورود — مسیر حساس: محدودسازی نرخ شدیدتر */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Req() req: { ip?: string }, @Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password, dto.totp, {
      captchaId: dto.captchaId,
      captchaText: dto.captchaText,
      ip: req.ip,
    });
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.rotateRefreshToken(dto.refreshToken);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { id: string; username: string; roles: string[] }) {
    // U2 — نوار کاربر صفحهٔ اصلی: نام کامل + عکس پرسنلی + سمت
    const profile = await this.auth.profile(user.id);
    return { data: { ...user, ...profile } };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  async mfaSetup(@CurrentUser() user: { id: string }) {
    return { data: await this.auth.setupMfa(user.id) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('mfa/verify')
  async mfaVerify(@CurrentUser() user: { id: string }, @Body() dto: MfaVerifyDto) {
    return { data: await this.auth.verifyMfa(user.id, dto.code) };
  }
}
