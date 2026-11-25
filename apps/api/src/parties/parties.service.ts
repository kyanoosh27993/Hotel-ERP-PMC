/**
 * parties.service.ts — نیاز یکتایی کارفرما: ثبت مرکزی اشخاص و شرکت‌ها.
 * هر شخص/شرکت (مهمان، فروشنده، طرف حساب، …) فقط یک بار در کل برنامه ثبت می‌شود.
 * - search: جستجوی زندهٔ زیررشته‌ای («در هرجای کلمه») روی ۷ فیلد هوشمند
 *   (نام، نام خانوادگی، نام شرکت، کد ملی، شناسه ملی، کد اقتصادی، موبایل، کد پستی).
 * - گارد ضدتکرار: تطبیق دقیق کد ملی / شناسه ملی / کد اقتصادی یا (موبایل + نام و نام خانوادگی)
 *   → ConflictException با رکورد موجود (کد DUPLICATE_PARTY).
 * - ensure: یافتن-یا-ایجاد بی‌صدا برای جریان‌هایی مانند معاملات فصلی و فروشندگان.
 * نرمال‌سازی: ارقام فارسی/عربی → لاتین، حذف جداکننده‌ها در فیلدهای کدی.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Party, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PartyDto } from './parties.dto';

/** ارقام فارسی/عربی → لاتین */
export function toLatinDigits(s: string): string {
  return (s ?? '').replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) & 0xf),
  );
}

/**
 * اعتبارسنجی ساختاری کد ملی (۱۰ رقم) — جلوگیری از کد ملی فیک:
 * رد ارقام یکسان + رقم کنترل: Σ (رقم × ضریب ۱۰..۲) mod 11 → باقیماندهٔ <۲ خودش، وگرنه ۱۱−باقیمانده.
 * (راستی‌آزمایی تجربی: scripts/verify-iran-ids.py — نمونهٔ معتبر 0499370899 ✓)
 */
export function mellicodeOk(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  if (new Set(code).size === 1) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(code[i]) * (10 - i);
  const r = s % 11;
  return (r < 2 ? r : 11 - r) === Number(code[9]);
}

/**
 * اعتبارسنجی ساختاری شناسهٔ ملی اشخاص حقوقی (۱۱ رقم):
 * Σ ((رقم + رقم‌دهم + ۲) × ضریب چرخشی 29,27,23,19,17) mod 11 → باقیماندهٔ ۱۰ → ۰؛
 * مقایسه با رقم کنترل (رقم یازدهم). با ۵ شناسهٔ ملی واقعی بانک‌ها راستی‌آزمایی شد
 * (ملت/ملی/حکمت/صنعت‌ومعدن/رفاه — scripts/verify-iran-ids.py).
 */
export function legalIdOk(code: string): boolean {
  if (!/^\d{11}$/.test(code)) return false;
  if (new Set(code).size === 1) return false;
  const w = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const dec = Number(code[9]);
  let s = 0;
  for (let i = 0; i < 10; i++) s += (Number(code[i]) + dec + 2) * w[i];
  let r = s % 11;
  if (r === 10) r = 0;
  return r === Number(code[10]);
}

/** فیلدهای کدی: فقط رقم — حذف فاصله، خط تیره و … */
function digitsOnly(s?: string | null): string {
  return toLatinDigits(s ?? '').replace(/\D/g, '');
}

const KIND_FA: Record<string, string> = {
  GUEST: 'مهمان',
  SUPPLIER: 'فروشنده',
  COUNTERPARTY: 'طرف حساب',
  OTHER: 'شخص/شرکت',
};

type PartyRow = Party;

/** نام نمایشی یکتا برای لیست‌ها */
export function partyDisplayName(p: Pick<PartyRow, 'companyName' | 'lastName' | 'firstName'>): string {
  if (p.companyName) return p.companyName;
  return ((p.lastName ?? '') + ' ' + (p.firstName ?? '')).trim() || '—';
}

@Injectable()
export class PartiesService {
  constructor(private prisma: PrismaService) {}

