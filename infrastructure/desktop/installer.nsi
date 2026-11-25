; ============================================================
; installer.nsi — نصب‌کنندهٔ کاملاً فارسی Hotel ERP
; لوگوی سپر و ترازو در آیکون، هدر و صفحهٔ خوش‌آمد
; مراحل نصب به فارسی با DetailPrint برای کاربر نمایش داده می‌شود
;
; باگ #۱۳ + باگ #۱۶ — تشخیص نصب قبلی و حذف کامل:
;   اگر برنامه از قبل نصب باشد، نصب‌کننده آن را تشخیص می‌دهد (رجیستری + وجود
;   واقعی Uninstall.exe / HotelERP.exe) و پیام انتخاب نمایش می‌دهد:
;     بله   = حذف کامل برنامه از رایانه (اجرای Uninstall.exe تعاملی)
;     خیر   = نصب مجدد روی نسخهٔ فعلی (ارتقا؛ اول برنامهٔ در حال اجرا متوقف می‌شود)
;     انصراف = خروج
;   حالت خاموش (/S): نصب‌نشده → نصب | نصب‌شده → حذف کامل برنامه (داده‌ها حفظ می‌شوند)
;     و کد خروج ۰.
;   رفع باگ #۱۶: Quit دیگر کد ۲ نمی‌دهد (SetErrorLevel ۰)؛ باقی‌ماندهٔ _?= پاک می‌شود؛
;   مسیر نصب قبلی (نه $INSTDIR پیش‌فرض) به‌کار می‌رود؛ فرایندهای در حال اجرا پیش از
;   بازنویسی فایل‌ها با stop-app.ps1 تمیز متوقف می‌شوند (شامل توقف تمیز PostgreSQL).
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

Var PreDir
Var PreUninst

; ── ماکروی توقف تمیز برنامه (پیش از بازنویسی فایل‌ها در ارتقا یا حذف) ──
; stop-app.ps1 را از $PLUGINSDIR اجرا می‌کند؛ PG تمیز متوقف می‌شود تا یتیم نمانَد.
!macro STOP_APP DIR
  DetailPrint "توقف برنامهٔ در حال اجرا (سرور و پایگاه دادهٔ جاسازی‌شده)…"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-app.ps1" -InstallDir "${DIR}" -DataDir "$APPDATA\HotelERP"'
  Pop $0
  Sleep 1500
!macroend

; ── ماکروی حذف کاملِ برنامه (فایل‌ها + میان‌برها + فایروال + رجیستری + وظیفه) ──
; داده‌های %APPDATA% دست نمی‌خورد (در حالت خاموش حفظ می‌شوند؛ در حالت تعاملی
; uninstaller از کاربر می‌پرسد). Setup خودش این ماکرو را در مسیر خاموش صدا می‌زند
; چون از بیرونِ $PreDir اجرا می‌شود و محدودیتِ «uninstaller نمی‌تواند خودش را
; پاک کند» و مشکلِ فاصله در `_?=` را ندارد.
!macro REMOVE_ALL DIR
  !insertmacro STOP_APP "${DIR}"
  DetailPrint "حذف وظیفهٔ زمان‌بندی‌شدهٔ اجرای محدود…"
  nsExec::Exec 'schtasks /delete /tn "HotelERP Limited Run" /f'
  Pop $0
  DetailPrint "حذف میان‌برها و قانون فایروال…"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="HotelERP Server"'
  Pop $0
  DetailPrint "حذف فایل‌های برنامه از ${DIR}…"
  RMDir /r "${DIR}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}"
  DeleteRegKey HKLM "Software\${UNINSTKEY}"
!macroend

