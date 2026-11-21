# راهنمای شروع توسعه (DEV-START) — فاز ۱

> پیش‌نیازها: Node ≥ 20، Docker Desktop/Engine، Git.

## ۱. اجرای یک‌باره با Docker (معیار پذیرش F1-T1)

```bash
cd hotel-erp
cp .env.example .env          # مقادیر JWT/گذرواژه را عوض کنید!
docker compose up -d --build  # postgres + redis + api + web
docker compose logs -f api    # تا دیدن: API ready on :3000
```

- API: http://localhost:3000/api/v1 — Swagger: http://localhost:3000/docs
- Web: http://localhost:3001
- سلامت: `curl http://localhost:3000/api/v1/health` → `{"status":"ok","db":"up"}`

پروفایل‌های اختیاری: `docker compose --profile messaging up -d` (RabbitMQ) و
`--profile observability` (otel-collector + Prometheus + Grafana روی :3002).

## ۲. توسعه بدون Docker

```bash
npm install
# PostgreSQL محلی آماده؟ فقط DATABASE_URL را در .env ست کنید:
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api    # migrate deploy
npm run db:seed -w apps/api           # نقش‌ها/ماتریس/کاربران/قواعد
npm run build -w packages/shared && npm run build -w packages/contracts
npm run test:unit -w packages/shared && npm run test:unit -w apps/api
npm run dev  # (در فاز بعدی) / فعلاً: npm run build -w apps/api && npm run start -w apps/api
```

## ۳. کاربران نمونه (Seed)

| کاربر | نقش | MFA | مجوز کلیدی |
|---|---|---|---|
| admin | admin | بله (TOTP) | همه |
| accountant | حسابدار | بله | مشاهده/پیش‌نویس/ویرایش/ارسال سند — **بدون تأیید** |
| approver | تأییدکننده مالی | بله | تأیید/برگشت — **بدون ثبت** |
| frontdesk | پذیرش | خیر | رزرو/اتاق/سفارش POS |

گذرواژه‌ها از `SEED_ADMIN_PASSWORD` (.env.example پیش‌فرض: `ChangeMe_Str0ng!` — فقط برای توسعه).
برای تست TOTP: `MFA_TEST_SECRET` ست شود و کد از یک اپ Authenticator با همان راز گرفته شود.

## ۴. جریان درون‌ماژولی (قواعد معماری)

1. هر عملیات دامنه در `$transaction` انجام و رویداد با `OutboxService.enqueue(tx, …)` **در همان تراکنش** ثبت می‌شود.
2. `OutboxPublisher` هر ثانیه رویدادهای انتشارنشده را با `FOR UPDATE SKIP LOCKED` ادعا و به مصرف‌کنندگان تحویل می‌دهد (حداقل یک‌بار).
3. مصرف‌کننده با `inbox_events` تکرار را دفع می‌کند (کلید = شناسه رویداد) — مثال عملی: رویداد رزرو/POS → سند دوطرفه خودکار.
4. ارتباط ماژول‌ها فقط از طریق رویدادهای قراردادی (`@hotel-erp/contracts`) یا درگاه سرویس نسخه‌دار است.

## ۵. چک‌لیست پایان تسک (از قرارداد توسعه — بخش ۸)

- [ ] تست واحد + e2e سبز (CI روی هر پوش اجرا می‌شود)
- [ ] مهاجرت SQL کامیت‌شده (بدون تغییر دستی DB)
- [ ] مستندسازی API (Swagger خودکار + توضیح قرارداد در packages/contracts)
- [ ] حسابرسی عملیات حساس (audit_logs)
- [ ] PHASES.md و PROGRESS-STATE.md به‌روز شده‌اند
