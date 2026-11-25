# نقشهٔ زبان‌ها و فایل‌ها — Hotel ERP

هدف: هنگام دیباگ/تست یک ماژول، فقط فایل‌های **همان زبان و همان ماژول** را لمس کن.
این نقشه جلوی پرش ذهنی بین زبان‌ها (TS ↔ SQL ↔ JS ↔ Python) را می‌گیرد.

## زبان‌ها و محل قرارگیری

| زبان | کاربرد | محل | قانون هنگام تست |
|---|---|---|---|
| **TypeScript** | API (NestJS) | `apps/api/src/<module>/` | فقط وقتی باگ در همان ماژول است؛ بعد `npm run build` در `apps/api` |
| **TypeScript** | قراردادها | `packages/contracts/src/` | فقط اگر نوع payload تغییر کرد؛ بعد rebuild packages |
| **TypeScript** | وب (Next.js) | `apps/web-next/app/` | فقط برای رابط وب؛ بعد `npm run build` در `apps/web-next` |
| **TypeScript** | موبایل (Capacitor) | `apps/mobile/` | فقط فاز موبایل؛ جدای کامل از API |
| **SQL** | مهاجرت‌ها | `apps/api/prisma/migrations/<ts>/` | فقط تغییرات schema؛ بعد `prisma migrate deploy` + `prisma generate` |
| **JavaScript (ESM)** | اسکریپت‌های تست/سفر کاربر | `scripts/*.mjs` | زبان پیش‌فرض تست‌های زنده؛ هرگز منبع تولید نمی‌شوند |
| **Python** | ابزارهای جانبی (لوگو، یادداشت، PDF) | `scripts/*.py` | هرگز هنگام تست ماژول‌های API لمس نشوند |

## رجیستری ماژول‌ها (هر ماژول → مسیر منبع + زبان + اسکریپت تست اختصاصی)

| # | ماژول | مسیر منبع (TS) | جدول‌های کلیدی (SQL) | اسکریپت تست لایه ۱ |
|---|---|---|---|---|
| ۱ | احراز هویت/RBAC | `auth/` `iam/` `common/` | users, roles, refresh_tokens | `scripts/module-tests/01-auth.mjs` |
| ۲ | رزرو/اقامت/شب‌گردی | `reservations/` `pms/` | reservations, stays, stay_rooms, night_audit_runs | `02-pms.mjs` |
| ۳ | رستوران/POS/KDS | `pos/` `restaurant/` | restaurant_orders, order_items, kitchen_tickets | `03-restaurant.mjs` |
| ۴ | انبار/خرید | `procurement/` `inventory/` | stock_items, stock_movements, purchase_orders, goods_receipts | `04-inventory.mjs` |
| ۵ | حسابداری مالی | `accounting/` | journal_entries, journal_lines, accounts, fiscal_periods | `05-accounting.mjs` |
| ۶ | انطباق ایران | `compliance/` | law_rules, event_journal_mappings, vat_declarations | `06-compliance.mjs` |
| ۷ | حقوق/دستمزد | `payroll/` | personnel, pay_orders, payslips | `07-payroll.mjs` |
| ۸ | دارایی/خزانه/خدمات | `assets/` `treasury/` `ancillary/` | fixed_assets, cash_accounts, ancillary_orders | `08-treasury.mjs` |
| ۹ | داشبوردها | `dashboard/` | (فقط خواندن) | `09-dashboards.mjs` |
| ۱۷ | کاربران/گروه‌ها/ماتریس دسترسی (v3.3) | `admin/` `iam/` | users, roles, permissions, user_roles, role_permissions, audit_logs | `17-admin.mjs` |
| ۱۸ | انواع اتاق/مشخصه‌ها/اتاق‌ها (v3.4) | `pms/roomkinds.service.ts` | room_types, rooms, room_amenities, room_amenity_links | `18-roomkinds.mjs` |
| ۱۹ | پلان تور/شرکت + کدینگ درآمدی (v3.4) | `pms/plans.service.ts` | plans, plan_items, revenue_codes, folio_items, stays, reservations | `19-plans.mjs` |

## قانون طلایی هنگام تست

> **هنگام تست ماژول N، فقط این سه چیز را لمس کن:**
> ۱. `scripts/module-tests/0N-*.mjs` (زبان JS — اسکریپت تست)
> ۲. `apps/api/src/<module-N>/` (زبان TS — فقط اگر باگ پیدا شد)
> ۳. `apps/api/prisma/` (زبان SQL — فقط اگر schema نقص داشت)
>
> **هرگز** همزمان فایل Python، فایل وب، یا کد ماژول دیگر را باز نکن.
> اگر باگی به ماژول دیگر اشاره داد، آن را در لاگ باگ ثبت کن و در لایهٔ ۱ همان ماژول پیگیری کن.
