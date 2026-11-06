# ADR 0007: Browser engine boundary and browser-first Studio

- Status: Proposed; native engine primitives verified on Windows; actual Studio integration and complete P0 pending
- Date: 2026-11-04
- Supersedes ADR 0005's proposed Chat-as-default presentation only. Pi, Host and plugin ownership remain unchanged.

The user requests a browser-first Studio, configurable back to the existing workspace. The supplied two-part task book is the long-term requirement baseline (P0–P6). Previously removed project/scene UI stays hidden; one default workspace remains internally, with future expansion supported by stable IDs. No scheduled tasks are reintroduced.

## Route comparison

| Route | Compatibility / capabilities | Operational implications | Decision |
|---|---|---|---|
| Existing Tauri + WebView2 | Existing Windows engine, mature Chromium rendering; not complete Edge or extension ecosystem | Reuse deployed runtime and locked engine crates; implement browser product services separately | First candidate, acceptance required |
| Tauri + CEF | Chromium embedding with more direct control, version shipped by us | New engine distribution, security updates, process/bootstrap/packaging integration; size and resources require measurement | Alternative if WebView2 fails requirements; no download or adoption yet |
| Electron | Chromium/Node process model and browser-control APIs | Desktop-shell migration or a second runtime/bridge, distribution and updater change | Major change requiring impact analysis and user decision |
| External Chrome/Edge connection | Existing browser ecosystem and profiles | Separate application, extension/native messaging or debug connection; cannot provide the requested integrated default shell | Optional connector, not a replacement for the required browser |

No performance, memory, package-size or account compatibility advantage is claimed without measurements. No CEF/Electron runtime has been installed.

## Native view integration correction

The locked Tauri is 2.11.2, Wry 0.55.1. Tauri's `Window::add_child` requires `unstable`. More importantly, in this version `Manager::get_webview_window`, `webview_windows` and the `WebviewWindow` command argument require `window.is_webview_window()`, which becomes false when another registered view has a different label. Studio uses these interfaces throughout its tray, restore and native commands. Directly adding registered Tauri children would require an explicit broad window-lifecycle migration, not simply a React tab component.

The Windows candidate therefore uses Wry's `build_as_child` under the existing native window. Wry is the same engine wrapper already used by Tauri, added as an exact direct dependency, not a new Chromium distribution. Browser content is not registered in the Tauri view registry; it has no Tauri initialization script, token, custom protocol or IPC handler. Wry 0.55.1 unconditionally injects an inert `ipc` shim; the adapter explicitly disables WebView2 web messaging and host objects before navigation. Acceptance must verify native settings and actual non-delivery (a disabled WebView2 transport may silently ignore a JavaScript call), not merely check JavaScript property names. Studio chrome remains the existing trusted Tauri view. Validate this in a real native process before production wiring. Browser business code depends on a native adapter, not COM calls from React.

Browser views and their shared context stay on the UI thread. Navigation work is asynchronous in WebView2; never wait synchronously on UI callbacks. Host-owned tab identity and document revisions control responses; page-supplied IDs never select another tab. Callbacks must not hold mutable UI-engine borrows across re-entrant creation.

## Data and permissions

Use `app_paths::data_root()/browser` under the currently selected fixed/isolated Studio profile. No version, EXE location, Git SHA or daily date is part of a production data path. Engine data lives in `profiles/<profile-id>/engine`; application-owned SQLite stores tabs/order, bookmarks/folders, history, downloads metadata and preferences. Browser workspace and cookie profile are separate concepts; sharing a cookie profile must be explicit, not implied by different tab workspaces. Do not copy browser cookies, credentials or existing Studio WebView data into a new profile. Private profiles use ephemeral storage and never persist session/history contents.

Read current page, navigate, interact, credentials and external submission are separate Host grants. Capture includes native URL, tab/document identity, title, selection/body, timestamp and content version, with bounded output. Webpage text is untrusted material, never system/tool instruction. No automatic model request on startup, navigation, selection or browser opening. Pi remains the only agent runtime; use the existing broker/session consent flow. Prompt text alone is not an injection defense. No blanket `eval` command is exposed to frontends or third-party plugins.

P0 policy denies file/custom schemes, URL credentials, localhost/private address literals and sensitive site permissions. The isolated native probe grants exactly one owned numeric loopback origin. Network requests and workers need engine-level filtering; domain resolution, rebinding, redirects, WebSocket/WebTransport and private-network grants remain explicit acceptance items. No claim of complete SSRF protection until those paths are tested. Do not enable local/private browsing by broadening trusted Tauri URL capabilities.

Downloads require user-selected destination and lifecycle tracking; never execute automatically or overwrite without confirmation. Popups require controlled view creation, shared-environment checks for opener-based login, and storm protection. P0 denies downloads and emits popup requests; this verifies the interception seam, not a completed manager/login workflow. File upload uses the native picker, never arbitrary programmatic file reads. Passwords/payment data are excluded from automatic captures and audit logs.

## Lifecycle and scope

Browser-first mode is configurable and persistent. Explicit notes/tool/file deep links override the default entry. Switching to Notes/Chat/settings hides all native page surfaces; dialogs and narrow overlays must also hide them because native children can sit above HTML. Closing a tab destroys the child; restart restoration is lazy to avoid a tab storm. Hidden tabs may be suspended; no arbitrary low tab count is the product limit. Crash recovery is required; renderer isolation alone does not guarantee that every native WebView2/browser-process failure leaves Studio alive. User data must remain recoverable after such failures.

Windows is the first delivery. Wry/WKWebView/WebKitGTK differences, OAuth, media, PDFs, printing, permissions, extensions and data directories must be verified per platform. Windows success cannot establish cross-platform acceptance. Playwright control is an experiment; no persistent debug port on the user's profile. Native CDP calls are an alternative adapter, not a reason to expose unauthenticated remote debugging.

## Measured Windows feasibility — 2026-11-05

The separate debug-only native acceptance runner passed in two consecutive real processes on the current Windows machine. It exercised three simultaneous native controls, visibility switches, native history and URL, real public HTTPS, body/selection extraction, message transport non-delivery with a positive control, popup/download cancellation, cookie/localStorage restart durability and a second independently persistent profile. A reachable disallowed loopback fixture received zero requests; canceled downloads left no files. This is primitive-level evidence, not Studio chrome, complete private-network security, real login/upload, Pi handoff or cross-platform acceptance.

The engine-facing profile path uses `dunce::simplified` after ownership checks: verbatim canonical Windows paths caused a real cookie restart failure. The engine sets an existing owned download staging path before navigation so cancellation callbacks reliably run. Wry's app-shell default disables SmartScreen; this browser adapter explicitly preserves it. Do not reintroduce these defaults when wiring production. The original failures and exact final executable/source hashes remain in the session evidence.

See [native feasibility report](../iterations/2026-11-05-browser-native-feasibility.md). Final all-target Rust check/clippy passed; repository-wide formatting drift remains advisory. No production UI, installed executable, current user data, permissions or Pi runtime were changed by this primitive-only batch. ADR remains Proposed until the actual Studio P0 acceptance completes.

## References

- Microsoft WebView2Browser sample: https://learn.microsoft.com/en-us/microsoft-edge/webview2/samples/webview2browser
- WebView2 data folders: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder
- Tauri capability boundary: https://v2.tauri.app/security/capabilities/
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- CEF upstream: https://github.com/chromiumembedded/cef
- Exact local source: Cargo.lock; tauri-2.11.2/src/lib.rs and webview/webview_window.rs; wry-0.55.1/src/lib.rs.
