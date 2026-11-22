/**
 * seed.ts — داده اولیه فاز ۱: نقش‌ها/مجوزها (ماتریس قرارداد)، کاربران نمونه،
 * درخت حساب، دوره‌های مالی، انواع اتاق و اوتلت، قواعد نگاشت رویداد→سند.
 * اجرا: npm run db:seed -w apps/api
 */
import { PrismaClient, Prisma } from '@prisma/client';
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

  // ── نقش‌ها + ماتریس (همگام‌سازی کامل: مجوزهای خارج ماتریس حذف می‌شوند) ──
  const expectedPairs = new Set<string>();
  for (const [name, def] of Object.entries(ROLE_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa: def.sensitiveMfa },
      create: { name, displayNameEn: def.en, displayNameFa: def.fa, sensitiveMfa: def.sensitiveMfa },
    });
    for (const code of def.permissions) {
      const permissionId = permByCode.get(code);
      if (!permissionId) throw new Error(`Unknown permission in matrix: ${code}`);
      expectedPairs.add(`${role.id}:${permissionId}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
  // حذف تخصیص‌هایی که دیگر در ماتریس نیستند (مثلاً نقش تغییر یافته در نسخهٔ جدید)
  const allRolePerms = await prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true } });
  for (const rp of allRolePerms) {
    if (!expectedPairs.has(`${rp.roleId}:${rp.permissionId}`)) {
      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId: rp.roleId, permissionId: rp.permissionId } },
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
    { username: 'housekeeper', fullName: 'Housekeeping Staff', role: 'housekeeper' },
    // موج ۱ — فاز ۵: صندوق‌دار
    { username: 'cashier', fullName: 'Cashier (Front Desk Cash)', role: 'cashier' },
    // موج ۲ — فاز ۶/۷: آشپزخانه (KDS) و انباردار
    { username: 'chef', fullName: 'Kitchen / KDS', role: 'chef' },
    { username: 'storekeeper', fullName: 'Storekeeper', role: 'storekeeper' },
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

  // ── موج ۱ — فاز ۵: حساب‌های کل دارایی ثابت و خدمات جانبی ──
  const wave1Accounts: Array<{ code: string; nameEn: string; nameFa: string; type: 'ASSET' | 'REVENUE' | 'EXPENSE' }> = [
    { code: '1501', nameEn: 'Fixed Assets', nameFa: 'دارایی ثابت', type: 'ASSET' },
    { code: '1502', nameEn: 'Accumulated Depreciation', nameFa: 'استهلاک انباشته', type: 'ASSET' },
    { code: '4103', nameEn: 'Ancillary Services Revenue', nameFa: 'درآمد خدمات جانبی', type: 'REVENUE' },
    { code: '5201', nameEn: 'Depreciation Expense', nameFa: 'هزینه استهلاک', type: 'EXPENSE' },
  ];
  for (const a of wave1Accounts) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
      create: { code: a.code, nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
    });
  }

  // ── موج ۱ — فاز ۵: صندوق‌ها و حساب بانکی پیش‌فرض ──
  const cashAccounts: Array<{ code: string; nameEn: string; nameFa: string; kind: 'CASH_DRAWER' | 'BANK'; gl: string }> = [
    { code: 'CH-01', nameEn: 'Front Desk Drawer', nameFa: 'صندوق پذیرش', kind: 'CASH_DRAWER', gl: '1101' },
    { code: 'CH-02', nameEn: 'Restaurant Drawer', nameFa: 'صندوق رستوران', kind: 'CASH_DRAWER', gl: '1101' },
    { code: 'BN-01', nameEn: 'Main Bank Account', nameFa: 'حساب بانکی اصلی', kind: 'BANK', gl: '1102' },
  ];
  for (const c of cashAccounts) {
    await prisma.cashAccount.upsert({
      where: { code: c.code },
      update: { nameEn: c.nameEn, nameFa: c.nameFa, glAccountCode: c.gl },
      create: { code: c.code, nameEn: c.nameEn, nameFa: c.nameFa, kind: c.kind, glAccountCode: c.gl },
    });
  }

  // ── موج ۱ — فاز ۱۰: اقلام لاندری و کاتالوگ خدمات جانبی ──
  const linen: Array<[string, string, string, string]> = [
    ['LIN-BED', 'Bed Sheet', 'ملحفه تخت', 'عدد'],
    ['LIN-TOWEL', 'Towel', 'حوله', 'عدد'],
    ['LIN-PILLOW', 'Pillowcase', 'روبالشی', 'عدد'],
    ['LIN-DOVET', 'Duvet Cover', 'روتختی', 'عدد'],
  ];
  for (const [code, en, fa, unit] of linen) {
    await prisma.linenItem.upsert({
      where: { code },
      update: { nameEn: en, nameFa: fa, unit },
      create: { code, nameEn: en, nameFa: fa, unit },
    });
  }
  const services: Array<{ code: string; en: string; fa: string; cat: import('@prisma/client').AncillaryCategory; price: number }> = [
    { code: 'SVC-PHONE', en: 'Telephone Calls', fa: 'تلفن', cat: 'PHONE', price: 250_000 },
    { code: 'SVC-PARKING', en: 'Parking', fa: 'پارکینگ', cat: 'PARKING', price: 1_500_000 },
    { code: 'SVC-TAXI', en: 'Taxi Service', fa: 'تاکسی سرویس', cat: 'TAXI', price: 3_000_000 },
    { code: 'SVC-POOL', en: 'Pool & Spa Access', fa: 'مجموعه آبی و اسپا', cat: 'POOL', price: 8_000_000 },
    { code: 'SVC-WIFI', en: 'Premium Internet', fa: 'اینترنت پرسرعت ویژه', cat: 'INTERNET', price: 2_000_000 },
    { code: 'SVC-SHOP', en: 'Mini Shop', fa: 'فروشگاه', cat: 'SHOP', price: 1_000_000 },
    { code: 'SVC-CEREMONY', en: 'Ceremonies & Banquet', fa: 'تشریفات و بنگاه', cat: 'CEREMONY', price: 50_000_000 },
  ];
  for (const s of services) {
    await prisma.ancillaryService.upsert({
      where: { code: s.code },
      update: { nameEn: s.en, nameFa: s.fa, unitPriceRials: BigInt(s.price) },
      create: {
        code: s.code,
        nameEn: s.en,
        nameFa: s.fa,
        category: s.cat,
        unitPriceRials: BigInt(s.price),
        taxRateBps: 900,
        glRevenueAccountCode: '4103',
      },
    });
  }

  // ── موج ۲ — فاز ۶/۷: حساب‌های انبار، انبارها، اقلام، تأمین‌کننده، رسپی، منو، میزها ──
  const wave2Accounts: Array<{ code: string; nameEn: string; nameFa: string; type: 'ASSET' | 'EXPENSE' }> = [
    { code: '1301', nameEn: 'Inventory', nameFa: 'موجودی مواد و کالا', type: 'ASSET' },
    { code: '2204', nameEn: 'Prepaid VAT (Purchases)', nameFa: 'مالیات بر ارزش افزوده خرید', type: 'ASSET' },
    { code: '5104', nameEn: 'Stock Variance / Waste Expense', nameFa: 'هزینه مغایرت و ضایعات انبار', type: 'EXPENSE' },
  ];
  for (const a of wave2Accounts) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
      create: { code: a.code, nameEn: a.nameEn, nameFa: a.nameFa, type: a.type },
    });
  }

  const warehouses: Array<[string, string, string]> = [
    ['WH-FOOD', 'Main Food Store', 'انبار اصلی غذایی'],
    ['WH-COLD', 'Cold Room', 'سردخانه'],
    ['WH-KITCHEN', 'Kitchen Charge Store', 'انبار شارژ آشپزخانه'],
    ['WH-BEV', 'Beverage Store', 'انبار نوشیدنی'],
    ['WH-HK', 'Housekeeping Store', 'انبار ملزومات خانه‌داری'],
    ['WH-EQUIP', 'Equipment Store', 'انبار تجهیزات'],
  ];
  for (const [code, en, fa] of warehouses) {
    await prisma.warehouse.upsert({
      where: { code },
      update: { nameEn: en, nameFa: fa },
      create: { code, nameEn: en, nameFa: fa },
    });
  }

  const stockItems: Array<{ code: string; en: string; fa: string; cat: string; up: string; uc: string; conv: number; min: number; wh: string; neg: boolean }> = [
    { code: 'STK-BEEF', en: 'Lamb Beef', fa: 'گوشت گوسفندی', cat: 'MEAT', up: 'کیلوگرم', uc: 'گرم', conv: 1000, min: 3000, wh: 'WH-COLD', neg: false },
    { code: 'STK-RICE', en: 'Rice', fa: 'برنج', cat: 'GRAIN', up: 'کیلوگرم', uc: 'گرم', conv: 1000, min: 5000, wh: 'WH-FOOD', neg: false },
    { code: 'STK-SODA', en: 'Soft Drink', fa: 'نوشابه', cat: 'BEVERAGE', up: 'عدد', uc: 'عدد', conv: 1, min: 24, wh: 'WH-BEV', neg: true },
    { code: 'STK-DETERS', en: 'Detergent', fa: 'مایع ظرفشویی', cat: 'CHEMICAL', up: 'گالن', uc: 'لیتر', conv: 4, min: 10, wh: 'WH-HK', neg: false },
  ];
  for (const s of stockItems) {
    await prisma.stockItem.upsert({
      where: { code: s.code },
      update: { nameEn: s.en, nameFa: s.fa },
      create: {
        code: s.code,
        nameEn: s.en,
        nameFa: s.fa,
        category: s.cat,
        unitPurchase: s.up,
        unitConsumption: s.uc,
        conversionFactor: new Prisma.Decimal(s.conv),
        minQty: new Prisma.Decimal(s.min),
        warehouse: { connect: { code: s.wh } },
        allowNegative: s.neg,
      },
    });
  }

  const suppliers: Array<[string, string, string]> = [
    ['SUP-001', 'Protein Supplier Co.', 'شرکت تأمین پروتئین'],
    ['SUP-002', 'Beverage Distribution', 'پخش نوشیدنی'],
  ];
  for (const [code, en, fa] of suppliers) {
    await prisma.supplier.upsert({
      where: { code },
      update: { nameEn: en, nameFa: fa },
      create: { code, nameEn: en, nameFa: fa, phone: '021-00000000', ledgerCode: '2101' },
    });
  }

  const recipes: Array<{ code: string; en: string; fa: string; v: number; lines: Array<[string, number]> }> = [
    { code: 'RCP-KABAB', en: 'Chelo Kabab', fa: 'چلوکباب', v: 1, lines: [['STK-BEEF', 300], ['STK-RICE', 250]] },
    { code: 'RCP-RICE', en: 'Steamed Rice', fa: 'برنج سفید', v: 1, lines: [['STK-RICE', 300]] },
  ];
  for (const r of recipes) {
    await prisma.recipe.upsert({
      where: { code: r.code },
      update: { nameEn: r.en, nameFa: r.fa },
      create: { code: r.code, nameEn: r.en, nameFa: r.fa, version: r.v, yieldPortions: 1 },
    });
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { code: r.code } });
    for (const [stk, qty] of r.lines) {
      const item = await prisma.stockItem.findUniqueOrThrow({ where: { code: stk } });
      await prisma.recipeLine.upsert({
        where: { recipeId_stockItemId: { recipeId: recipe.id, stockItemId: item.id } },
        update: { qtyPerPortion: new Prisma.Decimal(qty) },
        create: { recipeId: recipe.id, stockItemId: item.id, qtyPerPortion: new Prisma.Decimal(qty) },
      });
    }
  }

  const menuCats: Array<[string, string, string, number]> = [
    ['MCAT-MAIN', 'Main Dishes', 'خوراک اصلی', 1],
    ['MCAT-BEV', 'Beverages', 'نوشیدنی', 2],
  ];
  for (const [code, en, fa, sort] of menuCats) {
    await prisma.menuCategory.upsert({
      where: { code },
      update: { nameEn: en, nameFa: fa },
      create: { code, nameEn: en, nameFa: fa, sortOrder: sort },
    });
  }

  const menuItems: Array<{ code: string; cat: string; en: string; fa: string; price: number; recipe?: string }> = [
    { code: 'MI-KABAB', cat: 'MCAT-MAIN', en: 'Chelo Kabab', fa: 'چلوکباب', price: 4_500_000, recipe: 'RCP-KABAB' },
    { code: 'MI-RICE', cat: 'MCAT-MAIN', en: 'Steamed Rice', fa: 'برنج سفید', price: 1_800_000, recipe: 'RCP-RICE' },
    { code: 'MI-SODA', cat: 'MCAT-BEV', en: 'Soft Drink', fa: 'نوشابه', price: 500_000 },
  ];
  for (const m of menuItems) {
    const cat = await prisma.menuCategory.findUniqueOrThrow({ where: { code: m.cat } });
    let recipeId: string | null = null;
    if (m.recipe) {
      recipeId = (await prisma.recipe.findUniqueOrThrow({ where: { code: m.recipe } })).id;
    }
    await prisma.menuItem.upsert({
      where: { code: m.code },
      update: { nameEn: m.en, nameFa: m.fa, priceRials: BigInt(m.price), recipeId },
      create: {
        code: m.code,
        categoryId: cat.id,
        nameEn: m.en,
        nameFa: m.fa,
        priceRials: BigInt(m.price),
        taxRateBps: 900,
        recipeId,
      },
    });
  }

  const outlet = await prisma.posOutlet.findUniqueOrThrow({ where: { code: 'REST-MAIN' } });
  let area = await prisma.diningArea.findFirst({ where: { outletId: outlet.id, nameFa: 'سالن اصلی' } });
  if (!area) {
    area = await prisma.diningArea.create({ data: { outletId: outlet.id, nameEn: 'Main Hall', nameFa: 'سالن اصلی' } });
  }
  for (let i = 1; i <= 6; i += 1) {
    const code = `T${i}`;
    await prisma.diningTable.upsert({
      where: { code },
      update: { seats: 4 },
      create: { areaId: area.id, code, seats: 4 },
    });
  }

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

  // eslint-disable-next-line no-console
  console.log('✅ seed complete: roles/users/accounts/periods/rooms/rules/payroll/cash-accounts/linen/ancillary (wave-1) + warehouses/stock/recipes/menu/tables/suppliers (wave-2)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
