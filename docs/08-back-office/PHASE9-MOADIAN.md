# فاز ۹ — F9-T2: ادغام سامانه مؤدیان (صورتحساب الکترونیکی)

> وضعیت: در حال اجرا (موج ۳). وابستگی‌ها: F8-T2 موتور سند پارامتریک ✅، F5-T4 صورتحساب رسمی ✅، F9-T1 کتابخانه قوانین نسخه‌دار ✅.
> قرارداد حاکم: «ارسال مالیاتی هرگز بدون تأیید انسانی انجام ندهد» و «هر یکپارچگی خارجی Adapter مستقل و حالت قطع سرویس تعریف‌شده داشته باشد».

## ۱) دامنه
سامانهٔ مؤدیان (tax.in.gov.ir) صورتحساب الکترونیکیِ هر معاملهٔ فروش هتل را به‌صورت یک پاکت JSON استاندارد (هدر + بدنه + امضای مالیاتی) دریافت، تأیید و شمارهٔ مرجع (uid) برمی‌گرداند. این ماژول:
- از **سند حسابداری قطعیِ فروش** (سطر بستانکار ۲۲۰۱ مالیات فروش + درآمد ۴۱۰۱/۴۱۰۲/۴۱۰۳) صورتحساب را **تولید** می‌کند — هیچ داده‌ای دستی وارد نمی‌شود.
- صورتحساب را در **صف ارسال پایدار** (Transactional Outbox) می‌گذارد؛ کارگر ارسال با **تلاش مجدد نمایی** و **Idempotency** (کلید = شماره صورتحساب) به سندباکس مؤدیان می‌فرستد.
- وضعیت را (ACCEPTED/REJECTED + uid) ثبت و **قرینهٔ تغییرناپذیر** می‌کند.
- **لغو/استورنو** با پاکت جداگانه (تأییدکننده، نه حسابدار) و سند برگشتی.
- قطعی سرویس مؤدیان → صورتحساب در صف می‌ماند، داده گم نمی‌شود (حالت degrade).

## ۲) Adapter مستقل (قانون یکپارچگی)
`MoadianSimAdapter` — شبیه‌ساز سندباکس مؤدیان با قرارداد واقعی:
- `submit(header, body, idempotencyKey)` → `{uid, status:'ACCEPTED', at}`
- `cancel(uid, reason, idempotencyKey)` → `{uid, status:'CANCELLED'}`
- `status(uid)` → وضعیت زنده
- `health()` → healthy/degraded (برای Integration Hub)
- قابل تعویض با `MoadianLiveAdapter` وقتی `MOADIAN_BASE_URL` + کلید مالیاتی پیکربندی شد (درایو همان قرارداد).

## ۳) مدل داده (`moadian_invoices`)
| فیلد | توضیح |
|---|---|
| id (uuid) | کلید |
| invoiceNumber | INV-YY-NNNNNN — یکتا، از توالی seq_invoice_number |
| journalEntryId | سند فروش مبدأ (قطعی، POSTED) |
| sellerTaxId / buyerTaxId / buyerName | طرف‌های معامله |
| issueDate | تاریخ صدور (شمسی در نمایش) |
| status | DRAFT → QUEUED → SENT → ACCEPTED / REJECTED / CANCELLED |
| header / body | JSON پاکت استاندارد مؤدیان |
| totalRials / vatRials / discountRials | BigInt (قاعدهٔ ریال صحیح) |
| uid | شمارهٔ مرجع مؤدیان |
| idempotencyKey | کلید ارسال تکرارپذیر |
| attempts / lastError / lastResponse | ردپای ارسال |
| createdAt / updatedAt / submittedAt | زمان‌ها |

## ۴) قرارداد رویداد (packages/contracts)
- `compliance.invoice.queued` — در همان تراکنشِ تولید، درج در Outbox.
- `compliance.invoice.accepted` — پس از پاسخ سبز سندباکس.
- `compliance.invoice.cancelled` — پس از استورنو.

## ۵) مجوزها (RBAC)
- `compliance.invoice_view` — مشاهده (admin/accountant/approver)
- `compliance.invoice_manage` — تولید/لیست/تلاش مجدد (admin/accountant)
- `compliance.invoice_send` — لغو/استورنو (admin/approver) — جداسازی تولید از لغو.

## ۶) اندپوینت‌ها (`/api/v1/compliance/moadian`)
| متد | مسیر | مجوز |
|---|---|---|
| POST | `/invoices` (از journalEntryId) | invoice_manage |
| GET | `/invoices` (فیلتر status/from/to) | invoice_view |
| GET | `/invoices/:id` | invoice_view |
| GET | `/invoices/:id/status` (poll زنده) | invoice_view |
| POST | `/invoices/:id/retry` | invoice_manage |
| POST | `/invoices/:id/cancel` (reason) | invoice_send |

## ۷) معیار پذیرش
1. تولید از سند posted → صورتحساب با total = جمع درآمد + VAT دقیقاً مطابق خطوط سند.
2. تکرار تولید همان journalEntryId → همان صورتحساب (نه دوباره‌سازی).
3. صف Outbox → ارسال → status ACCEPTED + uid؛ تلاش مجدد → همان uid.
4. لغو → status CANCELLED + استورنو؛ لغو دوباره → ۴۰۹.
5. قطع adapter → صورتحساب QUEUED باقی می‌ماند، lastError ثبت، داده گم نمی‌شود.
6. ماتریس مجوز: frontdesk ۴۰۳ روی تولید/لغو.
