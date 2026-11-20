# Windows notification data size backport

Base: tray-icon 0.23.1, unchanged public API and dependencies.
Registry crate SHA-256: `15edbb0d80583e85ee8df283410038e17314df5cba30da2087a54a85216c0773` (verified against src-tauri/Cargo.lock before extraction).
Upstream: https://github.com/tauri-apps/tray-icon/tree/tray-icon-v0.23.1
Reference fix: https://github.com/tauri-apps/tray-icon/commit/962c9be6fcc6f82782abe86e9a3a86427ba7bbb8
Win32 requirement: https://learn.microsoft.com/windows/win32/api/shellapi/ns-shellapi-notifyicondataw

Only production change: initialize NOTIFYICONDATAW.cbSize at all four call sites (add, modify icon, modify tooltip, delete). The existing zeroed remainder and event/menu behavior stay intact. This narrowly backports the size correction without upgrading Tauri or adopting newer visibility semantics.

Studio 2026-10-23 reproduced failed zh-CN/en tooltip calls and absent registered tray rect before this change. Real Windows native acceptance must confirm registration, locale update, close/restore and deletion. Keep original license files.

Remove this Cargo patch once the selected Tauri dependency supports a tested upstream tray-icon with the correction. Do not edit shared Cargo registry caches.

The normalized Cargo.toml pins windows-sys =0.61.2 to retain Studio's pre-patch lock selection; the path-source resolver otherwise selected the existing 0.60.2. No Windows API binding upgrade/downgrade is intended.
