@echo off
chcp 65001 >nul
title Hotel ERP — سرور برنامه (بستن این پنجره = خاموش شدن برنامه)
cd /d "%~dp0"
echo ==================================================
echo    Hotel ERP - Samane Yekparche Hoteldari (v3.2.2)
echo    در حال راه‌اندازی... اولین اجرا کمی طول می‌کشد
echo    (ساخت پایگاه داده + دادهٔ اولیه ~۳۰ ثانیه)
echo ==================================================
echo.
if not exist "node\node.exe" (
  echo خطا: فایل‌های برنامه کامل نیستند — node\node.exe پیدا نشد.
  echo پوشهٔ برنامه: %~dp0
  echo راه‌حل: Setup را دوباره اجرا کنید. اگر تکرار شد، آنتی‌ویروس/SmartScreen را بررسی کنید.
  pause
  exit /b 1
)
"node\node.exe" server.js
echo.
echo ==================================
echo   برنامه متوقف شد — Tozihate khataye age bood: %APPDATA%\HotelERP\logs
echo   برای بستن این پنجره کلیدی بزنید…
echo ==================================
pause >nul
