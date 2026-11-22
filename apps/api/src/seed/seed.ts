/**
 * seed.ts — داده اولیه (نقش‌ها/مجوزها/کاربران/حساب‌ها/دوره‌ها/اتاق‌ها/اوتلت/قواعد/پرسنل).
 * هم برای CLI (`prisma db seed`) و هم برای نسخه دسکتاپ (bootstrap) استفاده می‌شود.
 * هش گذرواژه: hash-wasm (WASM خالص — سازگار با @node-rs/argon2 در سمت verify).
 */
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { argon2id } from 'hash-wasm';
import { PERMISSION_CATALOG, ROLE_MATRIX } from '../iam/permissions';

export interface SeedOptions {
  /** نسخه دسکتاپ/تست: نقش‌های حساس MFA لازم نداشته باشند (ماتریس استقرار واقعی دست‌نخورده) */
  disableSensitiveMfa?: boolean;
}

export async function runSeed(prisma: PrismaClient, options?: SeedOptions): Promise<void> {
  // ── مجوزها ──
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { descriptionEn: p.en, descriptionFa: p.fa },
      create: { code: p.code, descriptionEn: p.en, descriptionFa: p.fa },
    });
  }
  const allPermissions = await prisma.permission.findMany();
  const permByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  // ── نقش‌ها + ماتریس ──
  for (const [name, def] of Object.entries(ROLE_MATRIX)) {
    const sensitiveMfa = options?.disableSensitiveMfa ? false : def.sensitiveMfa;
    const role = await prisma.role.upsert({
      where: { name },
      update: { displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa },
      create: { name, displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa },
    });
    for (const code of def.permissions) {
      const permissionId = permByCode.get(code);
      if (!permissionId) throw new Error(`Unknown permission in matrix: ${code}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
  const roleByName = new Map((await prisma.role.findMany()).map((r) => [r.name, r]));

  // ── کاربران نمونه (گذرواژه از env — در استقرار واقعی تغییر داده شود) ──
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Str0ng!';
  const passwordHash = await argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
  // برای تست‌های e2e: اگر MFA_TEST_SECRET ست شده باشد MFA فعال با این راز می‌شود
  const mfaSecret = process.env.MFA_TEST_SECRET ?? null;
  const mfaEnabled = Boolean(mfaSecret);

  const users: Array<{ username: string; fullName: string; role: string }> = [
    { username: 'admin', fullName: 'System Administrator', role: 'admin' },
    { username: 'accountant', fullName: 'Hotel Accountant', role: 'accountant' },
    { username: 'approver', fullName: 'Financial Approver', role: 'approver' },
    { username: 'frontdesk', fullName: 'Front Desk Staff', role: 'front_desk' },
  ];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { passwordHash, mfaSecret, mfaEnabled },
      create: { username: u.username, passwordHash, fullName: u.fullName, mfaSecret, mfaEnabled },
    });
    const role = roleByName.get(u.role);
    if (!role) throw new Error(`Unknown role: ${u.role}`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  // ── درخت حساب (کدینگ نمونه — نهایی با سیاست هتل در فاز ۸) ──
  const accounts: Array<{ code: string; nameEn: string; nameFa: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; isSensitive?: boolean }> = [
    { code: '1101', nameEn: 'Cash on Hand', nameFa: 'صندوق', type: 'ASSET' },
    { code: '1102', nameEn: 'Banks', nameFa: 'بانک‌ها', type: 'ASSET' },
    { code: '1201', nameEn: 'Accounts Receivable — Guests', nameFa: 'حساب‌های دریافتنی مهمانان', type: 'ASSET' },
    { code: '2101', nameEn: 'Accounts Payable — Suppliers', nameFa: 'حساب‌های پرداختنی تأمین‌کنندگان', type: 'LIABILITY' },
    { code: '2201', nameEn: 'VAT Payable', nameFa: 'مالیات بر ارزش افزوده پرداختنی', type: 'LIABILITY' },
    { code: '3101', nameEn: 'Owner Equity', nameFa: 'سرمایه مالک', type: 'EQUITY' },
    { code: '4101', nameEn: 'Room Revenue', nameFa: 'درآمد اتاق', type: 'REVENUE' },
    { code: '4102', nameEn: 'F&B Revenue', nameFa: 'درآمد رستوران', type: 'REVENUE' },
    { code: '5101', nameEn: 'Cost of Goods Sold', nameFa: 'بهای تمام‌شده فروش', type: 'EXPENSE' },
    { code: '5102', nameEn: 'Salaries Expense', nameFa: 'هزینه حقوق و دستمزد', type: 'EXPENSE' },
    { code: '9901', nameEn: 'Suspense / Unidentified', nameFa: 'حساب معلق (کاوشگر)', type: 'ASSET', isSensitive: true },
  ];
  for (const a of accounts) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { nameEn: a.nameEn, nameFa: a.nameFa, type: a.type, isSensitive: a.isSensitive ?? false },
      create: { code: a.code, nameEn: a.nameEn, nameFa: a.nameFa, type: a.type, isSensitive: a.isSensitive ?? false },
    });
  }

  // ── دوره‌های مالی (سه سال پوشش — همیشه OPEN به‌جز قفل آزمایشی ماه گذشته) ──
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periods: Array<{ start: Date; end: Date; locked: boolean }> = [];
  for (let offset = -1; offset <= 24; offset += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
    periods.push({ start, end, locked: offset === -1 });
  }
  for (const p of periods) {
    const code = `${p.start.getUTCFullYear()}-${String(p.start.getUTCMonth() + 1).padStart(2, '0')}`;
    await prisma.fiscalPeriod.upsert({
      where: { code },
      update: { status: p.locked ? 'LOCKED' : 'OPEN', lockedAt: p.locked ? new Date() : null },
      create: { code, startDate: p.start, endDate: p.end, status: p.locked ? 'LOCKED' : 'OPEN', lockedAt: p.locked ? new Date() : null },
    });
  }
  void lastMonth;

  // ── انواع اتاق و اتاق‌ها ──
  const std = await prisma.roomType.upsert({
    where: { code: 'STD' },
    update: { baseRateRials: 2_500_000n },
    create: { code: 'STD', nameEn: 'Standard Double', nameFa: 'دو تخته استاندارد', capacity: 2, baseRateRials: 2_500_000n },
  });
  await prisma.roomType.upsert({
    where: { code: 'JUN' },
    update: { baseRateRials: 4_000_000n },
    create: { code: 'JUN', nameEn: 'Junior Suite', nameFa: 'سوئیت نیم‌لوکس', capacity: 3, baseRateRials: 4_000_000n },
  });
  for (let floor = 1; floor <= 3; floor += 1) {
    for (let i = 1; i <= 5; i += 1) {
      const roomNo = `${floor}0${i}`;
      await prisma.room.upsert({
        where: { code: roomNo },
        update: {},
        create: { code: roomNo, roomTypeId: std.id, floor, status: 'AVAILABLE' },
      });
    }
  }

  // ── اوتلت POS ──
  await prisma.posOutlet.upsert({
    where: { code: 'REST-MAIN' },
    update: {},
    create: { code: 'REST-MAIN', nameEn: 'Main Restaurant', nameFa: 'رستوران اصلی' },
  });

  // ── قواعد نگاشت رویداد→سند (پارامتریک — موتور سند خودکار) ──
  await prisma.eventJournalRule.upsert({
    where: { ruleId: 'res_confirmed' },
    update: { linesJson: [
      { accountCode: '1201', side: 'debit', amountKind: 'total' },
      { accountCode: '4101', side: 'credit', amountKind: 'total' },
    ] as unknown as import('@prisma/client').Prisma.InputJsonValue },
    create: {
      ruleId: 'res_confirmed',
      eventName: 'booking.reservation.confirmed',
      descriptionFa: 'ثبت رزرو: بدهکار حساب مهمان / بستانکار درآمد اتاق',
      linesJson: [
        { accountCode: '1201', side: 'debit', amountKind: 'total' },
        { accountCode: '4101', side: 'credit', amountKind: 'total' },
      ] as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });
  await prisma.eventJournalRule.upsert({
    where: { ruleId: 'pos_served' },
    update: { linesJson: [
      { accountCode: '1101', side: 'debit', amountKind: 'total' },
      { accountCode: '4102', side: 'credit', amountKind: 'net' },
      { accountCode: '2201', side: 'credit', amountKind: 'tax' },
    ] as unknown as import('@prisma/client').Prisma.InputJsonValue },
    create: {
      ruleId: 'pos_served',
      eventName: 'pos.order.served',
      descriptionFa: 'فروش رستوران: بدهکار صندوق / بستانکار درآمد + ارزش افزوده',
      linesJson: [
        { accountCode: '1101', side: 'debit', amountKind: 'total' },
        { accountCode: '4102', side: 'credit', amountKind: 'net' },
        { accountCode: '2201', side: 'credit', amountKind: 'tax' },
      ] as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });

  // ── فاز ۲: حساب‌های حقوق (پرداختنی‌ها و هزینه بیمه کارفرما) ──
  const payrollAccounts: Array<{ code: string; nameEn: string; nameFa: string; type: 'LIABILITY' | 'EXPENSE' }> = [
    { code: '2102', nameEn: 'Salaries Payable', nameFa: 'حقوق پرداختنی', type: 'LIABILITY' },
    { code: '2202', nameEn: 'Insurance Payable', nameFa: 'بیمه پرداختنی', type: 'LIABILITY' },
    { code: '2203', nameEn: 'Payroll Tax Payable', nameFa: 'مالیات حقوق پرداختنی', type: 'LIABILITY' },
    { code: '5103', nameEn: 'Employer Insurance Expense', nameFa: 'هزینه حق بیمه سهم کارفرما', type: 'EXPENSE' },
  ];
  for (const a of payrollAccounts) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
      create: { code: a.code, nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
    });
  }

  // ── قاعده سند حقوق: بدهکار هزینه حقوق + بیمه کارفرما / بستانکار بیمه + مالیات + حقوق پرداختنی ──
  // تراز: gross + insEmployer = insTotal + tax + net
  await prisma.eventJournalRule.upsert({
    where: { ruleId: 'payroll_run_approved' },
    update: { linesJson: [
      { accountCode: '5102', side: 'debit', amountKind: 'gross' },
      { accountCode: '5103', side: 'debit', amountKind: 'insEmployer' },
      { accountCode: '2202', side: 'credit', amountKind: 'insTotal' },
      { accountCode: '2203', side: 'credit', amountKind: 'tax' },
      { accountCode: '2102', side: 'credit', amountKind: 'net' },
    ] as unknown as import('@prisma/client').Prisma.InputJsonValue },
    create: {
      ruleId: 'payroll_run_approved',
      eventName: 'payroll.run.approved',
      descriptionFa: 'تأیید دوره حقوق: هزینه حقوق/بیمه کارفرما در برابر بیمه، مالیات و حقوق پرداختنی',
      linesJson: [
        { accountCode: '5102', side: 'debit', amountKind: 'gross' },
        { accountCode: '5103', side: 'debit', amountKind: 'insEmployer' },
        { accountCode: '2202', side: 'credit', amountKind: 'insTotal' },
        { accountCode: '2203', side: 'credit', amountKind: 'tax' },
        { accountCode: '2102', side: 'credit', amountKind: 'net' },
      ] as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });

  // ── داده نمونه پرسنل (F2-T1: مهاجرت ۱۰ نفر) + حکم تأییدشده هر یک ──
  const employeeNames: Array<[string, string, boolean, number]> = [
    ['علی', 'محمدی', true, 2],
    ['سارا', 'کریمی', false, 0],
    ['رضا', 'احمدی', true, 1],
    ['مریم', 'حسینی', false, 0],
    ['حسن', 'قاسمی', true, 3],
    ['نرگس', 'رئیسی', true, 1],
    ['مهدی', 'کاظمی', false, 0],
    ['فاطمه', 'نوری', true, 2],
    ['امیر', 'شریفی', false, 0],
    ['زهرا', 'سلطانی', true, 1],
  ];
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
  /** شبا معتبر از BBAN ۲۲رقمی — همان الگوریتم mod-97 پکیج @hotel-erp/payroll (بدون وابستگی به dist) */
  const ibanFor = (bban22: string): string => {
    if (!/^\d{22}$/.test(bban22)) throw new Error('BBAN must be 22 digits');
    const num = (s: string): string => s.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    let r = 0;
    for (const d of num(`${bban22}IR00`)) r = (r * 10 + Number(d)) % 97;
    return `IR${String(98 - r).padStart(2, '0')}${bban22}`;
  };
  const baseSalaries = [220_000_000, 180_000_000, 260_000_000, 150_000_000, 320_000_000, 200_000_000, 170_000_000, 240_000_000, 160_000_000, 300_000_000];
  for (let i = 0; i < employeeNames.length; i += 1) {
    const [firstName, lastName, marital, dependents] = employeeNames[i];
    const code = String(101 + i);
    const iban = ibanFor(`01900000000000${String(i + 1).padStart(8, '0')}`);
    const emp = await prisma.employee.upsert({
      where: { code },
      update: { firstName, lastName, marital, dependents, iban, active: true },
      create: {
        code,
        firstName,
        lastName,
        marital,
        dependents,
        iban,
        hireDate: new Date('2025-03-21T00:00:00Z'),
      },
    });
    // حکم تأییدشده مؤثر از آغاز ۱۴۰۴ (پایه سنوات ماهانه ۵٬۰۰۰٬۰۰۰ ریال — §7 معاملات فصلی)
    const decisionExists = await prisma.salaryDecision.findFirst({
      where: { employeeId: emp.id, status: 'APPROVED' },
    });
    if (!decisionExists) {
      await prisma.salaryDecision.create({
        data: {
          employeeId: emp.id,
          baseSalary: BigInt(baseSalaries[i]),
          seniority: BigInt(5_000_000),
          housing: BigInt(30_000_000),
          effectiveFrom: new Date('2025-03-21T00:00:00Z'),
          status: 'APPROVED',
          note: 'Seed: حکم اولیه ۱۴۰۴ — [پارامتریک تا ابلاغ حکم واقعی]',
          approvedById: adminUser?.id ?? null,
          approvedAt: new Date(),
        },
      });
    }
  }
}
