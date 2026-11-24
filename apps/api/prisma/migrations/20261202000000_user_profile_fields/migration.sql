-- U0/U1 — فیلدهای نوار کاربر (عکس پرسنلی + سمت) و «آخرین ورود» برای صفحهٔ ورود آسا
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "position" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginIp" TEXT;
