; Green DSH Desktop - installer hooks.
;
; The app keeps its DSH_HOME (sessions, credentials, carbon ledger, console
; settings) INSIDE the install directory, because the harness resolves its
; plugins by walking up from the home to the bundled node_modules. The
; hooks below make installs, upgrades and uninstalls safe and self-healing:
;
;   customInit        runs in .onInit, BEFORE electron-builder would run the
;                     old version's uninstaller. For any registered previous
;                     installation it: (1) closes every process still running
;                     from that directory (the Electron GUI AND the bundled
;                     Node harness child - a surviving node.exe locks the
;                     directory and aborts the old uninstaller with exit
;                     code 2), (2) backs the old DSH home up to %APPDATA%,
;                     (3) removes the old tree with a long-path-safe rmdir
;                     and unregisters it. Step (3) is the upgrade rescue:
;                     electron-builder's default upgrade moves every old file
;                     to %TEMP%\ns*.tmp\old-install first, and that longer
;                     prefix pushes the deepest harness node_modules paths
;                     past MAX_PATH (260), so the move aborts and the whole
;                     setup fails with "Failed to uninstall old application
;                     files ... : 2". Removing the tree ourselves sidesteps
;                     the old uninstaller entirely - broken stale installs
;                     (robocopy-clobbered directories, missing uninstaller
;                     exe, pre-hook versions) all upgrade cleanly.
;   customUnInstall   runs in the uninstaller before the old files are
;                     deleted: same process sweep (so uninstalling from
;                     Add/Remove Programs also works while the app runs)
;                     plus the %APPDATA% backup of the DSH home.
;   customRemoveFiles replaces the uninstaller's default file removal (the
;                     MAX_PATH-fragile atomic move-out) with the same
;                     long-path-safe rmdir, plus an abort guard when a file
;                     is still locked.
;   customInstall     runs after the new files are in place: restores the
;                     DSH home from the %APPDATA% backup, so upgrades keep
;                     sessions, credentials, the carbon ledger and console
;                     settings.
;
; Every step is best effort: a failed sweep or copy is logged and skipped,
; never fatal (the lone exception is the locked-file guard in
; customRemoveFiles, which aborts exactly like the default path would).

; Close every process whose executable lives under ${DIR} - the Electron
; GUI, the bundled Node runtime (resources/runtime/node.exe) and any child
; it spawned. ${SUFFIX} keeps generated labels unique per insertion.
!macro greenDshKillTree DIR SUFFIX
  DetailPrint `Green DSH: closing application processes under ${DIR}`
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Path -and $$_.Path.StartsWith('${DIR}', 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  DetailPrint `Green DSH: process sweep exit code $0`
  ; Belt and braces: tree-kill the GUI by name (also takes down its
  ; children when PowerShell is unavailable).
  nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}" /F /T`
  Pop $0
  Sleep 500
!macroend

; Copy the DSH home under ${DIR} to %APPDATA%\green-dsh-desktop\dsh-home-backup.
!macro greenDshBackupHome DIR SUFFIX
  IfFileExists "${DIR}\resources\app.asar.unpacked\resources\harness\dsh-home\*.*" 0 greenDshSkipBackup${SUFFIX}
    CreateDirectory "$APPDATA\green-dsh-desktop"
    DetailPrint `Green DSH: backing up DSH home to $APPDATA\green-dsh-desktop\dsh-home-backup`
    nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "${DIR}\resources\app.asar.unpacked\resources\harness\dsh-home" "$APPDATA\green-dsh-desktop\dsh-home-backup"'
    Pop $0
    DetailPrint `Green DSH: DSH home backup exit code $0`
  greenDshSkipBackup${SUFFIX}:
!macroend

; Long-path-safe removal of an installation tree. cmd's rmdir deletes
; arbitrarily deep node_modules paths that NSIS's Rename/MoveFileEx cannot
; handle once staged under the longer %TEMP%\ns*.tmp\old-install prefix.
!macro greenDshRemoveTree DIR SUFFIX
  ; Release the working directory first: the installer sets it to $INSTDIR,
  ; and a process CWD keeps the directory locked against rmdir.
  SetOutPath $TEMP
  DetailPrint `Green DSH: removing installation tree under ${DIR}`
  nsExec::ExecToLog 'cmd /c rmdir /s /q "${DIR}"'
  Pop $0
  DetailPrint `Green DSH: tree removal exit code $0`
  Sleep 500
!macroend

!macro customInit
  ; ---- previous installation, per-user first, then per-machine ----------
  ReadRegStr $5 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $5 "" greenDshNoCU
    !insertmacro greenDshKillTree $5 InitCU
    !insertmacro greenDshBackupHome $5 InitCU
    !insertmacro greenDshRemoveTree $5 InitCU
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  greenDshNoCU:
  ReadRegStr $6 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $6 "" greenDshNoLM
    !insertmacro greenDshKillTree $6 InitLM
    !insertmacro greenDshBackupHome $6 InitLM
    !insertmacro greenDshRemoveTree $6 InitLM
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  greenDshNoLM:
!macroend

!macro customUnInstall
  !insertmacro greenDshKillTree $INSTDIR Un
  !insertmacro greenDshBackupHome $INSTDIR Un
!macroend

!macro customRemoveFiles
  ; Replaces electron-builder's default "isUpdated" removal (atomic move-out
  ; to $PLUGINSDIR\old-install), which aborts with exit code 2 whenever the
  ; staged path exceeds MAX_PATH - always true for this app's deep harness
  ; node_modules tree. customUnInstall has already killed every process
  ; under $INSTDIR and backed up the DSH home.
  SetOutPath $TEMP
  DetailPrint `Green DSH: removing installation files under $INSTDIR`
  nsExec::ExecToLog 'cmd /c rmdir /s /q "$INSTDIR"'
  Pop $0
  DetailPrint `Green DSH: file removal exit code $0`
  ; Same safety contract as the default path: if the app executable
  ; survived, something is still locked - abort (and let the caller retry)
  ; instead of reporting a half-completed uninstall.
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 greenDshRemoveOk
    Abort `Green DSH: cannot remove "$INSTDIR" - a file is still in use.`
  greenDshRemoveOk:
!macroend

!macro customInstall
  IfFileExists "$APPDATA\green-dsh-desktop\dsh-home-backup\*.*" 0 greenDshSkipRestore
    DetailPrint `Green DSH: restoring DSH home from $APPDATA\green-dsh-desktop\dsh-home-backup`
    nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$APPDATA\green-dsh-desktop\dsh-home-backup" "$INSTDIR\resources\app.asar.unpacked\resources\harness\dsh-home"'
    Pop $0
    DetailPrint `Green DSH: DSH home restore exit code $0`
  greenDshSkipRestore:
!macroend
