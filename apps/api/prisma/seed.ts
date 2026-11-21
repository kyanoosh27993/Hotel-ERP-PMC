/**
 * seed.ts — داده اولیه فاز ۱: نقش‌ها/مجوزها (ماتریس قرارداد)، کاربران نمونه،
 * درخت حساب، دوره‌های مالی، انواع اتاق و اوتلت، قواعد نگاشت رویداد→سند.
 * اجرا: npm run db:seed -w apps/api
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PERMISSIONS, PERMISSION_CATALOG, ROLE_MATRIX } from '../src/iam/permissions';

const prisma = new PrismaClient();

async function main() {
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
    const role = await prisma.role.upsert({
      where: { name },
      update: { displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa: def.sensitiveMfa },
      create: { name, displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa: def.sensitiveMfa },
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
  const passwordHash = await hash(password);
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

  // eslint-disable-next-line no-console
  console.log('✅ seed complete: roles/permissions/users/accounts/periods/rooms/outlet/rules');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
