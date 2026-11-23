# فاز ۸ — F8-T6: موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی

> وضعیت: در حال اجرا (موج ۳). وابستگی‌ها: RBAC فاز ۱ ✅، Outbox تکرارپذیر ✅.
> قاعدهٔ طلایی قرارداد: «تأییدکننده ≠ ثبت‌کننده» — در هر مرحله اعمال می‌شود؛ ارسال مالیاتی هرگز بدون تأیید انسانی نیست.

## ۱) چرا موتور عمومی؟
الگوی تأیید تا امروز در هر ماژول جدا پیاده شده (journal.approve، payroll.approve، treasury.void…).
F8-T6 یک **موتور پارامتریک عمومی** می‌سازد که:
- تعریف گردش کار (زنجیرهٔ مراحل) در داده است نه کد — هر مرحله: مجوز لازم + تعداد تأییدکننده + ممنوعیت خودتأییری.
- هر نهاد دامنه‌ای (سند، دورهٔ حقوق، PO، صورتحساب مؤدیان…) می‌تواند نمونهٔ گردش کار داشته باشد.
- هر تأیید/رد با **امضای الکترونیکی** و **زنجیرهٔ هش ضد دست‌کاری** ثبت می‌شود (هر اقدام هش خود را از هش اقدام قبلی می‌گیرد — تغییر هر رکورد زنجیره را می‌شکند و راستی‌آزمایی شکست را گزارش می‌کند).

## ۲) مدل داده
| جدول | توضیح |
|---|---|
| `workflow_defs` | تعریف گردش کار: code یکتا، title، steps JSON (آرایهٔ مراحل با ترتیب)، version، active |
| `workflow_instances` | نمونه روی نهاد: entityType + entityId + title، defId، status (IN_PROGRESS/APPROVED/REJECTED/CANCELLED)، currentStep، initiatedById |
| `workflow_actions` | اقدام‌ها (تغییرناپذیر): instanceId، stepNo، action (APPROVE/REJECT)، actorId، comment، **signature**، **prevHash**، **hash**، at |

مرحله (step): `{ order, permission, minApprovers, selfApproval:false, title }`

## ۳) امضای الکترونیکی و زنجیرهٔ هش
- signature هر اقدام = HMAC-SHA256(WORKFLOW_SIGN_SECRET، `instanceId|stepNo|action|actorId|at|payloadHash`)
- hash اقدام = SHA256(`prevHash|signature|action|actorId`) — زنجیره‌ای؛ هش اولین اقدام از رشتهٔ ثابت `GENESIS` شروع می‌شود.
- `GET /workflows/:id/verify` زنجیره را دوباره محاسبه می‌کند: `valid=true` یا اولین شکست با شماره اقدام.
- WORKFLOW_SIGN_SECRET از env (پیش‌فرض فقط برای تست — در استقرار واقعی الزاماً عوض شود).

## ۴) جریان
۱. شروع نمونه: `POST /workflows` (entityType/entityId/title/defCode) — توسط ثبت‌کننده.
۲. تأیید مرحلهٔ جاری: `POST /workflows/:id/approve` — کاربر با مجوزِ مرحله؛ اگر `selfApproval:false` و کاربر همان آغازگر باشد → **۴۰۳**؛ رسیدن به minApprovers مرحله → مرحلهٔ بعد.
۳. رد: `POST /workflows/:id/reject` با دلیل اجباری → نمونه REJECTED و تمام.
۴. تکمیل مرحلهٔ آخر → status=APPROVED + رویداد `workflow.completed` در Outbox (payload شامل entityType/entityId/defCode) — ماژول‌ها مصرف‌کنندهٔ خودشان را ثبت می‌کنند (الگوی موجود).
۵. لغو توسط آغازگر تا وقتی IN_PROGRESS: `POST /workflows/:id/cancel`.

## ۵) تعریف‌های seed
| code | مراحل | کاربرد |
|---|---|---|
| WF-JOURNAL-POST | ۱ مرحله با مجوز journal.approve، خودتأییری ممنوع | سند حسابداری |
| WF-PAYROLL-RUN | ۱ مرحله با مجوز payroll.approve، خودتأییری ممنوع | دورهٔ حقوق |
| WF-MOADIAN-CANCEL | ۱ مرحله با مجوز compliance.invoice_send، خودتأییری ممنوع | لغو صورتحساب مؤدیان |
| WF-LARGE-PO | ۲ مرحله: خرید (procurement.manage) سپس مالی (journal.approve) | نمونهٔ چندمرحله‌ای واقعی |

## ۶) مجوزها
- `workflow.view` — مشاهده نمونه‌ها و راستی‌آزمایی (admin/accountant/approver)
- `workflow.act` — تأیید/رد مرحله (admin/accountant/approver — مشروط به مجوزِ مرحله)
- `workflow.manage` — تعریف/ویرایش گردش کار (admin)

## ۷) اندپوینت‌ها (`/api/v1/workflows`)
| متد | مسیر | مجوز |
|---|---|---|
| POST | `/` (شروع نمونه) | workflow.act |
| GET | `/` (فیلتر status/entityType) | workflow.view |
| GET | `/:id` | workflow.view |
| POST | `/:id/approve` | workflow.act + مجوز مرحله |
| POST | `/:id/reject` | workflow.act + مجوز مرحله |
| POST | `/:id/cancel` | آغازگر یا admin |
| GET | `/:id/verify` | workflow.view |
| GET | `/defs` + POST `/defs` | view / manage |

## ۸) معیار پذیرش
1. نمونهٔ دومرحله‌ای فقط با دو تأیید متوالی از دو نقش مطلوب APPROVED می‌شود.
2. خودتأییری در هر مرحله → ۴۰۳ با پیام صریح.
3. تأیید با مجوز ناکافی برای آن مرحله → ۴۰۳ حتی با workflow.act.
4. رد با دلیل اجباری → REJECTED؛ اقدام بعدی روی REJECTED → ۴۰۹.
5. verify روی زنجیرهٔ دست‌نخورده → valid=true؛ ویرایش مستقیم یک اقدام در DB → verify شکست را در همان اقدام گزارش می‌کند.
6. تکمیل نمونه → رویداد workflow.completed در outbox_events با idempotencyKey یکتا.
