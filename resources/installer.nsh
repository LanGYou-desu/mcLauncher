; MineHarbor NSIS layout helpers
; Create a portable-style layout next to the installed executable.
!macro customInstall
  CreateDirectory "$INSTDIR\.minecraft"
  CreateDirectory "$INSTDIR\.minecraft\versions"
  CreateDirectory "$INSTDIR\.minecraft\libraries"
  CreateDirectory "$INSTDIR\.minecraft\assets"
  CreateDirectory "$INSTDIR\.minecraft\instances"
  CreateDirectory "$INSTDIR\MineHarborData"
!macroend

; Electron Builder normally wipes the whole installation directory. Keep the
; game root and launcher data so reinstalling or uninstalling never destroys
; the user's worlds, mods or encrypted login session.
!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $0 $1 "$INSTDIR\*.*"
  uninstall_loop:
    StrCmp $1 "" uninstall_done
    StrCmp $1 "." uninstall_next
    StrCmp $1 ".." uninstall_next
    StrCmp $1 ".minecraft" uninstall_next
    StrCmp $1 "MineHarborData" uninstall_next
    IfFileExists "$INSTDIR\$1\*.*" 0 uninstall_file
      RMDir /r "$INSTDIR\$1"
      Goto uninstall_next
    uninstall_file:
      Delete "$INSTDIR\$1"
    uninstall_next:
      FindNext $0 $1
      Goto uninstall_loop
  uninstall_done:
    FindClose $0
    ; Only removes the directory when the preserved data folders are absent.
    RMDir "$INSTDIR"
!macroend
