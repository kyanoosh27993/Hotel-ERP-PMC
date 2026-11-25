/**
 * parties.controller.ts — نیاز یکتایی کارفرما: API ثبت مرکزی اشخاص/شرکت‌ها.
 * GET  /api/v1/parties/search?q=…        → جستجوی زندهٔ مشابه‌ها (تایپ هر کاراکتر)
 * GET  /api/v1/parties?kind=…            → فهرست رکوردهای ثبت‌شده
 * POST /api/v1/parties                   → ثبت جدید (ثبت دوباره → 409 با رکورد موجود)
 * POST /api/v1/parties/ensure            → یافتن-یا-ایجاد بی‌صدا
 * GET  /api/v1/parties/:id | PATCH :id   → مشاهده/اصلاح رکورد قبلی
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { PartyDto, PartySearchQueryDto } from './parties.dto';
import { PartiesService } from './parties.service';

@ApiTags('parties')
@ApiBearerAuth()
@Controller('parties')
export class PartiesController {
  constructor(private parties: PartiesService) {}

  @Get('search')
  @RequirePermissions(PERMISSIONS.PARTY_VIEW)
  async search(@Query() q: PartySearchQueryDto) {
    return { data: await this.parties.search(q.q, q.kind, q.limit ? Number(q.limit) : 12) };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PARTY_VIEW)
  async list(@Query('kind') kind?: string, @Query('limit') limit?: string) {
    return { data: await this.parties.list(kind, limit ? Number(limit) : 100) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PARTY_EDIT)
  async create(@Body() dto: PartyDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.parties.create(dto, req.user?.id) };
  }

  @Post('ensure')
  @RequirePermissions(PERMISSIONS.PARTY_EDIT)
  async ensure(@Body() dto: PartyDto, @Req() req: AuthenticatedRequest) {
    const r = await this.parties.ensure(dto, req.user?.id);
    return { data: { party: r.party, created: r.created } };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PARTY_VIEW)
  async findOne(@Param('id') id: string) {
    return { data: await this.parties.findOne(id) };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTY_EDIT)
  async update(@Param('id') id: string, @Body() dto: PartyDto) {
    return { data: await this.parties.update(id, dto) };
  }
}
