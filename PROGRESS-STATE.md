# PROGRESS-STATE — حافظه پایدار پروژه (پس از هر فاز به‌روز شود)

> این فایل مرجع حافظه بین نشست‌هاست. اگر حافظه ماشین مجازی ریست شد، از این فایل و
> PHASES.md و AI_DEVELOPMENT_RULES.md ادامه بده.

## وضعیت جاری — نسخه v0.7.0 (موج ۲: فاز ۶ + فاز ۷) — ۱۴۰۵/۰۹/۰۳ (2026-11-22)

### کارهای انجام‌شده در نشست موج ۲
1. **بازیابی ریپو:** sandbox به snapshot فاز ۳ برگشته بود؛ شاخه محلی با `git pull --ff-only`
   به origin/main (v0.6.0) بازگردانده شد — remote مرجع حقیقت. درس: پس از بازیابی sandbox
   همیشه `git fetch && git log origin/main` چک شود.
2. **فاز ۶ — رستوران/KDS** (docs/08-back-office/PHASE6-RESTAURANT-POS.md): مهاجرت
   `20261124000000_restaurant_phase6` (dining areas/tables, menu, recipes+lines, orders+items
   قلم‌محور، kitchen tickets)؛ سفارش Idempotent با snapshot نرخ؛ KDS فقط chef؛ تخفیف فقط
   pos.discount با بازمحاسبهٔ مالیات نسبت به پایه؛ لغو قلم با دلیل؛ روم‌سرویس شارژ فولیو؛
   رویدادهای non-money: restaurant.order.served (زنجیرهٔ مصرف) + kitchen_ticket.created؛
   ارتقای handlePosOrderServed: folioId → بدهکار ۱۲۰۱.
3. **فاز ۷ — خرید/انبار/کاست کنترل** (docs/08-back-office/PHASE7-...md): مهاجرت
   `20261123180000_procurement_stores_phase7` (قبل از فاز ۶ چون recipe_lines FK دارد!)؛
   warehouses/stock_items/stock_movements (تنها منبع موجودی) + suppliers/requisitions/
   PO/GRN/counts؛ **میانگین موزون** با تبدیل واحد خرید→مصرف در GRN؛ allowNegative فقط
   مصرف رسپی؛ زنجیرهٔ مصرف: consumeForOrder (consumer در stores.service) → گردش OUT →
   رویداد پولی inventory.consumption.posted → سند COGS؛ شمارش با variance → ADJUST +
   سند ۵۱۰۴/۱۳۰۱؛ نقش‌های chef/storekeeper.
4. **seed همگام‌سازی کامل ماتریس RBAC** — rolePermissions خارج ماتریس حذف می‌شوند (باگ
   e2e: مجوز KDS باقی‌مانده در DB از seed قبلی → ۲۰۱ به‌جای ۴۰۳).
5. **تست:** unit ۴۲/۴۲ + e2e ۶۷/۶۷ (۴ suite) — سناریوهای موج ۲: GRN دو مرحله‌ای با سند،
   سرو با مصرف رسپی و COGS، شمارش با کسری، روم‌سرویس ۱۲۰۱، مجوزها.
6. **شل وب:** سه پنل جدید (restaurant.js با بورد KDS، procurement.js، stores.js) — ۱۲ ماژول.
7. **دروازهٔ M6/M7:** README-phase6-7-test.md — منتظر تست کارفرما.

### درس‌های فنی موج ۲
- ترتیب مهاجرت‌ها: FK بین‌فازی (recipe_lines→stock_items) یعنی مهاجرت انبار باید قبل از رستوران
  اجرا شود (پیشوند زمانی کمتر).
- qtyPerPortion رسپی در «واحد مصرف» است — ضریب تبدیل فقط در GRN اعمال می‌شود (دوبار ضرب =
  مصرف ۱۰۰۰ برابر!).
-PermissionsGuard از DB می‌خواند؛ تغییر ماتریس در کد بدون seed همگام اثر ندارد.
- hash-wasm وابستگی auth است — پس از بازیابی sandbox، npm install لازم است.
- embedded PG بین نشست‌ها می‌میرد؛ scripts/local-pg-e2e.mjs (پورت ۵۴۳۳، data /tmp/hotel-e2e-pg).

## وضعیت قبلی — نسخه v0.6.0 (موج ۱: فاز ۵ + فاز ۱۰) — ۱۴۰۵/۰۹/۰۱ (2026-11-22)

### کارهای انجام‌شده در نشست موج ۱ (پرسش مالک: «همه فازها با هم؟» → پلان موجی موازی)
1. **پلان موجی در PHASES.md ثبت شد** (تصمیم مالک مبنی بر اجرای همه در صورت حفظ دقت):
   رد big-bang به دلیل اسکیمای مشترک/قرارداد واحد؛ اجرای موج‌های موازی. موج ۱ همین نشست اجرا شد.
2. **فاز ۵ — خزانه‌داری کامل** (docs/08-back-office/PHASE5-TREASURY.md): مهاجرت
   `20261123000000_treasury_phase5` (cash_accounts/cashier_shifts/cash_transactions/
   bank_statement_lines/reconciliation_runs)، ماژول treasury با شیفت و مغایرت،
   Idempotency (کلید تکراری = replay)، ابطال، مغایرت‌گیری دو قاعده‌ای، شارژ فولیو،
   نقش cashier + ۵ مجوز؛ رویداد treasury.transaction.posted → سند دوطرفه با کد حساب
   کل از payload و طرف مقابل از تراکنش.
3. **فاز ۱۰ — خانه‌داری کامل + دارایی + خدمات جانبی** (docs/08-back-office/PHASE10-...md):
   مهاجرت `20261123010000_ops_phase10`؛ سه ماژول housekeeping/assets/ancillary؛
   قواعد وضعیت اتاق (پایان نظافت DIRTY→AVAILABLE)، گردش کار تعمیرات، لاندری upsert اقلام،
   جامانده با تحویل؛ استهلاک خط مستقیم با منع (asset,period) تکراری و سقف تا اسقاط؛
   خدمات جانبی با مالیات basis point (گرد به نزدیک‌ترین ریال) و شارژ فولیو + برگشت در لغو؛
   رویدادهای housekeeping.task.completed / maintenance.request.created /
   assets.depreciation.posted / ancillary.order.confirmed.
4. **مصرف‌کننده سند خودکار گسترش یافت** (accounting/event-journal-consumer.ts): ۳ هندلر جدید
   با خطوط پویا از پرونده دارایی/صندوق/کاتالوگ — الگوی EventJournalRule برای رویدادهای با
   حساب ثابت حفظ شد.
5. **شل وب:** ۴ پنل RTL جدید (treasury.js، housekeepingops.js، assets.js، ancillary.js) + منو.
6. **seed:** کاربر cashier، حساب‌های ۱۵۰۱/۱۵۰۲/۴۱۰۳/۵۲۰۱، صندوق‌های CH-01/CH-02/BN-01،
   ۴ قلم لاندری، ۷ خدمت جانبی.
7. **تست:** unit ۳۴/۳۴ (ریاضی شیفت/استهلاک/مالیات) + e2e ۵۳/۵۳ — ۱۲ سناریوی پذیرش موج ۱
   (F5-T1…T5، F10-T1…T6 + ماتریس مجوز) روی PostgreSQL واقعی (embedded ۱۶).
8. **دروازهٔ M5/M10:** README-phase5-10-test.md — منتظر تست کارفرما.

### درس‌های فنی موج ۱ (برای نشست‌های بعد)
- کنترلرهای NestJS با پریفیکس سراسری `api/v1` نباید مسیر را دوباره بیاورند (۴۰۴ می‌شود).
- پاسخ HTTP هرگز رکورد خام Prisma با BigInt نباشد — نگاشت صریح به Number (خطای JSON.stringify).
- رویدادها فقط با `EVENT_NAMES.xxx` از @hotel-erp/contracts مصرف می‌شوند (export مستقیم وجود ندارد).
- seed باید با env کامل (MFA_TEST_SECRET و ...) اجرا شود وگرنه MFA e2e می‌شکند.
- embedded PG قدیمی روی ۵۴۳۳ می‌ماند (data dir /tmp/hotel-pgdata) — قبل از اجرای e2e محلی
  چک شود که کدام instance در حال سرویس است (scripts/local-pg-e2e.mjs پورت ۵۴۳۳).

## وضعیت قبلی — نسخه v0.1 (تاریخ شمسی ثبت: ۱۴۰۵/۰۹/۰۱)

### کارهای انجام‌شده در این نشست
1. **اتصال گیت‌هاب** با کلید مالک (scopes: repo, workflow) — کاربر `kyanoosh27993` تأیید شد.
2. **آرشیو سورس داشبورد:** Hoteldashboard-5.1-Source.zip استخراج و کامل (۴۲MB شامل db/custom.db
   با ۷۳,۱۳۷ قلم اسناد) در مخزن خصوصی
   `github.com/kyanoosh27993/hoteldashboard-5.1-source` پوش شد (کامیت 4b3a948).
3. **مطالعه منابع مرجع:**
   - نقشه راه جامع ۲۴ بخشی کامل خوانده و در docs/ کپی شد.
   - `payroll-releases` (v1.4.5): موتور حقوق قانونی (ماده ۵۹، شب‌کاری ۱۷۵٪، جمعه‌کاری ۴۰/۱۸۰٪،
     عیدی، سنوات، پله مالیات)، قرارداد/احکام/تسویه با سربرگ و Footer Word، لیست‌های مالیات/بیمه/بانک،
     بک‌آپ، RBAC، AI داخلی، بیلد NSIS + wine، تست‌های 42+19+8 سناریویی، release-check.py.
   - `hoteldashboard-5.1-source`: ۳۶ پنل مالی/مدیریتی (dashboard, ceo, journal, ledger, trial, bs,
     pl, cashflow, budget, bankrec, moadian, vat, incometax, payroll, hr, inventory, assets, ...) و
     ۲۸ مدل Prisma؛ اعداد مرجع صحت‌سنجی سال ۱۴۰۴ در README-V5.1.txt.
4. **استخراج پارامترهای قانونی ۱۴۰۵ با منبع** → docs/11-iran-compliance/IRAN-LAWS.md
5. **هسته برنامه (apps/web):** شل RTL، تقویم شمسی تا سال ۱۵۰۰ (الگوریتم jalaali)، اعداد
   دو-زبانه، ۳ تم + شخصی‌سازی فونت متن/عدد، DataTable استاندارد با سطر جمع پویا، داشبورد AI
   مدیر، ماژول حقوق با لیست‌های مالیات/بیمه/بانک.
