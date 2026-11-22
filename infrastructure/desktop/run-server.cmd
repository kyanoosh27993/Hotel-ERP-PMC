@echo off
chcp 65001 >nul
title Hotel ERP — سرور برنامه (بستن این پنجره = خاموش شدن برنامه)
cd /d "%~dp0"
echo ==================================================
echo    Hotel ERP - Samane Yekparche Hoteldari (v0.5.0)
echo    در حال راه‌اندازی... اولین اجرا کمی طول می‌کشد
echo    (ساخت پایگاه داده + دادهٔ اولیه ~۳۰ ثانیه)
echo ==================================================
echo.
"node\node.exe" server.js
echo.
echo ==================================
echo   برنامه متوقف شد — Tozihate khataye age bood: %APPDATA%\HotelERP\logs
echo   برای بستن این پنجره کلیدی بزنید…
echo ==================================
pause >nul
