!macro NSIS_HOOK_POSTINSTALL
  ; WebView2 is shared by Windows applications. Install the pinned offline
  ; runtime only when neither a machine-wide nor per-user runtime is present.
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 webview2_done
  ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 webview2_done

  IfFileExists "$INSTDIR\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" 0 webview2_missing
  DetailPrint "Installing Microsoft Edge WebView2 Runtime..."
  ExecWait '"$INSTDIR\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0
  StrCmp $0 "0" webview2_done
  MessageBox MB_ICONSTOP "Microsoft Edge WebView2 Runtime installation failed with exit code $0."
  Abort

  webview2_missing:
    MessageBox MB_ICONSTOP "The bundled Microsoft Edge WebView2 Runtime installer is missing."
    Abort

  webview2_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Only remove HKCU Explorer verbs owned by this exact installation path.
  ; A newer Studio install at another path must keep its menu registration.
  IfFileExists "$INSTDIR\zicode-studio-desktop.exe" 0 explorer_cleanup_done
  ExecWait '"$INSTDIR\zicode-studio-desktop.exe" --remove-explorer-menu-current' $0
  StrCmp $0 "0" explorer_cleanup_done
  DetailPrint "ZiCode Studio Explorer menu cleanup was skipped or failed (code $0)."
  explorer_cleanup_done:
!macroend

; Never terminate another process. Check again immediately before file changes.
!macro ZiCodeRequireStopped executableName productName
  Push $R0
  Push $R1
  nsis_tauri_utils::FindProcess "${executableName}"
  Pop $R0
  ; The pinned plugin returns 1 only when no process matches; fail closed otherwise.
  ${If} $R0 != 1
    nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${productName}"
    Pop $R1
    ${IfNot} ${Silent}
      ${If} $PassiveMode != 1
        MessageBox MB_ICONEXCLAMATION "$R1"
      ${EndIf}
    ${EndIf}
    SetErrorLevel 42
    Quit
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

; The legacy MSI uninstaller is external code and may kill a running Studio.
; Refuse automatic migration without running that uninstaller.
!ifndef ZICODE_MSI_HIVE
  !define ZICODE_MSI_HIVE HKLM
!endif
!ifndef ZICODE_MSI_UNINSTALL_KEY
  !define ZICODE_MSI_UNINSTALL_KEY "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
!endif
!macro ZiCodeRejectLegacyMsi
  Push $0
  Push $1
  Push $R0
  Push $R1
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 ${ZICODE_MSI_HIVE} "${ZICODE_MSI_UNINSTALL_KEY}" $0
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
    ReadRegStr $R0 ${ZICODE_MSI_HIVE} "${ZICODE_MSI_UNINSTALL_KEY}\$1" "DisplayName"
    ReadRegStr $R1 ${ZICODE_MSI_HIVE} "${ZICODE_MSI_UNINSTALL_KEY}\$1" "Publisher"
    ${If} "$R0$R1" == "${PRODUCTNAME}${MANUFACTURER}"
      ReadRegStr $R0 ${ZICODE_MSI_HIVE} "${ZICODE_MSI_UNINSTALL_KEY}\$1" "UninstallString"
      ${StrCase} $R1 $R0 "L"
      ${StrLoc} $R0 $R1 "msiexec" ">"
      ${If} $R0 != ""
        ${IfNot} ${Silent}
          ${If} $PassiveMode != 1
            MessageBox MB_ICONEXCLAMATION "A previous MSI installation requires manual migration. Setup has not changed your files."
          ${EndIf}
        ${EndIf}
        SetErrorLevel 43
        Quit
      ${EndIf}
    ${EndIf}
  ${Loop}
  Pop $R1
  Pop $R0
  Pop $1
  Pop $0
!macroend
