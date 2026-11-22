# PROGRESS-STATE — حافظه پایدار پروژه (پس از هر فاز به‌روز شود)

> این فایل مرجع حافظه بین نشست‌هاست. اگر حافظه ماشین مجازی ریست شد، از این فایل و
> PHASES.md و AI_DEVELOPMENT_RULES.md ادامه بده.

## وضعیت جاری — نسخه v0.1 (تاریخ شمسی ثبت: ۱۴۰۵/۰۹/۰۱)

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
