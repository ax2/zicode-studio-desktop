# Windows installer process safety

`src-tauri/windows/installer-safe.nsi` is based on Tauri CLI 2.11.2's
`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi` at Git blob
`a48a46149f6d6bdc76a0bf13f53e4acdfedb310b`, licensed Apache-2.0 or MIT.
The pinned version and normalized template checksum are checked by
`scripts/check-windows-installer-safety.mjs`. When upgrading Tauri CLI, compare
the upstream template and utilities, reapply the changes, update the checksum,
and run the actual Windows installer and upgrade acceptance before shipping.

The installer checks for running instances before side effects and again before
changing installation files. It never kills them. Uninstall checks before its
Explorer hook. NSIS upgrades overlay the previous installation, like Tauri's
`/UPDATE` path, because invoking an old uninstaller could terminate a running
instance. A matching legacy MSI installation is rejected for manual migration;
its uninstaller is not invoked. These checks do not grant permission to close
any user process, and process detection is not a substitute for testing data
retention or the installer with the exact release artifact.

On Windows, after Tauri has installed its NSIS toolchain, run the reproducible
macro test with an unused, project-owned ASCII scratch directory:

```powershell
pwsh -NoProfile -File scripts/test-windows-installer-safety.ps1 `
  -NsisRoot <path-to-tauri-nsis> -ScratchPath <unused-test-directory>
```

The script uses a test-owned process and a unique temporary HKCU registry key.
It exercises both the running-process guard and MSI detection, but it does not
replace end-to-end tests of the built installer, legacy upgrade paths, GUI and
passive modes, or user-data preservation.
