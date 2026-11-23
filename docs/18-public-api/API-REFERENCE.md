# مرجع API عمومی Hotel ERP — نسخهٔ ۱.۰ (فاز ۱۲ / F12-T4)

این سند، مستندات عمومی Marketplace است: چگونگی گرفتن کلید API، محدودیت نرخ، و سه مسیر نمونهٔ عمومی.
کلیدها توسط **مدیر سیستم** از مسیر مدیریت ساخته می‌شوند و متن آشکار کلید فقط یک‌بار نمایش داده می‌شود؛ در سرور فقط SHA-256 کلید نگهداری می‌شود.

## ۱. گرفتن کلید (توکن مدیریتی لازم است)

```http
POST /api/v1/marketplace/clients
Authorization: Bearer <token مدیر سیستم>
Content-Type: application/json

{ "name": "OTAPartner", "rateLimitPerMin": 120, "scopes": ["availability", "rates", "reservations"] }
```

پاسخ:

```json
{ "data": { "id": "…", "name": "OTAPartner", "keyPrefix": "hk_XXXXXXXX", "scopes": ["…"], "apiKey": "hk_…", "rateLimitPerMin": 120 } }
```

> ⚠️ مقدار `apiKey` فقط در همین پاسخ برمی‌گردد. عملیات دیگر کلیدها: `GET /marketplace/clients` (فهرست با پیشوند) و `POST /marketplace/clients/:id/toggle` (فعال/غیرفعال).

## ۲. احراز و محدودیت نرخ

هر درخواست عمومی باید هدر `x-api-key` را بفرستد:

```http
GET /api/v1/public-api/v1/availability
x-api-key: hk_XXXXXXXX…
```

- محدودیت نرخ بر پایهٔ کلید است (پیش‌فرض **۶۰ درخواست در دقیقه**، قابل تنظیم هنگام ساخت).
- عبور از سقف: پاسخ `400` با کد `RATE_LIMITED`.
- کلید غیرفعال: پاسخ `403`. کلید نامعتبر: `401`.
- درخواست بدون scope لازم: `403` با نام scope.

## ۳. مسیرهای عمومی

| روش | مسیر | scope | توضیح |
|---|---|---|---|
| GET | `/api/v1/public-api/v1/availability` | availability | وضعیت اتاق‌ها به تفکیک status |
| GET | `/api/v1/public-api/v1/rates` | rates | انواع اتاق و نرخ پایهٔ شب (ریال) |
| POST | `/api/v1/public-api/v1/reservations` | reservations | ثبت رزرو تأییدشده با منبع ONLINE |

### ۳.۱ نمونه: ثبت رزرو

```http
POST /api/v1/public-api/v1/reservations
x-api-key: hk_…
Content-Type: application/json

{ "guestName": "Ali Rezaei", "roomTypeId": "<uuid نوع اتاق>", "from": "2026-12-01", "nights": 2 }
```

پاسخ:

```json
{ "data": { "id": "…", "code": "RSV-2026-000123", "status": "CONFIRMED", "roomType": "STD", "totalRials": "5000000" } }
```

قواعد: `nights` بین ۱ و ۳۰؛ مبلغ کل = نرخ پایهٔ نوع اتاق × شب‌ها؛ کد رزرو از همان توالی پذیرش ساخته می‌شود؛ هر رزرو با `source=ONLINE` در حسابرسی با نام مشتری ثبت می‌شود.

### ۳.۲ مستندات زنده

`GET /api/v1/public-api/v1/_docs` همان جدول بالا را با کلید معتبر برمی‌گرداند.

## ۴. English (summary)

Public endpoints live under `/api/v1/public-api/v1/` and authenticate with a client API key (`x-api-key` header) issued by the administrator through `/api/v1/marketplace/clients`. Only the SHA-256 hash of the key is stored; the plaintext is shown once at creation. Rate limits are per key (default 60 requests/minute) and return `RATE_LIMITED` when exceeded. Scopes: `availability`, `rates`, `reservations`.
