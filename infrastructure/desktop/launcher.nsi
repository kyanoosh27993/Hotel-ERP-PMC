; ============================================================
; launcher.nsi — HotelERP.exe : لانچر برنامه با آیکون سپر و ترازو
; اجرا: پنجرهٔ کنسول سرور را باز می‌کند (پیام‌های فارسی داخل آن)
; ============================================================
Unicode true

OutFile "out\HotelERP.exe"
Icon "assets\app.ico"
SilentInstall silent
Name "Hotel ERP"

Section
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\run-server.cmd"'
SectionEnd
