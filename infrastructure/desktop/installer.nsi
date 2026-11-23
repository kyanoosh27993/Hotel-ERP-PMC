; ============================================================
; installer.nsi — نصب‌کنندهٔ کاملاً فارسی Hotel ERP (فاز ۴ — v0.5.0)
; لوگوی سپر و ترازو در آیکون، هدر و صفحهٔ خوش‌آمد
; مراحل نصب به فارسی با DetailPrint برای کاربر نمایش داده می‌شود
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
  DetailPrint "حذف میان‌برها و فایل‌های برنامه…"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="HotelERP Server"'
  Pop $0
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}"
  DeleteRegKey HKLM "Software\${UNINSTKEY}"
  DetailPrint "توجه: داده‌های شما در %APPDATA%\HotelERP حفظ شد."
SectionEnd
