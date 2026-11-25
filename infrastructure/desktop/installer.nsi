; ============================================================
; installer.nsi — نصب‌کنندهٔ کاملاً فارسی Hotel ERP
; لوگوی سپر و ترازو در آیکون، هدر و صفحهٔ خوش‌آمد
; مراحل نصب به فارسی با DetailPrint برای کاربر نمایش داده می‌شود
;
; باگ #۱۳ — تشخیص نصب قبلی:
;   اگر برنامه از قبل نصب باشد، نصب‌کننده آن را تشخیص می‌دهد (رجیستری + وجود
;   واقعی Uninstall.exe) و پیام انتخاب نمایش می‌دهد:
;     بله   = حذف کامل برنامه از رایانه (اجرای Uninstall.exe)
;     خیر   = نصب مجدد روی نسخهٔ فعلی (مسیر ارتقا)
;     انصراف = خروج
;   در حالت خاموش (/S): نصب‌نشده → نصب | نصب‌شده → حذف خودکار همان نسخه
; ============================================================
Unicode true

!include "MUI2.nsh"

!define APPNAME "Hotel ERP"
!define COMPANY "Hotel ERP PMC"
!define UNINSTKEY "HotelERP"
!define MUI_ICON "assets\app.ico"
!define MUI_UNICON "assets\app.ico"

Name "${APPNAME} — سامانه یکپارچه هتلداری"
OutFile "out\Hotel-ERP-Setup.exe"
InstallDir "$PROGRAMFILES64\HotelERP"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\header.bmp"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\welcome.bmp"
!define MUI_ABORTWARNING

; ── متن‌های فارسی مراحل نصب ──
!define FINISH_RUN_TEXT "اجرای برنامه پس از اتمام نصب"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\HotelERP.exe"
!define MUI_FINISHPAGE_RUN_TEXT "${FINISH_RUN_TEXT}"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Farsi"

; ── باگ #۱۳ — تشخیص نصب قبلی پیش از هر صفحه‌ای ──
Function .onInit
  ; اول رجیستری حذف استاندارد ویندوز؛ اگر نبود کلید InstallDir خودِ برنامه
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "UninstallString"
  IfErrors 0 check_file
  ReadRegStr $R0 HKLM "Software\${UNINSTKEY}" "InstallDir"
  IfErrors not_installed 0
  StrCpy $R0 "$R0\Uninstall.exe"
check_file:
  ; رجیستری بدون فایل یعنی نصب ناقص/خراب — مثل نصب‌نشده رفتار کن (نصب تازه)
  IfFileExists "$R0" installed not_installed

installed:
  IfSilent silent_uninstall
  ; محدودیت NSIS: MessageBox حداکثر دو جفت برچسب می‌پذیرد — «انصراف» با
  ; fall-through به Quit می‌رسد (ادامهٔ اجرا بعد از MessageBox)
  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "${APPNAME} روی این رایانه از قبل نصب شده است.$\n$\nبله — حذف کامل برنامه از رایانه$\nخیر — نصب مجدد روی نسخهٔ فعلی$\nانصراف — خروج از نصب‌کننده" IDYES run_uninstall IDNO continue_install /SD IDYES
  Quit
run_uninstall:
  ExecWait '"$R0"'
  Quit
silent_uninstall:
  ; حالت خاموش: قانون «نصب‌شده = حذف» بدون دیالوگ؛ داده‌های %APPDATA% حفظ می‌شود
  ExecWait '"$R0" /S _?=$INSTDIR'
  Quit
continue_install:
  Return
not_installed:
  Return
FunctionEnd

Section "نصب Hotel ERP" SecMain
  DetailPrint "در حال استخراج فایل‌های برنامه (سرور، شل وب، پایگاه دادهٔ جاسازی‌شده)…"
  SetOutPath "$INSTDIR"
  File /r "payload\*.*"
  DetailPrint "استخراج کامل شد."

  DetailPrint "ثبت برنامه در ویندوز…"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${UNINSTKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "DisplayIcon" "$INSTDIR\HotelERP.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "Publisher" "${COMPANY}"

  DetailPrint "ایجاد میان‌برهای دسکتاپ و منوی استارت (با آیکون سپر و ترازو)…"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\HotelERP.exe" "" "$INSTDIR\HotelERP.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\HotelERP.exe" "" "$INSTDIR\HotelERP.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  DetailPrint "افزودن قانون فایروال برای دسترسی موبایل روی همان شبکه (اختیاری)…"
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="HotelERP Server" dir=in action=allow program="$INSTDIR\node\node.exe" enable=yes'
  Pop $0

  DetailPrint "✅ نصب کامل شد — داده‌ها در %APPDATA%\HotelERP ذخیره می‌شود."
SectionEnd

Section "un.Uninstall"
  ; کامل بودن حذف: اول فرایندهای در حال اجرا بسته شوند تا هیچ فایلی قفل نماند
  DetailPrint "بستن برنامهٔ در حال اجرا (سرور و پایگاه دادهٔ جاسازی‌شده)…"
  nsExec::Exec 'powershell -NoProfile -Command "Get-Process node,postgres -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like $\"$INSTDIR\*\" } | ForEach-Object { Stop-Process -Id $($_.Id) -Force -ErrorAction SilentlyContinue }"'
  Pop $0
  nsExec::Exec 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq $\"cmd.exe\" -and $$_.CommandLine -like $\"*run-server.cmd*\" } | ForEach-Object { Stop-Process -Id $($_.ProcessId) -Force -ErrorAction SilentlyContinue }"'
  Pop $0

  DetailPrint "حذف وظیفهٔ زمان‌بندی‌شدهٔ اجرای محدود (در صورت وجود)…"
  nsExec::Exec 'schtasks /delete /tn "HotelERP Limited Run" /f'
  Pop $0

  DetailPrint "حذف میان‌برها و فایل‌های برنامه…"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="HotelERP Server"'
  Pop $0
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}"
  DeleteRegKey HKLM "Software\${UNINSTKEY}"

  ; داده‌ها: در حالت خاموش حفظ می‌شود؛ در حالت تعاملی از کاربر پرسیده می‌شود
  IfSilent keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION "داده‌ها و پایگاه دادهٔ محلی (حساب‌ها، اتاق‌ها، اسناد) نیز از %APPDATA%\HotelERP حذف شود؟$\n$\n«خیر» = فقط برنامه حذف شود و داده‌ها بمانند" IDYES wipe_data IDNO keep_data /SD IDNO
wipe_data:
  DetailPrint "حذف کامل داده‌ها (%APPDATA%\HotelERP)…"
  RMDir /r "$APPDATA\HotelERP"
  DetailPrint "داده‌ها حذف شد — برنامه به‌طور کامل از رایانه پاک شد."
  Goto un_done
keep_data:
  DetailPrint "توجه: داده‌های شما در %APPDATA%\HotelERP حفظ شد."
un_done:
SectionEnd
