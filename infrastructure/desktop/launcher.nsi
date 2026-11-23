; ============================================================
; launcher.nsi — HotelERP.exe : لانچر برنامه با آیکون سپر و ترازو
; اجرا: پنجرهٔ کنسول سرور را باز می‌کند (پیام‌های فارسی داخل آن)
; ============================================================
Unicode true
; اجرا در سطح کاربر — بدون پنجرهٔ UAC؛ برنامه به دسترسی مدیر نیاز ندارد
; (داده‌ها و پایگاه دادهٔ جاسازی‌شده در %APPDATA%\HotelERP ساخته می‌شوند)
RequestExecutionLevel user

OutFile "out\HotelERP.exe"
Icon "assets\app.ico"
SilentInstall silent
Name "Hotel ERP"

Section
  ; باگ #۹ — در لانچرِ خاموش $INSTDIR خالی می‌ماند: نه InstallDir داریم، نه InstallDirRegKey،
  ; نه /D خط فرمان؛ نتیجه Exec '"\run-server.cmd"' بود که بی‌صدا شکست می‌خورد و کاربر با
  ; دابل‌کلیک هیچ چیز نمی‌دید. مسیر معتبرِ همیشه‌موجود، پوشهٔ خودِ exe است: $EXEDIR
  SetOutPath "$EXEDIR"
  ClearErrors
  ; اجرای صریح cmd با الگوی نقل‌قول دوتایی — مسیر «C:\Program Files\HotelERP» فاصله دارد
  Exec '"$SYSDIR\cmd.exe" /c ""$EXEDIR\run-server.cmd""'
  IfErrors 0 launch_ok
  ; دیگر هیچ شکستی بی‌صدا نیست — پیام فارسی به کاربر نمایش داده می‌شود
  MessageBox MB_OK|MB_ICONSTOP "اجرای Hotel ERP ناموفق بود.$\nپوشهٔ برنامه: $EXEDIR$\nراهنما: Setup را دوباره اجرا کنید؛ اگر تکرار شد آنتی‌ویروس/SmartScreen را بررسی و لاگ‌ها را از پوشهٔ %APPDATA%\HotelERP\logs بفرستید." /SD IDOK
  Abort
  launch_ok:
SectionEnd