; ── باگ #۱۳/#۱۶ — تشخیص نصب قبلی پیش از هر صفحه‌ای ──
Function .onInit
  InitPluginsDir
  ; stop-app.ps1 برای مسیر ارتقا و حذف خاموش از داخل Setup
  SetOutPath "$PLUGINSDIR"
  File "stop-app.ps1"

  StrCpy $PreDir ""
  StrCpy $PreUninst ""

  ; اول مسیر نصب از رجیستری خودِ برنامه
  ReadRegStr $R0 HKLM "Software\${UNINSTKEY}" "InstallDir"
  IfErrors 0 have_dir
    ; وگرنه از کلید حذف استاندارد ویندوز
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "UninstallString"
    IfErrors not_installed 0
    StrCpy $PreUninst $R0
    ; مسیر دایرکتوری = دایرکتوری فایل Uninstall.exe (حذفِ «\Uninstall.exe» از انتها)
    StrLen $1 $R0
    IntOp $1 $1 - 14
    StrCpy $PreDir $R0 $1
    Goto check_file
  have_dir:
    StrCpy $PreDir $R0
    StrCpy $PreUninst "$R0\Uninstall.exe"
check_file:
  IfFileExists "$PreUninst" prev_found 0
  ; نصب خراب: Uninstall.exe نیست ولی HotelERP.exe هست — مثل نصب‌شده رفتار کن (بدون uninstaller)
  IfFileExists "$PreDir\HotelERP.exe" prev_found not_installed

prev_found:
  ; مسیر نصب قبلی را به‌عنوان $INSTDIR پیش‌فرض بگذار (ارتقا روی همان مسیر)
  StrCpy $INSTDIR $PreDir
  IfSilent silent_prev
  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "${APPNAME} روی این رایانه از قبل نصب شده است.$\n$\nبله — حذف کامل برنامه از رایانه$\nخیر — نصب مجدد روی نسخهٔ فعلی$\nانصراف — خروج از نصب‌کننده" /SD IDYES IDYES run_uninstall IDNO reinstall_over
  SetErrorLevel 2
  Quit
run_uninstall:
  ; حذف تعاملی: Uninstall.exe خودش دربارهٔ داده‌ها می‌پرسد
  ExecWait '"$PreUninst"' $0
  SetErrorLevel $0
  Quit
silent_prev:
  ; حالت خاموش: حذف کامل برنامه (داده‌ها حفظ می‌شوند)، کد خروج ۰.
  ; حذف را خودِ Setup مستقیم انجام می‌دهد (نه از طریق Uninstall.exe با _?=) تا
  ; هم محدودیتِ «uninstaller نمی‌تواند خودش را پاک کند» نباشد و هم مشکلِ فاصله
  ; در مسیرِ «C:\Program Files\HotelERP» برای _?= پیش نیاید.
  !insertmacro REMOVE_ALL "$PreDir"
  SetErrorLevel 0
  Quit
reinstall_over:
  ; ارتقا روی نسخهٔ فعلی: اول برنامهٔ در حال اجرا را تمیز متوقف کن، بعد نصب کن
  !insertmacro STOP_APP "$PreDir"
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
  ; stop-app.ps1 را از داخل Uninstall.exe استخراج کن (در $PLUGINSDIR)
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "stop-app.ps1"
  !insertmacro STOP_APP "$INSTDIR"

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
  MessageBox MB_YESNO|MB_ICONQUESTION "داده‌ها و پایگاه دادهٔ محلی (حساب‌ها، اتاق‌ها، اسناد) نیز از %APPDATA%\HotelERP حذف شود؟$\n$\n«خیر» = فقط برنامه حذف شود و داده‌ها بمانند" /SD IDNO IDYES wipe_data IDNO keep_data
wipe_data:
  DetailPrint "حذف کامل داده‌ها (%APPDATA%\HotelERP)…"
  RMDir /r "$APPDATA\HotelERP"
  DetailPrint "داده‌ها حذف شد — برنامه به‌طور کامل از رایانه پاک شد."
  Goto un_done
keep_data:
  DetailPrint "توجه: داده‌های شما در %APPDATA%\HotelERP حفظ شد."
un_done:
  SetErrorLevel 0
SectionEnd
