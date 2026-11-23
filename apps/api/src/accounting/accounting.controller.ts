import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { nextDocSeq } from '../common/doc-seq';
import { JournalService } from './journal.service';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../prisma.service';
import { AuthenticatedRequest } from '../common/authenticated.request';
export class CreateDraftEntryDto {
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  description!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  lines!: DraftLineDto[];
}

export class DraftLineDto {
  @IsString()
  @MaxLength(32)
  accountCode!: string;

  @IsInt()
  @Min(0)
  debit!: number;

  @IsInt()
  @Min(0)
  credit!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  costCenter?: string;
}

export class ReverseDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class AddAttachmentDto {
  @IsString() @MinLength(1) @MaxLength(200)
  fileName!: string;

  @IsOptional() @IsString() @MaxLength(120)
  mimeType?: string;

  @IsOptional() @IsInt() @Min(0)
  sizeBytes?: number;

  @IsOptional() @IsString() @MaxLength(500)
  dataRef?: string;
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('journal-entries')
export class AccountingController {
  constructor(private readonly journal: JournalService, private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  /** ثبت پیش‌نویس سند — حسابدار (طبق ماتریس: ثبت پیش‌نویس ✓ / تأیید ✗) */
  @RequirePermissions(PERMISSIONS.JOURNAL_CREATE_DRAFT)
  @Post()
  async createDraft(@Body() dto: CreateDraftEntryDto, @Req() req: AuthenticatedRequest) {
    const entryDate = new Date();
    // اولویت اعتبارسنجی: قفل دورهٔ مالی مقدم بر قواعد سند است
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
    });
    if (period && period.status === 'LOCKED') {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: `Fiscal period ${period.code} is locked` });
    }
    // قاعدهٔ مالی: حتی پیش‌نویس هم باید متوازن باشد — سند کج قابل تأیید نیست
    const totalDebit = dto.lines.reduce((a, l) => a + BigInt(l.debit), 0n);
    const totalCredit = dto.lines.reduce((a, l) => a + BigInt(l.credit), 0n);
    if (totalDebit !== totalCredit) {
      throw new BadRequestException({
        code: 'BUSINESS_RULE',
        message: 'سند متوازن نیست — جمع بدهکار و بستانکار برابر نیست',
        details: { totalDebit: totalDebit.toString(), totalCredit: totalCredit.toString() },
      });
    }
    if (dto.lines.length < 2) {
      throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'سند حداقل دو سطر نیاز دارد' });
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const year = entryDate.getUTCFullYear();
      const seq = await nextDocSeq(tx, 'journal');
      const entryNo = `JV-${year}-${String(seq).padStart(6, '0')}`;

      const entry = await tx.journalEntry.create({
        data: {
          entryNo,
          entryDate,
          postingDate: entryDate,
          periodId: period?.id ?? null,
          description: dto.description,
          status: 'DRAFT',
          sourceModule: 'accounting',
          sourceRef: `manual:${req.user.username}`,
          createdById: req.user.id,
          lines: {
            create: dto.lines.map((l, i) => ({
              lineNo: i + 1,
              accountCode: l.accountCode,
              debitRials: BigInt(l.debit),
              creditRials: BigInt(l.credit),
              costCenterCode: l.costCenter ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: { userId: req.user.id, action: 'JOURNAL_DRAFT_CREATED', entity: 'JournalEntry', entityId: entry.id },
      });

      return {
        id: entry.id,
        entryNo: entry.entryNo,
        status: entry.status,
        lines: entry.lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debitRials.toString(),
          credit: l.creditRials.toString(),
        })),
      };
    });

    return { data: created };
  }

  /** تأیید سند — فقط نقش تأییدکننده؛ خودتأییری ممنوع (قواعد مالی) */
  @RequirePermissions(PERMISSIONS.JOURNAL_APPROVE)
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const perms = await this.permissionSet(req);
    const result = await this.journal.approveEntry(id, req.user.id, perms);
    return { data: result };
  }

  /** برگشت سند قطعی با دلیل — سند اصلی حفظ می‌شود */
  @RequirePermissions(PERMISSIONS.JOURNAL_REVERSE)
  @Post(':id/reverse')
  async reverse(@Param('id') id: string, @Body() dto: ReverseDto, @Req() req: AuthenticatedRequest) {
    const result = await this.journal.reverseEntry(id, req.user.id, dto.reason);
    return { data: result };
  }

  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const take = Math.min(Number(limit ?? 50), 200);
    const entries = await this.prisma.journalEntry.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: { lines: true },
    });
    return {
      data: entries.map((e) => ({
        id: e.id,
        entryNo: e.entryNo,
        docIndex: e.docIndex ? Number(e.docIndex) : null,
        status: e.status,
        description: e.description,
        sourceModule: e.sourceModule,
        sourceRef: e.sourceRef,
        lines: e.lines.map((l) => ({
          lineNo: l.lineNo,
          accountCode: l.accountCode,
          costCenterCode: l.costCenterCode,
          debit: l.debitRials.toString(),
          credit: l.creditRials.toString(),
        })),
      })),
      meta: { count: entries.length },
    };
  }

  /** قفل/بازگشایی دوره — مجوز period.lock */
  @RequirePermissions(PERMISSIONS.PERIOD_LOCK)
  @Post('periods/:code/lock')
  async lockPeriod(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    const result = await this.journal.setPeriodLock(code, true, req.user.id);
    return { data: result };
  }

  // ── موج ۳ — فاز ۸: دفاتر رسمی، صورت‌های مالی و بستن دوره ──

  /** دفتر روزنامه — اسناد قطعی بازه به ترتیب شماره عطف */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('ledgers/journal')
  journalBook(@Query('from') from: string, @Query('to') to: string) {
    return this.ledger.journalBook(from, to);
  }

  /** دفتر کل — گردش و ماندهٔ ابتدا/انتهای هر حساب */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('ledgers/general')
  generalLedger(@Query('from') from: string, @Query('to') to: string) {
    return this.ledger.generalLedger(from, to);
  }

  /** دفتر معین — سطور یک حساب با ماندهٔ تجمعی */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('ledgers/subsidiary/:accountCode')
  subsidiaryLedger(
    @Param('accountCode') accountCode: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.ledger.subsidiaryLedger(accountCode, from, to);
  }

  /** تراز آزمایشی — باید متوازن باشد (معیار پذیرش F8-T3) */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('trial-balance')
  trialBalance(@Query('from') from: string, @Query('to') to: string) {
    return this.ledger.trialBalance(from, to);
  }

  /** صورت سود و زیان */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('statements/income')
  incomeStatement(@Query('from') from: string, @Query('to') to: string) {
    return this.ledger.incomeStatement(from, to);
  }

  /** ترازنامه در تاریخ */
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get('statements/balance-sheet')
  balanceSheet(@Query('asOf') asOf: string) {
    return this.ledger.balanceSheet(asOf);
  }

  /** بستن دوره — سند اختتام + قفل؛ فقط با مجوز period_close */
  @RequirePermissions(PERMISSIONS.PERIOD_CLOSE)
  @Post('periods/:code/close')
  async closePeriod(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    return this.ledger.closePeriod(code, req.user.id);
  }

  /** پیوست سند (متادیتا + ارجاع فایل) — فیلد پیوست‌های ۱۴گانه */
  @RequirePermissions(PERMISSIONS.JOURNAL_CREATE_DRAFT)
  @Post(':id/attachments')
  async addAttachment(
    @Param('id') id: string,
    @Body() dto: AddAttachmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const att = await this.prisma.journalAttachment.create({
      data: {
        entryId: id,
        fileName: dto.fileName,
        mimeType: dto.mimeType ?? 'application/octet-stream',
        sizeBytes: dto.sizeBytes ?? 0,
        dataRef: dto.dataRef ?? null,
        uploadedById: req.user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'JOURNAL_ATTACHMENT_ADDED', entity: 'JournalEntry', entityId: id, reason: dto.fileName },
    });
    return { data: { id: att.id, fileName: att.fileName } };
  }

  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  @Get(':id/attachments')
  async listAttachments(@Param('id') id: string) {
    const rows = await this.prisma.journalAttachment.findMany({ where: { entryId: id }, orderBy: { createdAt: 'asc' } });
    return { data: rows.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, dataRef: a.dataRef })) };
  }


  private async permissionSet(req: AuthenticatedRequest): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: req.user.id },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const set = new Set<string>();
    for (const ur of userRoles) for (const rp of ur.role.permissions) set.add(rp.permission.code);
    return set;
  }
}
