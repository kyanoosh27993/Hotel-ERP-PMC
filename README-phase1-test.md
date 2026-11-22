# فاز ۱ تحویل شد — راهنمای تست کارفرما (دروازه M1)

> کامیت مرجع: آخرین کامیت سبز CI روی main — [Actions](https://github.com/kyanoosh27993/Hotel-ERP-PMC/actions)
> همه چک‌های کیفیت سبزند: **Lint + Build + Unit (41 تست) ✓ | E2E با PostgreSQL واقعی (۱۶ سناریو) ✓ | بکاپ/بازیابی round-trip ✓**

## ۱. اجرا (۵ دقیقه — روی هر سیستم با Docker)

```bash
git clone https://github.com/kyanoosh27993/Hotel-ERP-PMC.git
cd Hotel-ERP-PMC
cp .env.example .env          # فقط همین فایل را باز کنید؛ مقادیر نمونه برای تست کافی است
docker compose up -d --build
docker compose logs -f api    # تا دیدن: "API ready on http://0.0.0.0:3000/api/v1"
```

بعد:
- Swagger: http://localhost:3000/docs
- سلامت: http://localhost:3000/api/v1/health → `{"status":"ok","db":"up"}`

## ۲. سناریوهای تست (Swagger → Authorize با توکن)

| # | سناریو | مورد انتظار |
|---|---|---|
| ۱ | ورود: `POST /auth/login` با `frontdesk / ChangeMe_Str0ng!` | access + refresh توکن |
| ۲ | ورود مدیر بدون کد دوم: `admin` بدون totp | 401 با کد `MFA_REQUIRED` |
| ۳ | چرخش refresh و استفاده مجدد از توکن قدیمی | بار اول 200، دوباره 401 و ابطال کل زنجیره |
| ۴ | رزرو: `POST /reservations` با همان `idempotencyKey` دو بار | بار دوم همان رزرو (بدون دوباره‌سازی) |
| ۵ | رزرو هم‌زمان دو نفر روی یک نوع اتاق در یک بازه | دقیقاً یکی 201 و دیگری 409 |
| ۶ | مجوز: `frontdesk` سند حسابداری ثبت کند | 403 Forbidden |
| ۷ | حسابدار سند پیش‌نویس ثبت کند و خودش تأیید کند | ثبت 201 / تأیید 403 (خودتأییری ممنوع) |
| ۸ | سفارش POS با مالیات ۹۰‰ → سپس `GET /journal-entries` | سند خودکار متوازن: صندوق بدهکار، درآمد + VAT بستانکار |
| ۹ | ثبت سند در دوره قفل‌شده | 409 با پیام قفل دوره |

کاربران: `admin` / `accountant` / `approver` / `frontdesk` — گذرواژه از `SEED_ADMIN_PASSWORD`.
(TOTP برای سه نقش حساس: در `.env` راز تست `MFA_TEST_SECRET` است؛ برای تست واقعی با Google Authenticator از `/auth/mfa/setup` استفاده کنید.)

## ۳. چه چیزهایی در این فاز ساخته شد (F1-T1…T9)

- **زیرساخت:** مونوریپو (NestJS + Next.js + پکیج‌های مشترک)، Docker Compose یک‌فرمانی، CI سه‌مرحله‌ای
- **امنیت:** Argon2id، JWT چرخشی با تشخیص سرقت، MFA نقش‌های حساس، RBAC سرورمحور با ماتریس قرارداد، محدودسازی نرخ، Audit Trail تغییرناپذیر
- **معماری:** Transactional Outbox + مصرف‌کننده تکرارپذیر — سند حسابداری فقط از رویداد دامنه‌ای و با قاعده پارامتریک (جدول event_journal_rules)
- **قواعد مالی:** سند متوازن اجباری، قفل دوره، برگشت کنترل‌شده، ریال با عدد صحیح، شماره سند خودکار
- **PoC:** رزرو Race-safe، POS → سند خودکار، Integration Hub + Adapter ساعت‌زنی با حالت قطعی
- **رصد و DR:** OpenTelemetry/Sentry/metrics + Grafana، بکاپ رمزگذاری‌شده AES + بازیابی آزموده (DR runbook)

## ۴. مستندات فنی

- شروع توسعه: [docs/16-deployment/DEV-START.md](docs/16-deployment/DEV-START.md)
- بازیابی بحران: [docs/16-deployment/DR-RUNBOOK.md](docs/16-deployment/DR-RUNBOOK.md)
- برنامه فاز: [docs/20-master-workplan/WORKPLAN-0-100.md](docs/20-master-workplan/WORKPLAN-0-100.md)
