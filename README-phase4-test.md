# فاز ۴ تحویل شد — راهنمای تست نقشه اتاق، رزرواسیون گروهی و پذیرش (M4)

> **F4-T1 + F4-T2 + F4-T3** طبق WORKPLAN. چک‌ها سبز: **Unit ۵۸ ✓ | E2E با PostgreSQL واقعی ۳۳ سناریو ✓ | CI سبز ✓**
> الگوی «بدون Overbooking» از فاز ۱ حفظ شد و به ظرفیت واقعی اتاق‌ها ارتقا یافت.

## ۱. اجرا

```bash
git pull && cp .env.example .env && docker compose up -d --build
# مهاجرت جدید: phase4_rooms_waitlist (units/source/نرخ/چک‌این + جدول waitlist_entries)
```

## ۲. چیست و چگونه تست شود (به‌ترتیب)

| # | سناریو | مورد انتظار |
|---|---|---|
| ۱ | `GET /api/v1/rooms` (مجوز room.view) | نقشه کامل اتاق‌ها با وضعیت/طبقه/نوع — فیلترهای `status` و `floor` و `roomTypeId` |
| ۲ | `PATCH /rooms/:id/status {status:'OUT_OF_SERVICE', note:'تعمیرات'}` (مجوز room.manage) | ثبت لحظه‌ای + رکورد حسابرسی ROOM_STATUS_CHANGED؛ **بدون note → ۴۰۰** |
| ۳ | همان لحظه `GET /dashboards/ceo` و `/dashboards/housekeeping` | ظرفیت نوع اتاق یکی کم شده (اتاق خارج از سرویس از ظرفیت خارج است) |
| ۴ | رزرو گروهی: `POST /reservations` با `units:10, source:'WALK_IN', ratePerNightRials:'2000000'` | ثبت ✓؛ total = ۳ شب × ۱۰ واحد × ۲٬۰۰۰٬۰۰۰ = ۶۰٬۰۰۰٬۰۰۰ ریال |
| ۵ | رزرو هم‌پوشان ۱۰ واحد دیگر | **۴۰۹** — ۱۰+۱۰ > ۱۵ اتاق فعال → بدون Overbooking (تست concurrent هم با دو ۸واحدی سبز است) |
| ۶ | چک‌این: `POST /reservations/:id/check-in` | تخصیص خودکار اتاق آزاد + وضعیت اتاق → OCCUPIED + حسابرسی CHECKED_IN؛ حسابدار **۴۰۳** |
| ۷ | داشبورد خانه‌داری بلافاصله | اتاق OCCUPIED در roomsByStatus دیده می‌شود |
| ۸ | چک‌اوت: `POST /reservations/:id/check-out` | رزرو → CHECKED_OUT؛ اتاق → **DIRTY** (نظافت)؛ چک‌اوت دوباره → ۴۰۹ |
| ۹ | لیست انتظار: `POST /waiting-list` → `GET /waiting-list` → `POST /waiting-list/:id/convert` | WAITING → رزرو واقعی + CONVERTED؛ اگر ظرفیت پر باشد convert → ۴۰۹ و همچنان WAITING |
| ۱۰ | `PATCH /waiting-list/:id/cancel` | CANCELLED |

## ۳. رابط کاربری (شل استاتیک)

`apps/web/index.html` → ماژول جدید **«نقشه اتاق (فاز ۴)»**: شبکه اتاق‌ها با رنگ وضعیت، دکمه تغییر وضعیت (خارج از سرویس با prompt دلیل)، و جدول لیست انتظار با دکمه «تبدیل به رزرو/لغو» — همان توکن پنل زنده داشبورد (localStorage).

## ۴. قواعد تازه پیاده‌شده

- ظرفیت واقعی = اتاق‌های نوع منهای **OUT_OF_SERVICE**؛ جمع `units` رزروهای هم‌پوشان در برابر آن کنترل می‌شود (قفل مشورتی حفظ شده)
- وضعیت OCCUPIED فقط از مسیر چک‌این؛ اتاق مهمان فعال را نمی‌توان دستی آزاد/خارج از سرویس کرد
- تعرفه ویژه (`ratePerNightRials`) اختیاری است؛ خالی = نرخ پایه نوع اتاق؛ کانال ثبت: PHONE/WALK_IN/ONLINE/OTA
- مجوز جدید `room.manage` فقط به پذیرش و مدیر سیستم داده شده (حسابدار ۴۰۳ — همسو با نمونه قرارداد)
- فیلد `roomId` رزرو فقط در چک‌این پر می‌شود (تخصیص لحظه ورود، نه رزرو)
