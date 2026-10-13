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
