# ساخت نصاب دسکتاپ (F12-T1 — قانون ۸)

این پوشه شل Electron سامانه است: API محلی را به‌عنوان فرآیند فرزند اجرا می‌کند و وب را نمایش می‌دهد.

## محتوای بسته
- `main.js` — شل: اجرای `api/main.js` (با `ELECTRON_RUN_AS_NODE`)، انتظار برای health، بازکردن پنجره
- `preload.js` — پل امن (contextIsolation روشن)
- `package.json` — کانفیگ electron-builder: NSIS ویندوز + AppImage لینوکس، `extraResources` = وب + API + node_modules

## ساخت نصاب ویندوز (روی ماشین ویندوزی — wine لازم نیست)
```bat
cd packaging\desktop
npm install
npm run dist:win
:: خروجی: dist\Hotel-ERP-Setup-0.11.0.exe (نصاب NSIS فارسی)
```
پیش‌نیازها: Node 20+، PostgreSQL در دستگاه مقصد (یا دیتابیس شبکه)، در cmd ویندوز اجرا شود.

## PoC لینوکسی (در همین محیط ساخت — اثبات مسیر بسته‌بندی)
```bash
cd packaging/desktop
npm install
npm run dist:linux   # → dist/Hotel-ERP-0.11.0-x86_64.AppImage
```

## مجوزها/لایسنس
`LICENSE-FA.txt` متن لایسنس نصاب NSIS است (فارسی، right-to-left در NSIS نمایش داده می‌شود).

## نکتهٔ امنیتی
پنجره‌ها `contextIsolation: true` و `nodeIntegration: false` دارند؛ لینک خارجی در مرورگر سیستم باز می‌شود و شل فقط به `127.0.0.1` وصل است.
