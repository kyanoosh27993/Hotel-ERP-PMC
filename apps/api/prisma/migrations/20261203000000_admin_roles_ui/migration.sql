-- نسخهٔ ۳٫۳ — مدیریت کاربران/گروه‌ها از UI (درخواست کارفرما):
-- isSystem: نقش‌های seed ماتریس (admin/accountant/...) سیستمی‌اند — حذف از UI ممنوع.
-- matrixOverridden: اگر مدیر ماتریس یک نقش را از UI تغییر دهد، seed دیگر آن را بازنویسی نمی‌کند.
ALTER TABLE "roles" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "roles" ADD COLUMN "matrixOverridden" BOOLEAN NOT NULL DEFAULT false;
