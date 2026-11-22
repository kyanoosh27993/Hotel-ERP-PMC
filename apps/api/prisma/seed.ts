/**
 * seed.ts — ورودی CLI `prisma db seed`: منطق اصلی در src/seed/seed.ts است
 * تا نسخه دسکتاپ هم همان منطق را بدون تکرار اجرا کند.
 */
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../src/seed/seed';

const prisma = new PrismaClient();

runSeed(prisma)
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('✅ seed complete: roles/permissions/users/accounts/periods/rooms/outlet/rules/payroll');
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
