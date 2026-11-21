# Hotel ERP — سامانه یکپارچه هتلداری (PMS + ERP + POS + BI + AI)

نسخه: v0.1 | بازار هدف: هتل‌های ایران | RTL فارسی/انگلیسی | تقویم هجری شمسی

## اجرای هسته برنامه (بدون نیاز به build)

```bash
cd apps/web
python3 -m http.server 8080
# سپس مرورگر: http://localhost:8080
```

ورود پیش‌فرض نسخه دمو: `admin / 123` (فقط دمو؛ سیستم واقعی در فازهای بعد RBAC کامل دارد).

## ساختار مخزن (طبق بخش ۱۹ Master Blueprint)

```
hotel-erp/
├── README.md  ← همین فایل
├── AI_DEVELOPMENT_MASTER_RULES.md  ← قرارداد توسعه با هوش مصنوعی (۱۰ بخش — الزامی برای هر AI)
├── AI_DEVELOPMENT_RULES.md  ← قوانین ۲۰گانه مالک + قواعد AI + روش فازبندی ۷ ماده‌ای
├── PHASES.md  ← نقشه راه اجرایی و فازبندی
├── PROGRESS-STATE.md  ← حافظه پایدار بین نشست‌ها
├── CHANGELOG.md
├── docs/  ← اسناد تحلیل، معماری، قوانین ایران (11)، مراجع ماژول (18)
├── apps/web/  ← هسته اپ (بدون build step؛ vanilla JS ماژولار)
├── packages/  ← قراردادها و اشتراکی‌ها (فازهای بعد)
├── infrastructure/  ← Docker/CI (فاز ۱ کامل می‌شود)
├── database/  ← Migrationها (فازهای بعد)
├── tests/  ← تست‌های خودکار
├── scripts/  ← نقشه graphify، watcher، ابزارها
└── graphify-out/  ← نقشه ساختاری برنامه (به‌روز توسط watcher)
```

## قوانین حاکم بر توسعه

مطالعه الزامی: [AI_DEVELOPMENT_MASTER_RULES.md](AI_DEVELOPMENT_MASTER_RULES.md) (قرارداد توسعه
با هوش مصنوعی در ریشه پروژه) و [AI_DEVELOPMENT_RULES.md](AI_DEVELOPMENT_RULES.md) (قوانین ۲۰گانه
+ روش فازبندی ۷ ماده‌ای) — هر اصلاح باید چک‌لیست انطباق را کامل کند. قوانین ایران در
[docs/11-iran-compliance/IRAN-LAWS.md](docs/11-iran-compliance/IRAN-LAWS.md).

## ماژول‌های فعال فعلی (v0.1)

1. **داشبورد مدیر AI** — گزارش روزانه بخش‌ها (کارمندان)، تحلیل و پیشنهاد بهبود
2. **حقوق و دستمزد** — پرسنل، قرارداد، احکام، محاسبه، لیست مالیات/بیمه/بانک
3. **تنظیمات** — تم‌ها، فونت متن/عدد، پارامترهای قانونی
4. **تقویم شمسی** — تا سال ۱۵۰۰، کبیسه صحیح، تعطیلات و پرش به تاریخ