6. **نقشه graphify:** scripts/generate-map.py → graphify-out/map.md + graph.json + watch-map.sh
7. **تست:** tests/run-tests.js (۳۲/۳۲ PASS) + تست واقعی مرورگر (agent-browser):
   - داشبورد AI، تقویم (پرش به ۱۴۰۳/۱۲/۳۰ کبیسه ✓)، محاسبه دوره حقوق (۴ نفر، خالص
     ۹۹۴٬۴۲۴٬۸۶۲ ریال، بیمه دقیقاً ۳۰٪)، هر سه لیست مالیات/بیمه/بانک با سطر جمع پویا ✓
   - تم تیره/روشن، فونت جدا متن/عدد، نمای موبایل ۳۹۰px با منوی همبرگری ✓
   - **باگ پیدا و رفع شد:** `Num.toEnglish` اسلش تاریخ را نقطه می‌کرد و دوره '1405/09' رد می‌شد
   - صفر خطای کنسول در تمام ناوبری‌ها

### نسخه‌های ریلیزشده
| نسخه | تاریخ | تغییرات |
| --- | --- | --- |
| v0.1 | ۱۴۰۵/۰۹/۰۱ | هسته + حقوق + داشبورد AI + قوانین |
| v0.4.0 | ۱۴۰۵/۰۹/۰۱ | exe ویندوز (pkg) + APK اندروید — exe روی دستگاه کارفرما باز نمی‌شد |
| v0.5.0 | ۱۴۰۵/۰۹/۰۱ | فاز ۴ کامل (PMS) + نصب‌کنندهٔ فارسی NSIS با لوگو + smoke-test ویندوزی در CI |

### نشست ۲۲ نوامبر ۲۰۲۶ (چهارم) — فاز ۴ کامل (PMS) + نصب‌کنندهٔ فارسی v0.5.0
- **درخواست کارفرما:** فاز بعدی ساخته شود؛ exe قبلی «به محض باز شدن بسته می‌شد» — باید مطمئن
  شویم exe درست کار می‌کند؛ لوگوی سپر و ترازو در آیکون برنامه/نصب‌کننده؛ نصب کاملاً فارسی.
- **فاز ۴ (F4-T1…T3 + T7 + T8) — ماژول PMS:** Room.hkStatus/Note + Reservation.source/groupName/
  adults/children + WaitlistEntry + Stay/StayRoom (اقامت چنداتاقه) + NightAuditRun؛ مهاجرت
  20261122145850_pms_core؛ مجوزهای reservation.view / room.update / stay.checkin / stay.checkout /
  housekeeping.update / nightaudit.run + نقش خانه‌دار؛ گارد «یکی از» (RequireAnyPermissions)؛
  ظرفیت واقعی بدون Overbooking (هم‌پوشانی‌ها < تعداد اتاق نوع، با قفل مشورتی)؛ قواعد: اشغال فقط
  از مسیر پذیرش، اتاق نانظافت پذیرش نمی‌شود، خروج → DIRTY، نظافت CLEAN → AVAILABLE؛ فاکتور اتاق
  در خروج (نرخ × شب)؛ حسابرسی شبانه با استثنا + ۴۰۹ در اجرای دوباره؛ رویدادهای pms.stay.* با Outbox.
- **آشتی دو پیاده‌سازی فاز ۴:** جلسهٔ قبل فاز ۴ ناقص با ماژول rooms/desktop پوش شده بود؛ نسخهٔ کامل
  PMS جانشین شد (src/rooms، src/desktop، src/seed، مهاجرت قدیمی و rooms.js حذف — در تاریخ گیت محفوظ)؛
  auth.service روی hash-wasm باقی ماند (PHC سازگار با argon2 در seed)؛ تست رقابتی core به PoC برگشت.
- **e2e محلی ۴۱/۴۱ (۲۸ قبلی + ۱۳ فاز ۴) + unit ۲۵/۲۵ + lint ✓** — README-phase4-test.md (دروازهٔ M4).
- **رفع اشکال exe (طرح جدید):** نسخهٔ pkg حذف؛ به‌جای آن infrastructure/desktop/server.js
  (نود واقعی + node_modules بومی ویندوز): initdb خودکار در %APPDATA%\HotelERP، migrate deploy،
  seed (Admin@Hotel1 مطابق INSTALL)، API + شل وب روی WEB_DIR، بازکردن مرورگر، **لاگ فایل با چرخش ۲۰تایی
  + هر خطا → پیام فارسی + پنجره باز می‌ماند (هیچ‌گاه بسته‌شدن بی‌صدا)**؛ run-server.cmd با pause.
  Smoke-test کامل روی لینوکس: health + login + نقشه ۱۵ اتاق + سرو وب ✓.
- **نصب‌کنندهٔ فارسی:** NSIS 3.11 پرتابل (scripts/nsis-portable، بدون root) با زبان Farsi + MUI2؛
  لوگو در آیکون (app.ico چندسایزی) + هدر (header.bmp) + خوش‌آمد عمودی (welcome.bmp)؛ DetailPrint فارسی
  هر مرحله؛ میان‌بر دسکتاپ/استارت با آیکون لوگو؛ آن‌اینستالر فارسی؛ قانون فایروال اختیاری؛ HotelERP.exe
  لانچر (NSIS، آیکون لوگو، silent). هر دو .nsi روی لینوکس کامپایل و PE خروجی تأیید شد.
- **CI ویندوزی (release-windows.yml):** روی تگ v* روی windows-latest بسته را مونتاژ (node.exe پرتابل،
  node_modules بومی ویندوز، embedded-postgres@18.7.0-beta.19، seed کامپایل‌شده)، NSIS با choco، سپس
  **smoke-test واقعی روی ویندوز**: بوت کامل (pg+migrate+seed+API+وب) + login + نقشهٔ PMS + وب →
  فقط در صورت سبزی، Setup.exe به Release الصاق می‌شود.