  /** نرمال‌سازی ورودی فرم — ارقام فارسی و جداکننده‌ها پاک می‌شوند */
  private normalize(dto: PartyDto): PartyDto {
    const out: PartyDto = { ...dto };
    for (const k of ['firstName', 'lastName', 'companyName', 'address', 'email', 'note', 'idDocNo', 'phone'] as const) {
      if (typeof out[k] === 'string') out[k] = (out[k] as string).trim() || undefined;
    }
    out.nationalId = digitsOnly(out.nationalId) || undefined;
    out.natIdentifier = digitsOnly(out.natIdentifier) || undefined;
    out.economicCode = digitsOnly(out.economicCode) || undefined;
    out.mobile = digitsOnly(out.mobile) || undefined;
    out.postalCode = digitsOnly(out.postalCode) || undefined;
    this.validateShapes(out);
    return out;
  }

  /**
   * اعتبارسنجی ساختاری فیلدهای کدی — هیچ کد فیک/تقلبی ذخیره نمی‌شود.
   * حقیقی: کد ملی ۱۰ رقم (الگوریتم رقم کنترل) و کد پستی ۱۰ رقم؛
   * حقوقی: شناسهٔ ملی ۱۱ رقم (الگوریتم رقم کنترل) و کد اقتصادی ۱۱ تا ۱۴ رقم.
   */
  private validateShapes(p: PartyDto): void {
    if (p.nationalId && !mellicodeOk(p.nationalId)) {
      throw new BadRequestException('کد ملی نامعتبر است — ساختار و رقم کنترل کد ملی رعایت نشده است');
    }
    if (p.natIdentifier && !legalIdOk(p.natIdentifier)) {
      throw new BadRequestException('شناسهٔ ملی نامعتبر است — ساختار و رقم کنترل شناسهٔ ملی (۱۱ رقم) رعایت نشده است');
    }
    if (p.economicCode && !(p.economicCode.length >= 11 && p.economicCode.length <= 14)) {
      throw new BadRequestException('کد اقتصادی باید ۱۱ تا ۱۴ رقم باشد');
    }
    if (p.postalCode && (p.postalCode.length !== 10 || new Set(p.postalCode).size === 1)) {
      throw new BadRequestException('کد پستی باید ۱۰ رقم معتبر باشد');
    }
    if (p.mobile && !(p.mobile.length === 11 || p.mobile.length === 10)) {
      throw new BadRequestException('شماره موبایل معتبر نیست');
    }
  }

