# نیازمندی‌های استخراجی — سورس مرجع Hoteldashboard V5.1 (هتل هلیتان)

> دستور مالک: از این سورس برای درک قوانین و خواسته‌های داشبورد مدیریتی استفاده شود.
> آرشیو کامل: مخزن خصوصی `hoteldashboard-5.1-source` (Next.js 16 + Prisma/SQLite + 73k رکورد واقعی).

## پنل‌های ۳۶گانه داشبورد (الگوی ساخت داشبورد مدیریتی ما)

**مالی:** dashboard، ceo، journal، ledger، trial (تراز)، bs (ترازنامه)، pl، cashflow،
bankrec (مغایرت بانکی)، closing (بستن)، compare، centerprofit، breakeven، forecast،
declaration (اظهارنامه)، aging

**مالیات/مؤدیان:** moadian، invoice-moadian، vat، incometax، tax

**عملیات:** hotel (اتاق‌ها)، inventory، assets (دارایی)، maintenance، employees، hr، payroll

**مدیریت داده:** import، import-errors، integrity، coding، companies، parties، fiscal-years،
users، audit، backup، budget، alerts، autoreport، reportbuilder

## الگوهای طراحی که می‌گیریم

1. **مدل داده** (۲۸ مدل Prisma): User، Company، FiscalYear، JournalLine، Invoice/InvoiceItem،
   Budget، CashExpectation، AlertRule، ActionItem، AuditLog، DashLayout، RoomStat،
   InventoryItem/Move، Asset، Maintenance، BankLine، AutoReport، MoadianLog...
2. **اعداد مرجع صحت‌سنجی** (سال ۱۴۰۴): سود اظهارنامه‌ای 340,615,106,959 ریال؛ جمع ترازنامه
   560,135,378,890 ریال؛ فروش خالص تشخیص ۱۴۰۳: 340,802,244,311 ریال — برای تست تطبیق.
3. **فارسی کامل + شمسی + خروجی اکسل/PDF** (exceljs) + reportbuilder با فیلتر ذخیره‌شده.
4. **AlertRule + ActionItem:** هشدار قاعده‌محور و پیگیری اقدام.
5. **DashLayout قابل شخصی‌سازی** + SavedFilter/Favorite.
6. **autoreport:** گزارش خودکار دوره‌ای.
7. **سربرگ فارسی Estedad** در public/ (فونت فارسی بومی).
8. **باکس دانلود dl.html** داخل برنامه برای دریافت نسخه‌ها.
9. **ماهیت داشبورد = مدیر:** تمام بخش‌ها به‌عنوان «کارمند» گزارش روزانه می‌دهند (همسو با قانون ۱۷).
