# ساخت APK موبایل (F12-T2 — قانون ۹)

کانال: **Capacitor** روی همان وب شل. پوشهٔ `../web` به‌عنوان webDir استفاده می‌شود و طبق قانون ۹، دستگاه PDA آفلاینِ انبار باید با همین APK کار کند (اسکن بارکد از مرورگر داخلی شل).

## ساخت روی ماشین اندرویدی (Android Studio + SDK)
```bash
cd packaging/mobile
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init   # در صورت نیاز — config از فایل capacitor.config.json خوانده می‌شود
npx cap add android
npx cap sync android
cd android && ./gradlew assembleRelease
# خروجی: android/app/build/outputs/apk/release/app-release.apk → امضا با keystore کارفرما
```

## پیش‌نیازها
- JDK 17 + Android SDK 34
- آدرس API در تنظیمات اپ (ماژول «تنظیمات») به سرور محلی/شبکهٔ هتل داده می‌شود؛ PDA آفلاینِ انبار از حالت آفلاین همان ماژول استفاده می‌کند.