  /** جستجوی زنده: زیررشته در هرجای هرکدام از فیلدهای هوشمند */
  async search(q: string, kind?: string, limit = 12): Promise<Array<PartyRow & { displayName: string; kindFa: string }>> {
    const term = toLatinDigits(q).trim();
    if (!term) return [];
    const fields = ['firstName', 'lastName', 'companyName', 'nationalId', 'natIdentifier', 'economicCode', 'mobile', 'postalCode'] as const;
    const where: Prisma.PartyWhereInput = {
      active: true,
      ...(kind ? { kind: kind as Prisma.PartyWhereInput['kind'] } : {}),
      OR: fields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })),
    };
    const rows = await this.prisma.party.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(Math.max(Number(limit) || 12, 1), 30),
    });
    return rows.map((p) => ({ ...p, displayName: partyDisplayName(p), kindFa: KIND_FA[p.kind] ?? 'شخص/شرکت' }));
  }

  /**
   * گارد ضدتکرار — رکورد قبلیِ همان شخص/شرکت را برمی‌گرداند (یا null).
   * تطبیق دقیق روی کد ملی / شناسه ملی / کد اقتصادی؛
   * اگر هیچ شناسه‌ای نداشت: (موبایل + نام + نام خانوادگی) یا نام دقیق شرکت.
   */
  async findDuplicate(p: PartyDto, excludeId?: string): Promise<PartyRow | null> {
    const or: Prisma.PartyWhereInput[] = [];
    if (p.nationalId) or.push({ nationalId: p.nationalId });
    if (p.natIdentifier) or.push({ natIdentifier: p.natIdentifier });
    if (p.economicCode) or.push({ economicCode: p.economicCode });
    if (p.mobile && p.firstName && p.lastName) {
      or.push({ mobile: p.mobile, firstName: p.firstName, lastName: p.lastName });
    }
    if (p.companyName && !p.nationalId && !p.natIdentifier && !p.economicCode && !p.mobile) {
      or.push({ companyName: p.companyName });
    }
    if (!or.length) return null;
    return this.prisma.party.findFirst({
      where: { active: true, ...(excludeId ? { id: { not: excludeId } } : {}), OR: or },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * الزام فیلدها بر اساس نوع شخص (درخواست کارفرما):
   * فروشنده (شخص حقوقی) → شناسهٔ ملی ۱۱ رقم + کد اقتصادی ۱۱–۱۴ رقم الزامی.
   * مهمان: در ثبت رزرو الزامی نیست — الزام در گذار رزرو→اقامت (گیت چک‌این در pms.service) اعمال می‌شود.
   */
  private validateRequiredByKind(p: PartyDto): void {
    if (p.kind === 'SUPPLIER' && (!p.natIdentifier || !p.economicCode)) {
      throw new BadRequestException('برای فروشنده (شخص حقوقی)، ورود شناسهٔ ملی (۱۱ رقم) و کد اقتصادی (۱۱ تا ۱۴ رقم) الزامی است');
    }
  }

  async create(dto: PartyDto, userId?: string): Promise<PartyRow & { displayName: string; kindFa: string }> {
    const data = this.normalize(dto);
    this.validateRequiredByKind(data);
    const dup = await this.findDuplicate(data);
    if (dup) {
      throw new ConflictException({
        code: 'DUPLICATE_PARTY',
        message: `این ${KIND_FA[dup.kind] ?? 'شخص/شرکت'} قبلاً در برنامه ثبت شده است — رکورد قبلی بارگذاری شد؛ فقط اصلاح همان رکورد مجاز است.`,
        details: { existing: this.decorate(dup) },
      });
    }
    return this.decorate(await this.prisma.party.create({ data: { ...data, createdById: userId ?? null } }));
  }

  /** یافتن-یا-ایجاد بی‌صدا (معاملات فصلی، فروشندگان) — ثبت دوباره رخ نمی‌دهد */
  async ensure(dto: PartyDto, userId?: string): Promise<{ party: PartyRow & { displayName: string; kindFa: string }; created: boolean }> {
    const data = this.normalize(dto);
    this.validateRequiredByKind(data);
    const dup = await this.findDuplicate(data);
    if (dup) return { party: this.decorate(dup), created: false };
    const party = await this.prisma.party.create({ data: { ...data, createdById: userId ?? null } });
    return { party: this.decorate(party), created: true };
  }

  async update(id: string, dto: PartyDto): Promise<PartyRow & { displayName: string; kindFa: string }> {
    const data = this.normalize(dto);
    const current = await this.prisma.party.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('رکورد یافت نشد');
    const dup = await this.findDuplicate(data, id);
    if (dup) {
      throw new ConflictException({
        code: 'DUPLICATE_PARTY',
        message: 'این اطلاعات با رکورد دیگری در برنامه یکسان است — ادغام رکوردها مجاز نیست.',
        details: { existing: this.decorate(dup) },
      });
    }
    return this.decorate(await this.prisma.party.update({ where: { id }, data }));
  }

  async findOne(id: string): Promise<PartyRow & { displayName: string; kindFa: string }> {
    const p = await this.prisma.party.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('رکورد یافت نشد');
    return this.decorate(p);
  }

  async list(kind?: string, limit = 100): Promise<Array<PartyRow & { displayName: string; kindFa: string }>> {
    const rows = await this.prisma.party.findMany({
      where: { active: true, ...(kind ? { kind: kind as Prisma.PartyWhereInput['kind'] } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });
    return rows.map((p) => this.decorate(p));
  }

  private decorate(p: PartyRow): PartyRow & { displayName: string; kindFa: string } {
    return { ...p, displayName: partyDisplayName(p), kindFa: KIND_FA[p.kind] ?? 'شخص/شرکت' };
  }
}
