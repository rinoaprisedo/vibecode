; Vibecoder installer for Windows (NSIS). Built by scripts/build-windows.sh:
;   makensis -DVERSION=1.0.1 -DSRC=build/windows/Vibecoder -DOUT=build/Vibecoder-Setup-1.0.1-x64.exe scripts/installer.nsi
Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "1.0.1"
!endif
!define APP "Vibecoder"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP}"
OutFile "${OUT}"
; Per-user install: no administrator prompt needed.
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
SetCompressor lzma
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "rinoaprisedo.com"
VIAddVersionKey "LegalCopyright" "rinoaprisedo.com"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\server\vibecode-server.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; An update while the app is open would hit locked files.
  nsExec::Exec 'taskkill /F /IM vibecode-server.exe'
  nsExec::Exec 'taskkill /F /IM claude.exe'
  Sleep 500

  SetOutPath "$INSTDIR"
  File /r /x "README-Windows.txt" /x "Vibecoder.cmd" "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\server\vibecode-server.exe" "" "$INSTDIR\Vibecoder.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\server\vibecode-server.exe" "" "$INSTDIR\Vibecoder.ico"

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "rinoaprisedo.com"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Vibecoder.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM vibecode-server.exe'
  nsExec::Exec 'taskkill /F /IM claude.exe'
  Sleep 500
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
  ; Logins, chats and the folder list in %APPDATA%\Vibecode are kept on purpose.
SectionEnd
