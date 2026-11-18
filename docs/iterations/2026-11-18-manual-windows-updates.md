# Settings updates and manual Windows releases · 2026-11-18

Scope: [#32](https://github.com/ax2/zicode-studio-desktop/issues/32), v0.6.6. Base `fe9b5b441640e5ccb121744cd2a992b784768515` from `integration/v0.6.6`.

## Changes

- Installed Studio version still comes from Tauri `app.getVersion`; Pi comes from the Host health response. Loading/unavailable values now use the existing locale translations. No installed or latest version is hard-coded.
- With signed automatic updates disabled, the settings button opens the repository's `/releases/latest` stable release page for the published version, notes and Windows installer. It does not claim a latest version number has been checked in-app, call the updater, download or restart.
- Every new updater check revokes the old install offer and notes. Empty and failed results clear obsolete state. Disabled checks/installations stop before native dispatch. A generation guard prevents results or failures from old configuration/channel requests from replacing newer state or clearing a newer active check.
- `AUTO_UPDATER.md` now follows Windows-only defaults, describes actual manual availability and preserves the 2026-08-12 key-setup record as historical, not evidence of today's secrets or signature acceptance. No keys were read or generated, no configuration or workflow was enabled.

## Evidence

- Before fix: 9 new cases failed, demonstrating disabled explicit calls still reached the native check, stale offers/notes survived checks, obsolete replies were applied, manual destination was the undifferentiated release list, and Chinese fallbacks were English. Retained log: `outputs/up32-before.log` in the task workspace.
- 35 distinct scoped cases passed with retries disabled: 7 new check-state/race cases, 3 new rendered settings cases, 6 existing updater-store cases, 17 existing settings cases and 2 existing updater-entry cases. The rendered tests execute the production component and store with explicit Tauri/health fixtures; they do not prove actual native installation or launch a browser.
- Focused strict TypeScript check passed for the changed production modules and their imports (`--ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx --esModuleInterop --lib ES2022,DOM,DOM.Iterable`, plus the existing plain-JS ambient declarations). The first attempt was rejected by the installed TypeScript's explicit-files/config rule; using its requested `--ignoreConfig` passed without changing repository config.
- Six-file Biome lint passed with four existing informational suggestions in unrelated lines of `settings.test.tsx`. Design check passed with the existing generated terminal inline-style warning; no unrelated auto-fixes. `git diff --check` and documentation local links passed.
- Read-only GitHub latest-release lookup observed public, non-prerelease `v0.6.2` with `ZiCode.Studio.Desktop_0.6.2_x64-setup.exe` at verification time. This is a timestamped observation, not an app hard-coded result or a downgrade recommendation. A newer development build is not labeled “up to date” from that observation.

## Remaining #32 scope

Keep #32 open: signed update manifests, digest/signature verification on actual updater artifacts, cancel/failure recovery and restart/data preservation across a real update remain unverified. `createUpdaterArtifacts` stays false. This increment adds no network permission, backend endpoint, dependency, release build, desktop operation, account access, credential, tag or publication. Reuse these receipts for this change; do not add routine post-release checks.