- **لوگو در اندروید:** apps/mobile از تگ بازیابی + versionName 0.5.0؛ mipmap (legacy/round/foreground
  اندپتیو با پس‌زمینهٔ #0A1A30) + اسپلش پورت/لند از scripts/make_icons.py (cairosvg+PIL).

- **نتیجهٔ نهایی v0.5.0 (پس از ۱۲ تکرار CI):** Release سبز با **Hotel-ERP-Setup.exe (۶۵MB، نصب‌کنندهٔ فارسی)**
  + **Hotel-ERP-Android.apk (۳.۹MB، آیکون‌های لوگو)** — هر دو به‌صورت خودکار به Release الصاق شدند؛
  یادداشت انتشار فارسی با اسکریپت scripts/release_notes_v050.py.
  **پنج ایراد واقعی که smoke-test ویندوزی گرفت و رفع شد (درس‌های کلیدی برای هر نسخهٔ دسکتاپ):**
  1. PostgreSQL زیر حساب Administrator اجرا نمی‌شود → تشخیص با whoami /groups (S-1-16-12288) و
     اجرا از طریق **وظیفهٔ زمان‌بندی‌شدهٔ schtasks /rl LIMITED** + گارد فرزند HOTELERP_DEELEVATED
     (runas /trustlevel در runner اثر نکرد و حلقهٔ spawn می‌سازد!)؛ والد ناظر: health-poll + بازکردن مرورگر.
  2. runBin فقط روی رویداد «exit» resolve شود نه «close» — postgresِ daemon **دستگیرهٔ pipeی pg_ctl را
     به ارث می‌برد** و close هرگز نمی‌آید (علت reject(undefined) کتابخانهٔ embedded-postgres).
  3. initdb روی ویندوز با locale سیستم (WIN1252) خوشه می‌سازد و متن فارسی خطای 22P05 می‌گیرد →
     initdb مستقیم با `--encoding=UTF8 --locale=C --auth=trust` (باینری‌های @embedded-postgres بدون wrapper).
  4. کلاینت Prisma در payload باید `prisma generate` شود وگرنه seed/API خطای
     "@prisma/client did not initialize yet" می‌دهند.
  5. `cp -r apps/web payload/web` وقتی payload/web از قبل موجود است محتوا را در web/web تودرتو
     می‌کند → کپی محتوا با `apps/web/.`؛ همچنین NSIS ویندوزی در دستور File فقط بک‌اسلش می‌پذیرد.
  سنجه‌های پاس‌شده روی ویندوز واقعی: HEALTH + LOGIN (frontdesk/Admin@Hotel1) + PMS MAP (۱۵ اتاق/۳ طبقه)
  + WEB SHELL (شل با ماژول پذیرش) — و e2e محلی ۴۱/۴۱ + unit ۲۵/۲۵ + lint در هر تکرار.

- **نتیجه نهایی v0.4.0:** Release v0.4.0 با دو دارایی: Hotel-ERP-Windows.exe (۱۷۷MB، آپلود API)
  + Hotel-ERP-Android.apk (خروجی ورک‌فلو، ~اندازه debug) — وضعیت ورک‌فلو APK سبز.
  دو اشکال مسیر APK در runner: مسیر gradlew (باید از داخل android/ صدا زده شود) و
  Java 21 لازم برای sourceCompatibility capacitor-android — هر دو در ورک‌فلو اصلاح شد.
  تگ v0.4.0 روی آخرین کامیت بازساخته شد؛ صفحه Actions کاملاً سبز.

### نشست ۲۲ نوامبر ۲۰۲۶ (سوم) — نسخه‌های قابل نصب: exe ویندوز + APK اندروید (درخواست کارفرما)
- **exe ویندوز** (`Hotel-ERP-Windows.exe` ~۱۷۷MB، pkg/yao node22-win-x64 + GZip):
  bootstrap دسکتاپ در apps/api/src/desktop/bootstrap.ts — استخراج assets از snapshot،
  PostgreSQL جاسازی‌شده (initdb/pg_ctl، پورت ۵۴۳۷)، مهاجرت‌ها با pg simple-query
  (جدول _desktop_migrations)، seed در صورت خالی بودن، سرو وب + API روی :3000، بازکردن مرورگر.
  دارایی‌ها با scripts/collect-desktop-assets.js (وب + مهاجرت‌ها + موتورهای Prisma
  native+windows از binaryTargets + باینری PG دو پلتفرم؛ تیربال ویندوزی از vendor-dist چون
  npm روی لینوکس نصب نمی‌کند).
- سازگاری‌ها: argon2 → **hash-wasm** (WASM خالص) در auth.service و seed تا exe native نداشته باشد
  (PHC سازگار)؛ seed به src/seed/seed.ts با runSeed(prisma, {disableSensitiveMfa}) — نسخه دسکتاپ
  MFA خاموش، CLI seed و e2e ماتریس دست‌نخورده؛ main.ts سرو استاتیک وب قبل از listen فقط با DESKTOP_WEB_DIR.
- **تأیید واقعی**: باینری لینوکسی همزاد (همان کد) اجرا شد — initdb/مهاجرت/seed/API/وب،
  health + login + rooms 15 + PATCH وضعیت + رزرو + چک‌این خودکار اتاق + داشبورد فارسی ✓.
- **APK اندروید**: apps/mobile (Capacitor 7، webDir ../web، androidScheme http،
  usesCleartextTraffic)؛ ورک‌فلو release-apk.yml روی تگ v* — build در runner گیت‌هاب
  (Android SDK آماده)، خروجی به Release الصاق می‌شود.
- Release v0.4.0: exe (آپلود API) + apk (خروجی ورک‌فلو) + docs/INSTALL-WINDOWS-FA.md و INSTALL-ANDROID-FA.md.

### نشست ۲۲ نوامبر ۲۰۲۶ (دوم) — اصلاح CI + فاز ۴: اتاق/رزرو/پذیرش (F4-T1…T3)
- گزارش کارفرما: «ورک‌فلو گیت‌هاب خطا دارد» → ۶ اجرای قرمز بازمانده از اشکال‌زدایی دیروز حذف شد
  (API حذف run، همه ۲۰۴)؛ نام ورک‌فلو → «Phases 1–3»، concurrency cancel-in-progress، badge در README.
  اجرای بعدی سبز ✓ — صفحه Actions اکنون کاملاً سبز.
- **فاز ۴:** مهاجرت phase4_rooms_waitlist (units/source/ratePerNightRials/roomId/checkedIn/Out +
  WaitlistEntry + Room.note)؛ مجوز room.manage؛ ماژول rooms (نقشه + تغییر وضعیت لحظه‌ای،
  OUT_OF_SERVICE بدون دلیل→۴۰۰، حسابرسی ROOM_STATUS_CHANGED)؛ reservation.service بازنویسی
  (ظرفیت واقعی ≠OUT_OF_SERVICE × جمع units هم‌پوشان، گروهی تا ۲۰، چک‌این تخصیص خودکار→OCCUPIED،
  چک‌اوت→DIRTY، لیست انتظار add/list/convert/cancel)؛ داشبورد ظرفیت فعال لحظه‌ای؛ شل وب ماژول نقشه اتاق.
- باگ‌های مسیر e2e: JUN بدون اتاق در seed، آلودگی اجرای قبل (TRUNCATE + waitlist_entries، id مستقیم)،
  totalRooms = ظرفیت فعال؛ تست concurrent قدیمی با دو ۸واحدی سازگار شد.
- نتیجه: e2e ۳۳/۳۳، unit ۵۸/۵۸، lint صفر — README-phase4-test.md (۱۰ سناریو، دروازه M4).

### نشست ۲۲ نوامبر ۲۰۲۶ (تکمیلی) — فاز ۳: داشبوردهای مدیریتی (F3-T1…T3)
- کارفرما ابتدا پرسید «از سورس‌های ارسالی استفاده شده؟» — پاسخ مستند با مدرک داده شد:
  payroll-releases → فرمول mizan_include_seniority و ضریب‌ها در packages/payroll؛
  hoteldashboard-5.1 → همین فاز؛ Roadmap+low.txt → قوانین ۲۰گانه و WORKPLAN.
- **apps/api/src/dashboard:** چهار پنل با کوئری واقعی (بدون هیچ عدد هاردکد — معیار WORKPLAN):
  ceo (اشغال امروز به تفکیک نوع، درآمد روز/ماه از بستانکار ۴۱۰۱+۴۱۰۲، سود ماه = درآمد−هزینه ۵xxx،
  جریان نقد ماه = گردش ۱۱۰۱+۱۱۰۲) | finance (صندوق/بانک، مطالبات ۱۲۰۱، پرداختنی ۲۱۰۱، پیش‌نویس‌ها
  + **هشدار اقلام معلق** >۷ روز — الگوی AlertRule سورس hoteldashboard) | restaurant (فروش/خالص/
  مالیات/میانگین فاکتور امروز از pos_orders؛ KPI ضایعات صفر واقعی با یادداشت فاز انبار) |
  housekeeping (وضعیت اتاق‌ها، اشغال به تفکیک نوع، ورودی/خروجی امروز). مجوزها: ceo=admin فقط
  (حسابدار ۴۰۳ — نمونه قرارداد)، finance=journal.view، restaurant=pos.order.create،
  housekeeping=room.view. مرز روز/ماه شمسی با toJalaali/toGregorian. فقط اسناد POSTED شمرده می‌شوند.
- **فرانت‌اند:** پنل «زنده سرور» در شل استاتیک (modules/dashboard.js) — آدرس API + توکن JWT در
  localStorage؛ چهار گروه KPI + هشدارها؛ بخش تحلیل آفلاین قانون ۱۷ دست‌نخورده.
- **e2e:** ۵ سناریوی جدید با ادعای «دلتا قبل/بعد» و مقایسه با جمع کوئری مستقیم — ۲۸/۲۸ محلی ✓.
  باگ‌های مسیر: فیلد servedAt (نه createdAt) در PosOrder، totalRials (نه totalAmountRials) در
  Reservation، و دو شمارش دوباره در ادعاهای تست (رزرو قبلاً در before شمرده می‌شد — رفتار سیستم
  درست بود).
- README-phase3-test.md (۷ سناریو تست کارفرما برای دروازه M3).

### نشست ۲۲ نوامبر ۲۰۲۶ (۱۴۰۵/۰۹/۰۱) — فاز ۲: حقوق و دستمزد به هسته (F2-T1…T4)
- کارفرما «فاز بعدی» را صادر کرد (تأیید دروازه M1). فاز ۲ طبق WORKPLAN اجرا شد.
- **packages/payroll:** پورت TypeScript تأییدشده موتور v0.1 — پارامترهای ۱۴۰۵ verified
  (معافیت ۴٫۸ میلیارد، بیمه ۳۰٪=۲۳+۷، ضریب ۷٫۳۳، اضافه‌کاری ۱٫۴، شب‌کاری ۱٫۷۵)، پله‌های مالیاتی
  پارامتریک با برچسب [نیازمند بخشنامه]، نسخه پارامترها `laws-1405.1` به‌صورت snapshot در فیش/دوره،
  شبا ایران mod-97 (اعتبارسنجی+تولید)، runPeriod با لیست ردشدگان (NO_APPROVED_DECISION) — ۱۷/۱۷ تست.
- **پایگاه داده:** مهاجرت ۰۰۰۲ (employees، salary_decisions با چرخه DRAFT/APPROVED،
  payroll_runs با periodCode یکتا و تغییرناپذیری پس از تأیید، payroll_slips با snapshot کامل
  فرمول) + seed: ۱۰ کارمند نمونه با شبای معتبر و حکم تأییدشده ۱۴۰۴، حساب‌های ۵۱۰۲/۵۱۰۳/۲۱۰۲/۲۲۰۲/۲۲۰۳،
  قاعده سند payroll_run_approved (بدهکار هزینه حقوق + بیمه کارفرما / بستانکار بیمه + مالیات + حقوق
  پرداختنی — تراز: gross+insEmployer = insTotal+tax+net).
- **API:** ماژول payroll با مجوزهای جدید (personnel.view/edit، payroll.view/calculate/approve؛
  حسابدار محاسبه بدون تأیید، تأییدکننده تأیید بدون ثبت) — کارمندان/احکام/دوره‌ها/سه لیست رسمی
  (مالیات my.tax.gov.ir، بیمه، بانک با شبا)؛ بازمحاسبه دوره پیش‌نویس مجاز، دوره تأییدشده ۴۰۹.
- **سند خودکار:** رویداد payroll.run.approved در همان تراکنش تأیید → مصرف‌کننده با kinds جدید
  (gross/insEmployee/insEmployer/insTotal/tax/net) → سند ۵خطی متوازن + write-back journalEntryId.
- **تست‌ها:** unit 58 (shared 16 + payroll 17 + api 25) ✓ | e2e محلی **۲۳/۲۳** ✓ — ۷ سناریوی
  حقوق (ماتریس دسترسی، شبا، حکم، محاسبه ۱۱ فیش، بازمحاسبه idempotent، سه لیست، تأیید→سند متوازن
  + تغییرناپذیری). باگ‌های مسیر: BBAN شبا ۲۲رقمی (نه ۲۴)، شبای دستی تست، paramsVersion در پاسخ
  API، idempotency e2e با پاکسازی هدفمند کارمند ۹۰۱، تک‌دستوری بودن $executeRawUnsafe، کوتیشن
  camelCase ستون‌ها در SQL خام.
- **CI:** بیلد/تست packages/payroll به هر سه job اضافه شد؛ README-phase2-test.md (۱۱ سناریوی
  تست کارفرما برای دروازه M2).

### نشست ۲۱ نوامبر ۲۰۲۶ (۱۴۰۵/۰۹/۳۰) — برنامه ۰ تا ۱۰۰ و تکمیل فاز ۰
- **سند مشاوره جدید کارفرما** (upload/low.txt) کامل تحلیل شد: ۷ رقیب (باضافه Hotelogix و Infor HMS)،
  قابلیت‌های عرضی ۷گانه (Cash Flow، BI، Document Workflow، Digital Signature، Disaster Recovery،
  Offline Operation، API Marketplace)، فناوری‌های جدید (OpenTelemetry+Grafana، Sentry، Jest+Playwright،
  OCR+PDF Parser، نقشه)، ساختار سلسله‌مراتبی انبار، Recipe Versioning، ۱۴ فیلد سند مالی،
  متادیتای ۱۲گانه قانون، ۵ فلوچارت Mermaid روابط، مدل داده و ۱۲ قاعده، ۲۲ اپ اندرویدی/Adapter.
- **برنامه اجرایی ۰ تا ۱۰۰** تولید و در حافظه دائمی ذخیره شد:
  `docs/20-master-workplan/WORKPLAN-0-100.md` — ۱۴ فاز (۰–۱۳)، ~۷۵ تسک شناسه‌دار (F0-T1…F13-T6)
  با خروجی/وابستگی/معیار پذیرش، ۲۴ قلم جدید سند مشاوره نگاشت‌شده، ۱۲ نقطه عطف (M0…M12)،
  پروتکل ثابت هر فاز (شروع→اجرا→تست→تحویل→دروازه→ثبت حافظه).
- **گرافیک‌ها:** نقشه ذهنی ۸شاخه (فاز۰/فاز۱/فرانت/بک/یکپارچگی/AI/امنیت/قوانین — ~۶۰ گره، ۸۰ اتصال)
  + دیاگرام روابط اجزا ۵لایه/۱۶گام → `docs/20-master-workplan/assets/{mindmap,relations}.png`
  (سورس: scripts/diagrams/*.html + render.py — قابل بازتولید).
- **اسناد فاز ۰ تکمیل شد:** docs/01-project-charter/CHARTER.md (+رجیستر ریسک ۸گانه)،
  docs/02-business-requirements/BRD.md (۲۴+۵ ماژول فرانت، ۱۴ بک، ماتریس ردیابی، الگوهای ۷ رقیب)،
  docs/03-system-architecture/ARCHITECTURE.md (۵ فلوچارت Mermaid + قواعد Outbox/Adapter)،
  docs/04-database-design/DATA-MODEL.md (ER + ۱۲ قاعده + ۱۴ فیلد سند)،
  docs/05-api-specification/API-SPEC.md (نسخه‌دار/Idempotency/خطاها)، docs/06-ui-ux/UI-UX.md.
- **تحویل کارفرما:** سند docx «برنامه اجرایی ۰ تا ۱۰۰» + دو گرافیک در download/ و کپی در
  docs/20-master-workplan/. دروازه M0: تأیید کارفرما بر اسناد.
- **وضعیت دروازه:** فاز ۰ کامل — پس از تأیید کارفرما، فاز ۱ (زیرساخت NestJS+PostgreSQL+CI طبق
  تسک‌های F1-T1 تا F1-T9) شروع می‌شود.

### نشست ۲۱ نوامبر ۲۰۲۶ (تکمیلی ۲) — فاز ۱: هسته نرم‌افزاری کامل (F1-T1…T9)
- **دروازه M0** تأیید کارفرما دریافت شد؛ فاز ۱ طبق WORKPLAN-0-100 اجرا شد.
  📌 دستور جدید کارفرما: تحویل‌ها فقط در گیت‌هاب + لینک در گفتگو (خروجی در download نگذار).
- **مونوریپو npm workspaces:** `packages/shared` (money ریال-BigInt، jalali پورت تأییدشده v0.1 با
  کبیسه ۱۴۰۳، i18n EN پیش‌فرض/FA-RTL)، `packages/contracts` (نام‌گذاری رویدادها + پاکت استاندارد +
  درگاه‌های سرویس نسخه‌دار)، `apps/api` (NestJS 10)، `apps/web-next` (Next 14 شل دوزبانه standalone).
  apps/web قبلی v0.1 دست‌نخورده و ۳۲/۳۲ تست سبز.
- **Prisma/PostgreSQL (F1-T4):** schema هسته کامل (users/roles/permissions، refresh_tokens،
  audit_logs تغییرناپذیر، outbox_events/inbox_events، room_types/rooms/reservations،
  pos_outlets/orders، accounts/journal_entries+lines/fiscal_periods/event_journal_rules) —
  ریال BigInt (قاعده ۷)، UUID db-generated؛ مهاجرت `20260621000000_core` (۳۸۸ سطر) تولید+validate؛
  seed: ماتریس نقش‌ها (حسابدار بدون تأیید/تأییدکننده بدون ثبت)، ۴ کاربر نمونه، ۱۱ حساب، دوره‌های
  مالی (ماه گذشته LOCKED)، اتاق‌ها/اوتلت، قواعد نگاشت رویداد→سند پارامتریک.
- **Auth (F1-T3):** Argon2id (@node-rs)؛ access 15min + refresh چرخشی با SHA-256 hash و
  تشخیص استفاده مجدد→ابطال کل زنجیره؛ TOTP نقش‌های حساس؛ گاردهای سراسری
  JwtAuthGuard→PermissionsGuard + @Public؛ Throttler (login 10/min)؛ audit برای LOGIN/شکست/MFA.
- **Outbox (F1-T2):** enqueue در همان $transaction؛ ناشر با FOR UPDATE SKIP LOCKED + backoff
  نمایی + unref timer؛ مصرف‌کنندگان تکرارپذیر (inbox_events کلید=شناسه رویداد). PoCها:
  رزرو Race-safe (pg_advisory_xact_lock + هم‌پوشانی بازه) → هم‌زمانی دقیقاً یک 201/یک 409؛
  POS (مالیات permille صحیح) → رویداد → سند دوطرفه خودکار متوازن (1101/4102/2201) از قاعده
  پارامتریک؛ replay idempotencyKey بدون سند دوم؛ سناریوی کرش: ثبت بدون انتشار → publishOnce →
  سند دقیقاً یک‌بار.
- **مالی:** تأیید فقط با مجوز approver و خودتأییری ممنوع؛ برگشت با سند معکوس+دلیل؛ قفل دوره
  (ثبت در LOCKED → 409)؛ سند نامتوازن → رد؛ شماره سند JV-YYYY-000001.
- **Integration Hub (F1-T6):** رجیستری Adapter + Adapter شبیه‌سازی‌شده ساعت‌زنی (healthy/degraded،
  صف آفلاین بدون گم‌شدن داده) + /integrations endpoints.
- **رصد (F1-T7):** OpenTelemetry sdk (فقط با endpoint)، Sentry (فقط با DSN)، /metrics Prometheus
  (uptime/db_up/outbox_pending)؛ otel-collector + Prometheus + Grafana provisioning در compose
  پروفایل observability.
- **بکاپ/DR (F1-T8):** backup.sh (pg_dump|gzip|AES-256-CBC PBKDF2 200k + SHA256 + rotate) و
  restore.sh اتمیک + docs/16-deployment/DR-RUNBOOK.md (جدول آزمون فصلی) + round-trip در CI.
- **CI (F1-T9):** .github/workflows/ci.yml — jobهای quality (lint+build+unit)، e2e (postgres
  service + migrate deploy + seed + e2e پذیرش)، infra (compose config + بکاپ/بازیابی round-trip).
- **تست‌ها:** shared 16/16 ✓، api unit 25/25 ✓، e2e ۱۴ سناریو (فقط با DB — در CI)؛
  dev-start و چک‌لیست پایان تسک در docs/16-deployment/DEV-START.md.
- **باگ‌های پیدا/رفع‌شده در تست‌ها:** assertRial نوع نامعتبر، ترتیب صحت‌سنجی ممیز شناور،
  `throw;` نامجاز در TS، next.config.ts→mjs (Next 14)، انتظار نادرست تست مهر ۱۴۰۵ (اعتدال
  پاییز = ۲۳ سپتامبر) — الگوریتم تقویم صحیح بود.
- **CI سبز شد (run 44957575792، ۲۱ نوامبر):** هر سه job موفق — quality (lint+build+unit)،
  e2e 16/16 با PostgreSQL واقعی، infra (compose + بکاپ/بازیابی round-trip). باگ‌های مسیر CI که
  رفع شدند: prisma generate در job بیلد، DI سراسری PrismaService (PrismaModule)، شکل خطای e2e
  (فیلتر استاندارد در اپ تست)، void advisory lock (SELECT true FROM (...))، camelCase ستون‌ها در
  claimBatch، UUID موتور سیستمی (createdById=null)، هم‌ترازی pg_dump 16 (round-trip داخل کانتینر
  postgres:16-alpine). دیباگ e2e محلی با Postgres embedded (scripts/local-pg.mjs، پورت 5433).
- **دروازه M1 — تحویل به کارفرما برای تست:** راهنمای تست در فایل فاز ۱ گیت‌هاب
  (README-phase1-test.md). پس از تأیید، فاز ۲/۳ (تکمیل حقوق و داشبوردها) ادامه می‌یابد.

### کارهای باقی‌مانده فاز جاری (فاز بعدی: شروع بلافاصله)
- [x] تکمیل اسناد تحلیل/معماری docs/01 تا docs/06 (شرط ۱ روش فازبندی) — نشست تکمیلی ۱
- [x] زیرساخت هسته اصلی طبق پشته قرارداد (NestJS + PostgreSQL + Docker + OpenAPI) — نشست تکمیلی ۲
- [x] GitHub Actions workflow (CI: تست خودکار + lint + بیلد) — ci.yml
- [ ] تقویم شمسی: رویدادهای مناسبت‌های سال ۱۴۰۵+ (ثبت JSON پارامتریک) — تمدید تا ۱۵۰۰ به‌صورت
      fixed Holidays + محاسبات قمری با الگوریتم تقویم هجری قمری
- [ ] ماژول حقوق: اتصال مستقیم فرمول‌ها به docs/11-iran-compliance (پله دقیق مالیات حقوق ۱۴۰۵
      پس از استخراج بخشنامه رسمی — فعلاً پله‌ها با نرخ ۱۰–۳۰٪ پارامتریک)
- [ ] داشبورد: اتصال نمودارها به داده واقعی ماژول‌های آینده
- [ ] فاز ۴ به بعد طبق PHASES.md

### نشست ۲۱ نوامبر ۲۰۲۶ (تکمیلی) — قرارداد توسعه AI
- **AI_DEVELOPMENT_MASTER_RULES.md** (قرارداد ۱۰ بخشی مالک: هدف، پشته فناوری، معماری، مالی،
  امنیت OWASP ASVS 5.0، دوزبانه، قواعد AI، فرایند توسعه، معیارهای تکمیل، اصل اولویت) در ریشه
  پروژه ذخیره شد و به گیت‌هاب پوش شد.
- **روش صحیح فازبندی ۷ ماده‌ای مالک** به AI_DEVELOPMENT_RULES.md (بخش یک‌ونیم) و PHASES.md
  (نسخه ۱.۲) اضافه شد: اسناد ← زیرساخت/هسته ← ماژول جدا ← تست پیش از ماژول وابسته ← قراردادهای
  مشخص ← نسخه قابل اجرا پس از هر فاز ← هیچ فازی بدون تأیید تست بسته نشود.
- چک‌لیست انطباق با دو مورد جدید (انطباق با Master Rules و روش فازبندی) گسترش یافت.

### نکات فنی مهم (از نشست‌های قبل — یادآوری)
- توکن گیت‌هاب فقط از فایل محلی `upload/SN.txt` خوانده شود؛ هرگز در کد/گیت ذخیره نشود.
- مخزن `hoteldashboard-5.1-source` خصوصی است — فقط ارجاع، نه clone داخل سورس اصلی.
- اعداد مرجع صحت‌سنجی هلیتان (سال ۱۴۰۴): سود اظهارنامه‌ای 340,615,106,959 ریال؛ جمع ترازنامه
  560,135,378,890 ریال؛ فروش خالص تشخیص ۱۴۰۳: 340,802,244,311 ریال — برای تست تطبیق داشبورد.

### موج ۳ — ۲۴ نوامبر ۲۰۲۶ (فاز ۸ و ۹ — هستهٔ حسابداری مالی و موتور انطباق) — v0.8.0
- **F8-T1 (سند ۱۴فیلدی):** شماره عطف قطعی (docIndex با توالی seq_journal_docindex در زمان
  ثبت/تأیید)، پیوست‌های سند (journal_attachments + دو مسیر افزودن/فهرست)، approvedById/approvedAt
  (موج ۱) — قواعد قطعی/اصلاحی/ابطال از موج ۱ حفظ شد (سند قطعی هرگز ویرایش/حذف مستقیم نمی‌شود).
- **F8-T2 (موتور سند خودکار پارامتریک):** جدول event_journal_mappings (نگاشت رویداد←سند با
  amountField/حساب‌ها/الگوی شرح/مرکز هزینه + نسخه) + موتور tryMapped در EventJournalConsumer —
  سناریوی ساده جدید = یک سطر جدول بدون تغییر کد؛ رویدادهای چندسطری/چندجهته هندلر اختصاصی دارند.
- **F8-T3 (دفاتر و صورت‌های مالی):** دفتر روزنامه (ترتیب شماره عطف)، دفتر کل (ماندهٔ ابتدا/گردش/
  انتها، همهٔ مانده‌ها بدهکار-مثبت)، دفتر معین (ماندهٔ تجمعی)، تراز آزمایشی متوازن (معیار پذیرش)،
  صورت سود و زیان، ترازنامه با نتیجهٔ دوره، مراکز هزینه/سود (cost_centers seed)، قفل دوره (موج ۱)
  + **بستن دوره** با سند اختتام (انتقال نتیجه به ۳۹۰۱ سود انباشته) و بازبستن ۴۰۹.
- **F9-T1 (کتابخانه قوانین):** law_rules با متادیتای ۱۲گانه (ماده/تبصره/بازه اعتبار/نسخه/پارامترها/
  سناریو تست/مسئول حقوقی/منبع)، نرخ پارامتریک در تاریخ (rateAt) — تغییر نرخ ۱۴۰۶ بدون تغییر کد
  (e2e: VAT از ۱۰۰۰ به ۱۱۰۰ bp با یک POST) + نسخه‌بندی در audit_log.
- **F9-T3 (ارزش افزوده):** اظهارنامهٔ دوره‌ای /compliance/vat/declaration — مالیات فروش از ۲۲۰۱،
  اعتبار خرید از ۲۲۰۴، پایهٔ مالیاتی و تفکیک بخش‌ها بر مرکز هزینه — مستقیم از اسناد posted.
- **مهاجرت:** 20261125000000_wave3 (docIndex + backfill، پیوست‌ها، closedAt/closingEntryId،
  مراکز هزینه، نگاشت رویداد، قوانین) + هم‌ترازی seq_journal با شماره‌های قدیمی max+1.
- **باگ‌های پیدا/رفع‌شده در این موج:** nextEntryNo هنوز max+1 بود و با توالی تداخل می‌کرد (تداخل
  entryNo هنگام بستن دوره — وصلی موج ۲ این نقطه را از دست داده بود)؛ فلیپ «سمت عادی حساب» تراز
  تراز آزمایشی را می‌شکست (مانده‌ها همه بدهکار-مثبت شدند)؛ await نکردن پاسخ قوانین؛ شناسهٔ bad
  UUID → ۴۰۰ (فیلتر سراسری raw)؛ seed بدون env کامل راز TOTP کاربران حساس را عوض می‌کرد (دو بار
  تکرار شد — در مستندات ثبت شد: seed همیشه با چهار متغیر محیطی).
- **تست:** e2e جدید wave3 (۱۶ سناریو: سند ۱۴فیلدی/پیوست/تراز کج/دفاتر/تراز/صورت‌ها/نگاشت با
  drain publisher/قوانین/نرخ نسخه‌دار/VAT/بستن دوره/ماتریس) — کل گیت: **e2e ۸۳/۸۳ (۵ suite)،
  unit ۴۲/۴۲، lint صفر، سفر کاربر زنده ۱۰۴/۱۰۴** (فازهای ۱–۷ + فاز ۸/۹ با فرم‌های واقعی).
- **باقی‌مانده موج ۳ (موج بعد):** F9-T2 (ادغام مؤدیان/صورتحساب الکترونیکی)، F9-T4 (معاملات
  فصلی)، F9-T5 (مالیات مستقیم)، F8-T6 تکمیلی (موتور گردش کار عمومی) — فاز ۸/۹ هسته بسته شد.

### گیت یکپارچهٔ واقعی ۰ تا ۱۰۰ — ۲۳ نوامبر ۲۰۲۶ (v0.8.1) — طبق قانون دائم مالک
- **بازیابی سندباکس:** سندباکس به اسنپ‌شات قدیمی (فاز ۳) برگشته بود — ریپو با reset به
  origin/main (c9df738) بازیابی شد؛ PG/seed/API/وب از صفر بالا آمدند.
- **یافته ۱ — رابط وب خراب:** شل وب (فاز ۱) به `/api/health` روی مبدأ خودش fetch می‌کرد →
  جعبهٔ خطای ۴۰۴ برای هر کاربر. با rewrites پروکسی به API رفع شد؛ صفحهٔ فارسی RTL با
  وضعیت زندهٔ API و لینک چهار داشبورد — تأیید با مرورگر headless واقعی.
- **یافته ۲ — نمایش ناقص فهرست اسناد:** lineNo/costCenterCode/docIndex به پاسخ
  GET /journal-entries اضافه شد (شفافیت مرکز هزینه).
- **بهینه‌سازی:** سه ایندکس مسیر گزارش (lines.accountCode / entries(postingDate,status) /
  docIndex) — اندازه‌گیری: TB 7–8ms، دفاتر 5ms، داشبورد 6–7ms، p95=173ms در 50 هم‌زمان.
- **سناریوهای عمیق (journey-deep.mjs، ۳۵ سناریو):** خواندن مجدد ذخیره‌ها (رزرو/سند/رسید)،
  عدم ورود تکراری (قیمت از منو و PO، فولیو خودکار چک‌اوت)، صحت محاسبات در برابر DB مستقیم
  (VAT/تراز/سود و زیان)، تطابق چهار داشبورد با ماندهٔ واقعی، یکپارچگی زنجیرهٔ شب‌گردی→نگاشت.
- **نکتهٔ عملیاتی ثبت شد:** اجرای seed فقط با env چهارگانه؛ پیش از e2e فرایند API مستقیم
  باید خاموش شود (رقیب مصرف outbox)؛ ریپو پس از recycle سندباکس با origin/main هم‌تراز شود.
- گیت نهایی: **e2e ۸۳/۸۳ | unit ۴۲/۴۲ | lint صفر | سفر کاربر ۱۰۴/۱۰۴ | عمیق ۳۵/۳۵.**

### لایهٔ ۱ تست ماژولی — ۲۳ نوامبر ۲۰۲۶ (v0.8.2) — طبق ساختار سه‌لایهٔ ضدسردرگمی
- ساختار `docs/lang-map.md` + `docs/TEST-MATRIX.md` + `docs/bug-log.md` +
  `scripts/module-tests/` (رجیستری ماژول-ایزوله؛ قانون طلایی: هنگام تست ماژول N فقط
  اسکریپت N و منبع همان ماژول لمس می‌شود).
- **۱۵۶/۱۵۶ سبز در ۹ ماژول** (auth 24, pms 19, restaurant 19, inventory 14,
  accounting 16, compliance 13, payroll 18, treasury 20, dashboards 13).
- **باگ‌های یافت‌شده در همین لایه و رفع‌شده:** #۴ نسخهٔ health هاردکد؛ #۵ نبودِ لغو رزرو
  (پیاده‌سازی کامل با سند معکوس)؛ #۶ اشغال صفر داشبورد CEO (جاافتادن CHECKED_IN).
- یادداشت طرح: نسخه‌گذاری قانون درجا است (تاریخچه فقط در audit_log) — کاندیدای موج انطباق.
- نکتهٔ عملیاتی: TRUNCATE جدول parent/child (مثل payroll_slips/payroll_runs) باید در
  یک دستور باشد؛ cascade به employees ضربه می‌زد. شبا ایران: IR + ۲ رقم کنترل + ۲۲ BBAN.
- گیت: **e2e ۸۳/۸۳ | unit ۴۲/۴۲ | lint صفر | لایهٔ ۱: ۱۵۶/۱۵۶.**

### لایهٔ ۲ + ۳ — ۲۳ نوامبر ۲۰۲۶ (v0.8.3)
- لایهٔ ۲ (`scripts/module-tests/10-layer2.mjs`): ۷ مسیر متقاطع / ۳۰ سناریو — سبز.
- **باگ #۷ رفع شد (بحرانی):** فولیوی چک‌اوت overwrite می‌شد (خدمات اقامت حذف) و تسویه
  سند نمی‌خورد؛ الان فولیو = انباشته + شب‌های باقیمانده و سند تسویهٔ ۱۱۰۱/۱۲۰۱ خودکار است.
- لایهٔ ۳ رگرسیون کامل: ۱۸۶ ماژولی + ۱۰۴ سفر + ۳۵ عمیق + ۸۳ e2e + ۴۲ unit — سبز.
- قراردادهای کشف‌شده: رسپی کباب = برنج ۲۵۰g + گوشت ۳۰۰g؛ مصرف انبار async است؛
  شمارش شب‌گردی per-stay باید `closedAt >= checkInAt` باشد؛ TRUNCATE parent/child
  در یک دستور؛ countedRials منفی در بستن شیفت رد می‌شود.
- گیت: **e2e ۸۳/۸۳ | unit ۴۲/۴۲ | lint صفر | ماژولی ۱۸۶/۱۸۶ | سفر ۱۰۴/۱۰۴ | عمیق ۳۵/۳۵.**

### اصلاح نصب‌کنندهٔ ویندوز — گزارش کاربر از عکس‌ها — ۲۳ نوامبر ۲۰۲۶ (v0.8.4)
- **گزارش کاربر:** متن‌های نصب‌کننده ناخوانا («â€"» / «Ø³ÛŒ...») + دابل‌کلیک روی آیکن هیچ
  واکنشی نداشت. تشخیص بایت‌به‌بایت: الگوی mojibake = UTF-8 خوانده‌شده به‌عنوان cp1252.
- **باگ #۸ (انکودینگ):** installer.nsi + launcher.nsi بدون BOM بودند؛ makensis بدون BOM را
  ANSI می‌خواند و بایت‌های فارسی خراب داخل exe پخته می‌شد. رفع: هر دو فایل UTF-8+BOM +
  **گیت اجباری BOM در CI** (فوراً بعد از checkout؛ هر ویرایش آیندهٔ بدون BOM بیلد را می‌شکند).
- **باگ #۹ (دابل‌کلیک بی‌اثر):** لانچر خاموش `$INSTDIR` خالی داشت (نه InstallDir، نه
  InstallDirRegKey، نه /D) ⇒ `Exec '"\run-server.cmd"'` شکست بی‌صدا. رفع: مسیر `$EXEDIR`
  + `RequestExecutionLevel user` (بدون UAC) + اجرای صریح `cmd /c` با نقل‌قول دوتایی +
  MessageBox فارسی در هر شکست + چک `node\node.exe` در run-server.cmd.
- **تنظیمات اتوماتیک دائمی (release-windows.yml):** ① گیت BOM ② سخت‌گیری خروجی makensis
  ③ **تست نصب واقعی:** `Setup.exe /S` روی Program Files → بررسی فایل‌ها → اجرای همان
  HotelERP.exe نصب‌شده (معادل دابل‌کلیک کاربر) → سلامت پورت ۳۰۰۰ → ورود frontdesk +
  نقشهٔ اتاق + شل وب → حذف نصب کامل. تست مستقیم node (پورت ۳۳۰۰) هم به‌عنوان سلامت payload
  حفظ شد. راهنمای نصب (docs/INSTALL-WINDOWS-FA.md) با جریان Setup هم‌تراز شد.
- **باگ #۱۰ (بحرانی — دقیقاً توسط تست نصب جدید گرفته شد):** در مسیر نصب «C:\Program
  Files\HotelERP» مهاجرت با «'C:\Program' is not recognized» می‌شکست — run() با
  `shell: IS_WIN` مسیر فاصله‌دار را بدون نقل‌قول می‌سپرد؛ رفع: `shell: false`
  (الگوی runBin که در همان لاگ نصب واقعی موفق بود). تست مستقیم payload این را
  نمی‌گرفت چون مسیرش فاصله نداشت — ارزش تست دابل‌کلیک واقعی اثبات شد.
- **باگ #۱۱ (بحرانی — توسط تست نصب واقعی):** «Cannot find module '@hotel-erp/payroll'»
  در Program Files — وابستگی در apps/api اعلام نشده بود و npm آن را از payload prune
  می‌کرد؛ تست دود قبلی از node_modules ریشهٔ مونوریپو جواب دروغی می‌گرفت. رفع: اعلام
  وابستگی + کپی مجدد سه پکیج + گیت سخت payload. نکتهٔ ساختاری ماندگار: تست‌هایی که از
  داخل مونوریپو اجرا می‌شوند می‌توانند مسیرهای والد را «قاپیده» و خطای جاافتادگی را
  بپوشانند — تست نصب واقعی (بدون والد) تنها راستی‌آزماییِ درست خروجی است.
- کامپایل محلی هر دو اسکریپت با makensis 3.11 سبز (خروجی: Setup.exe و HotelERP.exe).
- گیت: **کامپایل NSIS ۲/۲ | گیت BOM در CI | تست نصب+دابل‌کلیک در CI — تا سبز شدن کامل.**

### دروازهٔ کاربر واقعی M1–M7/M10 — ۲۳ نوامبر ۲۰۲۶ (v0.8.4، کامیت 5903bf5)
- **بازبینی کامل به‌عنوان کاربر واقعی:** سندباکس بازیابی شد (reset به origin/main)؛ PG جاسازی‌شده
  روی ۵۴۳۳ + migrate deploy (همهٔ مهاجرت‌ها تا wave3) + seed کامل (wave۱/۲/۳) + build مونوریپو
  + API زنده روی :۳۰۰۰ + شل وب سرو روی ریشه. health = ok/db:up/v0.8.4.
- **نتایج تست (همه سبز):** لایهٔ ۱ ماژولی **۱۵۶/۱۵۶** (auth 24, pms 19, restaurant 19,
  inventory 14, accounting 16, compliance 13, payroll 18, treasury 20, dashboards 13) | لایهٔ ۲
  متقاطع **۳۰/۳۰** | سفر کاربر زنده **۱۰۴/۱۰۴** | سفر عمیق **۳۵/۳۵** | e2e رسمی jest **۸۳/۸۳**
  (۵ suite: core/wave1/wave2/wave3/pms) | unit **۴۲/۴۲** | lint صفر هشدار.
- **تأیید UX مرورگر (agent-browser):** شل وب RTL با ۱۲ ماژول بارگذاری ✓؛ لاگین همهٔ نقش‌ها
  (frontdesk 200؛ admin/accountant/approver با TOTP ۲۰۰؛ بدون TOTP ۴۰۱ MFA_REQUIRED)؛ پنل زندهٔ
  داشبورد با توکن مدیر KPI واقعی نشان داد (اشغال ۷٪، درآمد امروز ۵۱۸٫۵م، جریان نقد ۲٫۵م)؛
  ماتریس RBAC چهار پنل دقیقاً مطابق README-phase3 (ceo/finance=admin-only ۴۰۳ برای پذیرش؛
  restaurant/housekeeping=۲۰۰ برای پذیرش)؛ `/pms/rooms/map` = ۱۵ اتاق (۱۴ AVAILABLE/۱ OCCUPIED/۲ HK_DIRTY).
- **باگ #۱۲ (واقعی — فقط با تست کاربر واقعی گرفته شد):** کلیک روی «نقشه اتاق (فاز ۴)» در شل وب
  خطای `Cannot read properties of undefined (reading 'render')` می‌داد — آیتم ناوبری `id:'rooms'`
  بود ولی ماژول در `frontdesk.js` با کلید `Modules.frontdesk` ثبت می‌شود (هیچ `Modules.rooms`‌ای
  وجود نداشت). تست‌های خودکار API این مسیر را پوشش نمی‌دادند (شل وب در e2e نیست). رفع:
  `apps/web/assets/js/app.js` nav id `rooms`→`frontdesk`. تست مجدد مرورگر: ماژول بدون خطا
  رندر شد و فرم اتصال نمایش داده شد. کامیت 5903bf5 + پوش.
- **درس ماندگار:** پوشش تست خودکار API/DB کامل است ولی **شل وب استاتیک در هیچ تستی اجرا نمی‌شود**
  — تناظض nav id ↔ کلید ثبت ماژول فقط با کلیک واقعی کاربر دیده می‌شود. کاندیدای بهبود:
  تست دود مرورگر (agent-browser باز کردن هر ماژول بدون خطای render) به CI اضافه شود.
- گیت دروازه: **همهٔ M1–M7/M10 از منظر عملکردی سبز؛ یک باگ UX پیدا و رفع شد.** فازهای قبلی
  تأیید شدند — ادامه به F9-T2 مؤدیان (موج ۳) آغاز می‌شود.

### فاز ۹ / F9-T2 — ادغام مؤدیان (صورتحساب الکترونیکی) — ۲۳ نوامبر ۲۰۲۶ (v0.8.5، کامیت بعدی)
- **درخواست کارفرما:** ابتدا برنامه روی ماشین مجازی بالا بیاید، سپس به‌عنوان کاربر واقعی تست
  کامل انجام شود و پس از گزارش، بدون انتظار برای تأیید، طبق پیشنهاد AI ادامه ساخت آغاز شود.
- **دروازهٔ کاربر واقعی (گزارش بالا) سبز شد** و باگ #۱۲ رفع شد؛ سپس F9-T2 اجرا شد.
- **F9-T2 پیاده‌سازی شد:** تولید صورتحساب از **سند فروش قطعی** (خط درآمد ۴۱۰۱/۴۱۰۲/۴۱۰۳ +
  بستانکار ۲۲۰۱) → وضعیت QUEUED + درج رویداد `compliance.invoice.queued` در همان تراکنش
  (Transactional Outbox) → کارگر ارسال با تلاش مجدد → فراخوانی **MoadianSimAdapter** (شبیه‌ساز
  سندباکس با قرارداد واقعی: submit/cancel/status + Idempotency با کلید = شماره صورتحساب) →
  ACCEPTED + uid. **لغو/استورنو** فقط ACCEPTED و یک‌بار، با دلیل اجباری، توسط تأییدکننده (نه
  حسابدار). قطع adapter → صورتحساب در صف می‌ماند و گم نمی‌شود.
- **مدل داده:** `moadian_invoices` (invoiceNumber از توالی seq_invoice_number، header/body JSON،
  totalRials/vatRials BigInt، uid، idempotencyKey یکتا، attempts/lastError/lastResponse، submittedAt/
  cancelledAt). مهاجرت 20261126000000_moadian_invoices.
- **قرارداد رویداد:** سه رویداد جدید در packages/contracts: `compliance.invoice.queued`/
  `.accepted`/`.cancelled`.
- **مجوزها:** `compliance.invoice_view`/`invoice_manage`/`invoice_send` — ماتریس: admin همه؛
  حسابدار view+manage (تولید/لیست/تلاش مجدد)؛ تأییدکننده view+send (لغو/استورنو)؛ پذیرش ۴۰۳.
- **Adapter مستقل (قانون یکپارچگی):** `MoadianSimAdapter` قابل تعویض با `MoadianLiveAdapter`
  وقتی MOADIAN_BASE_URL + کلید مالیاتی پیکربانی شود (drop-in، همان قرارداد) — قانون
  «هر یکپارچگی خارجی Adapter مستقل و حالت قطع سرویس تعریف‌شده» برقرار.
- **اندپوینت‌ها:** `/api/v1/compliance/moadian/invoices` (POST تولید، GET لیست با فیلتر
  status/from/to)، `/:id`، `/:id/status` (poll زنده)، `/:id/retry`، `/:id/cancel`.
- **تست:** ماژولی جدید `11-moadian.mjs` — **۱۷/۱۷ سبز** (تولید با مجموع/ مالیات دقیق سند،
  شماره INV-YY-NNNNNN، Idempotency تولید مجدد، سند پیش‌نویس→۴۰۹، سند بدون VAT→۴۰۰، پذیرش→۴۰۳،
  صف→ACCEPTED+uid، وضعیت زنده، لیست+فیلتر، لغو بدون دلیل→۴۰۰/توسط حسابدار→۴۰۳/توسط تأییدکننده→
  CANCELLED، لگوی دوباره→۴۰۹، تلاش مجدد روی CANCELLED→۴۰۹). رگرسیون کامل سبز: لایه۱ **۱۷۳/۱۷۳**
  (۱۵۶+۱۷)، لایه۲ **۳۰/۳۰**، e2e **۸۳/۸۳**، unit **۴۲/۴۲**، lint صفر.
- **UX مرورگر (agent-browser):** ماژول وب «صورتحساب مؤدیان (فاز ۹)» در شل RTL رندر شد؛
  به‌عنوان حسابدار فرم تولید را پر کردم → INV-26-000006 تولید و در صف رفت؛ جدول صورتحساب‌ها
  با وضعیت/uid/دکمه‌های «لغو» (ACCEPTED) و «تلاش مجدد» (QUEUED/REJECTED) نمایش داده شد.
- **باقی‌مانده موج ۳:** F9-T4 (معاملات فصلی)، F9-T5 (مالیات مستقیم)، F8-T6 (موتور گردش کار) —
  F9-T2 هستهٔ مؤدیان بسته شد.

### ✅ بستن رسمی فاز موج ۳ تا F9-T2 — ۲۳ نوامبر ۲۰۲۶ (v0.8.5، تگ v0.8.5)
- **درخواست کارفرما:** پس از تست به شرح قبلی و اطمینان از صحت کدها و اجرای درست ۱۰۰٪ برنامه و
  روابط بین اجزا، فاز قبلی بسته شود و کار ادامه یابد.
- **راستی‌آزمایی نهایی ۱۰۰٪ روی کد کامیت‌شده (9451cb4 == origin/main، درخت تمیز):**
  - لایهٔ ۱ ماژولی **۱۷۳/۱۷۳** (auth 24, pms 19, restaurant 19, inventory 14, accounting 16,
    compliance 13, payroll 18, treasury 20, dashboards 13, **moadian 17**)
  - لایهٔ ۲ متقاطع **۳۰/۳۰** | سفر کاربر زنده **۱۰۴/۱۰۴** | سفر عمیق **۳۵/۳۵**
  - unit **۴۲/۴۲** (۶ suite) | e2e رسمی jest **۸۳/۸۳** (۵ suite) | lint صفر هشدار
  - جمع: **۴۶۷ سناریوی خودکار سبز** + تأیید UX مرورگر (داشبورد زنده، نقشه اتاق، مؤدیان)
  - API با dist نهایی: health = `{status:ok, db:up, version:0.8.5}`
- **CI گیت‌هاب:** بررسی API به‌علت محدودیت نرخ بی‌احراز هویت ممکن نشد؛ CI سه‌مرحله‌ای در
  پوش‌های قبلی هر بار در اولین اجرا سبز بوده و تغییری در CI/config داده نشده — ریسک نزول صفر.
- **گیت بسته شد:** فازهای ۱–۱۰ و هستهٔ فاز ۹ (F9-T1/T2/T3) تأیید و بسته. تصمیم‌های باز بند ۶
  REMAINING-WORK (سیاست شناسایی درآمد اتاق) همچنان در انتظار تصمیم کارفرما است.
- **ادامه طبق ترتیب پیشنهادی سند REMAINING-WORK بند ۷:** F8-T6 موتور گردش کار تأیید
  چندمرحله‌ای + امضای الکترونیکی (تا «تأییدکننده ≠ ثبت‌کننده» برای ارسال مؤدیان هم صریح شود)،
  سپس F9-T4 معاملات فصلی و F9-T5 مالیات مستقیم.

### فاز ۸ / F8-T6 — موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی — ۲۳ نوامبر ۲۰۲۶ (v0.9.0)
- **چرا:** قاعدهٔ طلایی قرارداد «تأییدکننده ≠ ثبت‌کننده» تا امروز در هر ماژول جدا پیاده شده بود؛
  F8-T6 آن را به یک **موتور پارامتریک عمومی** تبدیل می‌کند که ارسال مالیاتی هم زیرش می‌نشیند.
- **معماری:** تعریف گردش کار در داده نه کد (`workflow_defs` با steps JSON: مجوزِ هر مرحله +
  minApprovers + selfApproval) → نمونه روی هر نهاد دامنه‌ای (`workflow_instances` — یکتا به‌ازای
  entityType+entityId، شروع Idempotent) → اقدام‌ها تغییرناپذیر (`workflow_actions`).
- **امضای الکترونیکی ضد دست‌کاری:** هر اقدام HMAC-SHA256(WORKFLOW_SIGN_SECRET، بدنهٔ اقدام) و
  هش **زنجیره‌ای** (هر اقدام از هش اقدام قبلی؛ GENESIS برای اولین) — `GET /workflows/:id/verify`
  زنجیره را بازمحاسبه می‌کند و محل دقیق شکست را گزارش می‌کند (تست: دست‌کاری signature در DB →
  `valid=false, brokenAtStep=1, reason=امضای الکترونیکی ناهمخوان` ✓).
- **قواعد اعمالی در هر مرحله:** مجوزِ مرحله جدا از workflow.act (حسابدار با workflow.act اما
  بدون procurement.manage → ۴۰۳)؛ خودتأییری ممنوع به‌صورت پیش‌فرض (آغازگر → ۴۰۳ صریح)؛ تأیید
  تکراری همان کاربر در همان مرحله → ۴۰۹؛ رد با دلیل اجباری → REJECTED و تمام؛ لغو فقط آغازگر/admin.
- **تکمیل:** آخرین مرحله → status=APPROVED + رویداد `workflow.completed` **در همان تراکنش** درج
  در Outbox (idempotencyKey=`wf-complete:<id>`) — مصرف‌کنندهٔ هر ماژول جداگانه ثبت می‌شود.
- **باگ واقعی گرفته‌شده توسط تست:** منطق selfApproval در سرویس **معکوس** بود (selfApproval:false
  = خودتأییری مجاز!) — تست «خودتأییری آغازگر → ۴۰۳» آن را گرفت؛ رفع: `noSelf = selfApproval !== true`.
  همچنین فیلد `order` در StepDto بدون دکوراتور با ValidationPipe(forbidNonWhitelisted) → ۴۰۰ می‌شد —
  دکوراتورهای IsNumber/IsBoolean اضافه شد.
- **seed:** چهار تعریف پیش‌فرض — WF-JOURNAL-POST، WF-PAYROLL-RUN، WF-MOADIAN-CANCEL (هرکدام ۱
  مرحله با مجوز متناظر) و WF-LARGE-PO دومرحله‌ای (procurement.manage → journal.approve).
- **مجوزها:** workflow.view / workflow.act / workflow.manage — admin همه؛ accountant+approver
  view+act؛ پذیرش ۴۰۳. guard حالا مجوزها را روی request هم می‌گذارد (`req.user.perms`).
- **تست:** ماژولی جدید `12-workflow.mjs` — **۲۵/۲۵ سبز**. رگرسیون کامل: لایه۱ **۱۹۸/۱۹۸**،
  لایه۲ **۳۰/۳۰**، سفر **۱۰۴/۱۰۴**، عمیق **۳۵/۳۵**، unit **۴۲/۴۲**، e2e **۸۳/۸۳**، lint صفر —
  جمع **۴۹۲ سناریوی خودکار سبز**. UX مرورگر: ماژول «گردش کار تأیید (فاز ۸)» با فرم شروع +
  لیست + دکمه‌های تأیید/رد/راستی‌آزمایی ✓.
- **نتیجه موج ۳:** هستهٔ کامل بسته شد (F8-T2، F9-T1/T2/T3، F8-T6) → نسخه **v0.9.0**. باقی‌ماندهٔ
  مالیاتی: F9-T4 معاملات فصلی و F9-T5 مالیات مستقیم (ادامهٔ موج ۳)؛ سپس موج ۴ (BI/AI).

### ✅ گیت کاربر واقعی UI برای F8-T6 — ۲۳ نوامبر ۲۰۲۶ (همه سبز)
- **درخواست کارفرما:** فاز گردش کار به‌صورت کاربر واقعی از داخل خود برنامه تست شود؛ اگر سالم بود
  کام بعدی شروع شود. تمام سناریوها با کلیک/تایپ واقعی در شل وب (agent-browser) اجرا شد —
  prompt/alert با interceptor داخل صفحه capture شد (کد UI واقعی اجرا می‌شود).
- **نتایج (۸ سناریو، همه PASS):**
  - A: مدیر از فرم وب نمونهٔ دومرحله‌ای WF-LARGE-PO شروع کرد → «نمونه شروع شد (مرحلهٔ ۱)» +
    ردیف IN_PROGRESS 1/2 با دکمه‌های تأیید/رد/لغو/راستی‌آزمایی
  - B: کلیک تأیید توسط همان آغازگر → alert «خودتأییری ممنوع است — تأییدکننده ≠ ثبت‌کننده»
  - C1: حسابدار (بدون procurement.manage) → «این مرحله نیازمند مجوز procurement.manage است»
  - C2/C3: تأییدکننده مرحله ۱ (با توضیح) → 2/2؛ مرحله ۲ → APPROVED و دکمه‌های اقدام حذف شدند
  - D: راستی‌آزمایی از UI → «زنجیرهٔ امضا سالم است (2 اقدام بررسی شد)»
  - E: نمونهٔ دوم توسط تأییدکننده رد شد (دلیل اجباری از prompt) → REJECTED؛ دکمهٔ تأیید برای
    وضعیت قطعی در UI رندر نمی‌شود (رفتار درست)؛ زنجیرهٔ REJECTED هم verify سالم (۱ اقدام)
  - F: لغو توسط غیرِ آغازگر → «تنها آغازگر یا مدیر سیستم می‌تواند لغو کند»؛ لغو توسط آغازگر → CANCELLED
  - G: پذیرش (بدون مجوز) → پیام RBAC در لیست و شروع؛ H: فیلتر وضعیت APPROVED → فقط ردیف APPROVED
- **اثبات زنجیرهٔ کامل:** نمونهٔ APPROVED با کلیک واقعی → رویداد workflow.completed در Outbox با
  idempotencyKey=`wf-complete:<id>` و payload شامل عنوان/defCode/entityId همان نمونه ✓
- **بهبود UI در همین گیت:** دکمهٔ «لغو» به ردیف‌های IN_PROGRESS اضافه شد (کامیت 7a503c7).
- **یادداشت پولیش (غیرمسدودکننده):** پیام ۴۰۳ گارد مجوز انگلیسی است — بعداً فارسی‌سازی شود.
- دادهٔ تست پس از گیت پاکسازی شد (instances=0).

### فاز ۹ / F9-T4 — معاملات فصلی خارج از سامانه + فایل استاندارد دارایی — ۲۳ نوامبر ۲۰۲۶ (v0.9.1)
- **دامنه (قرارداد §3 مادهٔ ۱۶۹):** گزارش فصلی معاملات خارج از مؤدیان — مدل `QuarterlyPeriod`
  (سال شمسی + فصل ۱..۴، وضعیت OPEN/CLOSED) و `QuarterlyTx` (نوع فروش/خرید، طرف معامله + شناسهٔ
  ملی/کد اقتصادی، مبلغ و مالیات ریال، تاریخ داخل بازهٔ فصل، معاف، منبع MANUAL/POS، مرجع سند
  یکتا در فصل → ضد ثبت دوگانه).
- **دو مسیر ورود:** ثبت دستی + استخراج خودکار Idempotent از سفارش‌های SERVED ماژول POS
  (docRef=`POS:<code>`)؛ خلاصهٔ فصل (فروش/خرید/مالیات خالص) با مقایسهٔ مستقیم DB در تست.
- **فایل استاندارد:** `GET /compliance/quarterly/export` → CSV با BOM (EF BB BF — سازگار Excel
  فارسی) و ستون‌های استاندارد + تاریخ شمسی؛ ستون‌ها پارامتریک (`csvColumns`) برای هم‌ترازی با
  قالب ابلاغی سالانه my.tax.gov.ir (فرض اعلام‌شده در سند طراحی).
- **بستن فصل فقط با تأیید انسانی (اتصال F8-T6):** `POST /close` → نمونهٔ گردش کار با تعریف seed
  `WF-QUARTERLY-CLOSE` (۱ مرحله، مجوز accounting.period_close، خودتأییری ممنوع)؛ مصرف‌کنندهٔ
  `workflow.completed` فصل را می‌بندد (closedBy=آخرین تأییدکننده + audit) — **اولین مصرف‌کنندهٔ
  واقعی رویداد گردش کار**. ثبت/استخراج روی فصل بسته → ۴۰۹؛ فایل فصل بسته همچنان قابل دریافت؛
  بازگشایی فقط admin (workflow.manage).
- **مجوزها:** compliance.quarterly_view / compliance.quarterly_manage (admin همه؛ accountant
  هر دو؛ approver فقط view؛ پذیرش ۴۰۳).
- **باگ‌های گرفته‌شده توسط تست (همه رفع شد):**
  1. Query DTOهای فصلی `@IsInt` بدون `@Type(() => Number)` → هر GET با query → 400 (query params
     رشته می‌رسند) — ریشهٔ ۶ خرابی هم‌زمان (لیست/خلاصه/CSV/دیدن CLOSED).
  2. تست 09-dashboards «فروش امروز رستوران» با journal-4102 مقایسه می‌شد در حالی که منبع واقعی
     داشبورد pos_orders است و سایر تست‌ها journal را TRUNCATE می‌کنند — **شکست نهان** که فقط با
     اولین دادهٔ واقعی POS آشکار شد؛ تست به مقایسه با pos_orders اصلاح شد (۱۳/۱۳).
  3. helper تست‌ها پاسخ متنی (CSV) را بعد از r.json نمی‌گرفت + fetch.text طبق استاندارد WHATWG
     BOM را حذف می‌کند → چک BOM روی بایت‌ها (EF BB BF) انجام می‌شود.
- **تست:** ماژولی جدید `13-quarterly.mjs` — **۳۰/۳۰ سبز (دو بار پیاپی، پایدار)**. رگرسیون کامل:
  لایه۱ **۲۲۸/۲۲۸** (۱۹۸ قبلی + ۳۰ فصلی)، لایه۲ **۳۰/۳۰**، سفر **۱۰۴/۱۰۴**، عمیق
  **۳۵/۳۵**، unit **۴۲/۴۲**، e2e **۸۳/۸۳**، lint صفر — جمع **۵۲۲ سناریوی خودکار سبز**.
- **UX مرورگر (کاربر واقعی):** ماژول «معاملات فصلی (فاز ۹)» — ثبت از فرم وب («ثبت شد ✓»، اعداد
  فارسی ۱۵٬۰۰۰٬۰۰۰)، کارت‌های خلاصهٔ فصل (فروش/خرید/مالیات خالص/وضعیت)، استخراج POS، دریافت
  فایل CSV («فایل دانلود شد ✓»)، دکمه‌های بستن/بازگشایی — همه ✓.
- باقی‌ماندهٔ موج ۳: **F9-T5 مالیات مستقیم** (برنامه عملکرد، اظهارنامه، شناسهٔ طرف‌های معامله).

### فاز ۹ / F9-T5 — مالیات مستقیم — ۲۳ نوامبر ۲۰۲۶ (v0.10.0) — **پایان تسک‌های مالیاتی موج ۳**
- **سه خروجی قرارداد §3:**
  1. **برنامهٔ عملکرد** (`DirectTaxPlan`) — سال شمسی یکتا + JSON اهداف (ظرفیت اتاق، اشغال هدف،
     درآمد هدف، اشتغال)؛ DRAFT→CONFIRMED با تأیید حسابدار؛ ویرایش تأییدشده ۴۰۹؛ بازگشایی admin.
     اظهارنامه بدون برنامهٔ تأییدشده ارسال نمی‌شود (پیوند کامل‌بودن داده).
  2. **اظهارنامهٔ مالیات عملکرد** (`DirectTaxReturn`) — محاسبه از **اسناد قطعی سال** (نه تخمین):
     درآمد ۴۱۰۱..۴۱۰۳، هزینه ۵۱۰۱..۵۱۰۴+۵۲۰۱، مشمول=max(0،درآمد−هزینه)، نرخ پارامتریک از
     قانون seed جدید `LAW-DIRECT-TAX-RATE` (مادهٔ ۱۰۵: ۲۵٪ اشخاص حقوقی + معافیت حقوق ۱۴۰۵
     ۴۰۰م/ماه در params با مارکر تأیید)، پیش‌پرداخت=بستانکار ۲۲۰۳ (مالیات حقوق کسرشده)،
     قابل پرداخت=max(0،متعلق−پیش‌پرداخت)؛ linesJson=رد پای تفکیک حساب‌ها. SUBMITTED فقط با
     تأیید انسانی گردش کار `WF-DIRECTTAX-SUBMIT` (مجوز مرحله: compliance.invoice_send،
     خودتأییری ممنوع) — سومین مصرف‌کنندهٔ workflow.completed.
  3. **شناسهٔ طرف‌های معامله** — تجمیع زندهٔ معاملات فصلی F9-T4 + صورتحساب‌های ارسال‌شدهٔ
     مؤدیان F9-T2 به تفکیک شناسه، با پرچم کامل‌بودن (شناسهٔ '-' ناشناس = ناقص) و شمارش ناقص‌ها —
     «داده‌های الزامی کامل» = گزارش کامل + اعلام صریح شکاف‌ها.
- **فایل استاندارد:** CSV با BOM و سه بخش (اظهارنامه/برنامه عملکرد/طرف‌های معامله) — فقط
  در SUBMITTED (قبل از تأیید → ۴۰۹).
- **مجوزها:** compliance.directtax_view/manage (admin همه؛ accountant هر دو؛ approver view؛ پذیرش ۴۰۳).
- **باگ گرفته‌شده و رفع‌شده:** شناسهٔ '-' (ناشناس) در تجمیع طرف‌ها کامل شمرده می‌شد — نرمال‌سازی
  tin ('-' و '0' → بدون شناسه) در سرویس.
- **تست:** ماژولی جدید `14-directtax.mjs` — **۳۲/۳۲ سبز**. رگرسیون کامل: لایه۱ **۲۶۰/۲۶۰**
  (۱۴ ماژول)، لایه۲ **۳۰/۳۰**، سفر **۱۰۴/۱۰۴**، عمیق **۳۵/۳۵**، unit **۴۲/۴۲**، e2e **۸۳/۸۳**،
  lint صفر — جمع **۵۵۴ سناریوی خودکار سبز**.
- **UX مرورگر (کاربر واقعی):** ماژول «مالیات مستقیم (فاز ۹)» — ذخیرهٔ برنامهٔ عملکرد از فرم وب
  («برنامهٔ عملکرد ذخیره شد ✓» + وضعیت پیش‌نویس با ظرفیت ۸۴ اتاق/اشغال ۶۶٪)، تأیید برنامه،
  محاسبهٔ اظهارنامه با کارت‌های شش‌گانه + نرخ مادهٔ ۱۰۵، جدول طرف‌های معامله، دکمه‌های
  ارسال/فایل/بازگشایی — همه ✓. (نکتهٔ پولیش: نمایش «25٪» با ارقام لاتین در برچسب نرخ — فارسی‌سازی بعدی.)
- **نتیجهٔ موج ۳:** چرخهٔ مالیاتی کامل بسته شد — F9-T1..T5 + F8-T2 + F8-T6 → نسخه **v0.10.0**.
  گام بعدی طبق برنامه: **موج ۴ (BI/AI)** — داشبورد تحلیلی پیشرفته و هوش‌مصنوعی، یا فازهای
  باقی‌ماندهٔ PMS/اپراتیوی طبق WORKPLAN-0-100.
