# Windows tray button recovery (#290)

On 2026-11-23 a native Windows regression check compared the public v0.7.2 executable with a debug build from c037a712 plus the tray patch. Each run used an isolated Studio profile. The changed executable had SHA-256 A7E60C0B5B083DECCD91E7F5FC6BF3D8486A295FC9F5E6D011DFC59C486626A1.

The harness first hid the Studio window with WM_CLOSE. It delivered right and left button notifications to the isolated process's tray_icon_app window, using the registered tray callback message. Shell_NotifyIconGetRect returned E_FAIL (0x80004005) in both runs.

| Observation | Public v0.7.2 | Patched Studio |
| --- | --- | --- |
| Close hides the existing window | Yes | 3/3 |
| Right button opens the native popup menu | No | 3/3 |
| Menu contains 显示 ZiCode Studio and 退出 ZiCode Studio | No popup | 3/3 |
| Left button restores the same window handle | No | 3/3 |

The native popup was inspected through its Win32 menu handle and dismissed between checks. The patched process also displayed the native confirmation dialog when its quit command was selected.

The isolated process ran at low integrity. Explorer exposed a single Studio icon whose ownership could not be established without interacting with the daily instance. Physical mouse delivery from Explorer to a standard-user Studio icon remains for consolidated desktop acceptance.

## November 24 release candidate follow-up

The first consolidated acceptance candidate inherited a Low integrity executable label from the staging directory. Its exact binary failed to register the tray and hid the main window on close. Staging the same bytes in a normal user directory produced a Medium integrity process and passed two Windows close/restore cycles with Explorer registration.

The patched v0.7.3 Windows executable had SHA-256 511035812AE9BF8C62B05273EE9B90F587EAB62075A62CEB20747C74646A83A9. At Medium integrity it passed two close/restore cycles, including one after explicitly removing only the probe instance's own Explorer entry. The close handler restored that entry and the left-button callback restored the original window. At Low integrity the patched process could not register the icon and minimized the same window to the taskbar. Both paths saved the restore geometry.

The shared shell now shows a drag grip before the page controls. Blank portions of the browser tab and Notes toolbars also initiate drag; button, tab and right-button input are excluded. The workspace and browser suites passed 290 frontend tests. These checks cover native Windows close, Explorer registration, targeted tray notifications and frontend drag handling. Physical grip movement and Explorer menu acceptance are tracked in issue #290.
