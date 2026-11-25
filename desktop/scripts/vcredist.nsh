!include "LogicLib.nsh"

!macro customInstall
  StrCpy $2 "missing"
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  SetRegView 32
  ${If} $0 == 1
  ${AndIf} $1 >= 29
    StrCpy $2 "ok"
  ${EndIf}
  ${If} $2 != "ok"
    DetailPrint "Installing Microsoft Visual C++ Runtime (x64)..."
    File "/oname=$PLUGINSDIR\vc_redist.x64.exe" "$%INKVIA_VC_REDIST_FILE%"
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $3
    DetailPrint "Visual C++ Runtime installer exit code: $3"
  ${EndIf}
!macroend
