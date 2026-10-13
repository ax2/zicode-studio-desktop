# ZiCode Studio Desktop

## Product

**ZiCode Studio Desktop** is a local-first, cross-platform personal developer
platform for projects, AI collaboration, knowledge, automation, and delivery.
It is a Tauri app that bundles its own `pi` runtime.

### Architecture

Tauri wraps the web UI. Rust starts a native `HostServer` plus a managed `pi --mode rpc` subprocess using the embedded pi binary shipped in `src-tauri/resources/pi/` (downloaded by `scripts/fetch-pi-binary.js` from pi-mono releases at the version pinned in `scripts/pi-version.json`). The WebView talks to the Rust host over `/v2/ws`; the host bridges runtime requests to Pi over stdio RPC.

```
ZiCode Studio Desktop
  resources/
    public/                       (frontend)
    extensions/picot-bridge.mjs    (legacy-compatible product commands)
    pi/<bun-compiled pi binary + assets>
  Rust HostServer + NativePiManager
    spawn pi --mode rpc --extension picot-bridge.mjs
    WebView  →  /v2/ws  →  HostServer  →  stdio RPC  →  pi
```

Runtime, project data, and extension UI traffic primarily use the native host
protocol. Desktop integration also registers app-local Tauri commands in
`src-tauri/src/main.rs` for workspace windows, scene credentials, plugins,
notifications, backups, automation worker controls, and project storage scans.
Keep every registered command declared in `src-tauri/permissions/default.toml`
and included in its default permission set; run `bun run check:permissions`.

### Goals

- Local desktop GUI: all projects and agents visible in one app
- Multi-project: each project has its own window, isolated working directory, session history, and running agent
- Multi-agent: spawn new agents per project; switch between sessions without leaving the app
- Native runtime protocol: browser frames are routed by Rust over `/v2/ws`, then forwarded to the managed Pi process over stdio RPC.
- Visualization: streaming chat, tool-call cards, thinking blocks, token/cost tracking per session
- Bundle the Pi runtime on every desktop platform; bundle Git, Bash, and the WebView2 offline installer on Windows. macOS and Linux currently use system Git and shell tools.

### Constraints

- Frontend: React/TypeScript features in `frontend/src/` compile into `public/native/react/`; the surrounding shell and protocol modules in `public/` use vanilla JS.
- Backend: Rust (Tauri) owns process lifecycle, the HTTP/WebSocket host, routing, and host data APIs
- PI integration: always via embedded `pi --mode rpc` subprocess — never re-implement PI runtime logic
- Explicit `--tools-only` startup uses a Host-owned plugin session without Pi,
  history restore or startup backup. Preserve this separation: do not silently
  launch AI for tool initialization or recover a stopped tools route into AI.
  Host bootstrap/snapshot `runtimeMode` is authoritative for UI initialization.
- `--open-file` uses the same tool-only lifetime in the file's parent project.
  Keep file intent separate from resource authorization: no automatic content
  read, tool execution or save. Never expose the absolute launch path to a plugin.
- `--open-selection` accepts only 2–4 distinct local regular files in one directory.
  It follows the same tool-only lifetime and per-window/session intent scope as
  `--open-file`; each file still needs a separate metadata preview and explicit
  resource confirmation. The static Explorer file verb remains single-select;
  a separate Windows COM selection verb forwards the whole 2–4 file selection.
- Session history and working directory are isolated per project/port
- The embedded pi version is the source of truth: `pi --version` shown in the UI comes from `PI_STUDIO_PI_VERSION` (set by Rust at spawn time, populated from `scripts/pi-version.json`). A user-installed pi on `$PATH` is irrelevant and never touched.
- User extensions under `~/.pi/agent/extensions/` and `<workspace>/.pi/extensions/` are still auto-loaded by the embedded pi (embedding doesn't disable user extensions).
  Explicit `--isolated-profile <absolute-directory>` disables automatic discovery and uses
  dedicated Studio state for native acceptance; see `docs/desktop-isolated-profile.md`.
  Explicit `--open-folder` launches also disable automatic discovery for their whole
  process while keeping explicitly bundled Studio extensions; see `docs/plugins/explorer-folder-entry.md`.

### PI references

Docs ship inside the embedded pi runtime at `src-tauri/resources/pi/docs/` (populated by `bun run fetch:pi`; see "Bumping the embedded pi version" below). Prefer these repo-relative paths over any globally-installed `pi-coding-agent` — a global install may not exist on a given machine or may be a different version than the one pinned in `scripts/pi-version.json`.

- RPC protocol: `src-tauri/resources/pi/docs/rpc.md`
- SDK: `src-tauri/resources/pi/docs/sdk.md`
- Session format: `src-tauri/resources/pi/docs/session-format.md`
- JSON mode: `src-tauri/resources/pi/docs/json.md`

---

# Agent working notes

Conventions for any coding agent working in this directory.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

This repo uses the single-context domain docs layout: root `CONTEXT.md` plus ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Disk and artifact budget (required)

- Latest user retention policy (2026-10-10): retain one current complete debug runtime
  and one latest complete release runtime. Reuse `target/debug` and `target/release`;
  do not export dated daily runtime copies. Before removing superseded copies,
  preserve referenced evidence and check consumers. A previously denied cleanup
  remains denied: document exact manual candidates rather than retrying it.
- Local development keeps the current application version unchanged. Identify work by Git
  revision, dirty state and evidence date; bump the app version only for an intentional release.
- Use `bun run dev` for daily work and `bun run build:local` for an explicitly needed local
  executable (debug, no installer). Both reuse the project `target`; do not export a new full
  `release/<stage>` directory for each edit or successful check. `bun run build` is for an
  explicitly requested release/package, not routine validation.
- Keep dev/test profile settings aligned. Do not vary RUSTFLAGS, feature sets, target paths or
  profile overrides between checks without a concrete need and a recorded reason. Changing
  debug information settings causes a one-time cache rebuild; do not clean useful cache first.
- The retained runtime `release/plugin-contracts-2026-10-09-02bd9552-dirty` is now an immutable
  base for compact archived dev snapshots. Do not overwrite its files or delete it while those
  inventories reference it. New daily work runs from `target/debug`; formal release artifacts
  and plugin contract/tool versions have their own deliberate versioning requirements.

- Before and after a build/test session, run `pwsh -NoProfile -File scripts/storage-budget.ps1`.
  Follow [disk policy](docs/agents/disk-budget.md). A failed scan is unknown, not zero usage.
- Use one project-owned Cargo target directory. Do not create per-turn target directories,
  duplicate toolchains, dependency trees, or full repository copies. Record any explicit override.
- Reference sizes: Cargo outputs 12 GiB, download cache 1 GiB, task scratch 512 MiB; review
  output volumes below 20 GiB free. Cache sizes are advisory, never permission to delete data
  or stop useful development. Preserve caches that subsequent work will reuse (latest user policy).
- Documentation/contract-only edits require no Rust build, runtime download, or dependency reinstall.
  Batch code edits, run relevant checks once, and reuse cache until diagnosis and reruns finish.
- Preserve useful build output across validation milestones. Only clean genuinely unreferenced
  output after proving its resolved target is project-owned,
  no consumer is active, and deliverable EXEs/installers have been retained outside that target.
- New scratch belongs in `.cache/task-scratch/<task-id>` with an owner/purpose and bounded lifetime;
  remove this task's unreferenced scratch after completion. Keep compact failure logs, latest pass
  evidence and referenced representative screenshots. Preserve existing historical evidence.
- Never delete source, uncommitted/untracked work, lockfiles, installed dependencies, runtime
  resources, releases, user data, credentials, archives or another project's caches just for size.
  Inspect candidates first; `git clean -xfd`, recursive cross-shell deletes and bypassing a denied
  cleanup are prohibited. Report logical bytes separately from observed volume free-space change.
- Windows stage delivery keeps a runnable directory and EXE. Do not also produce ZIP copies.
  A signed `.zicode-plugin` is the plugin protocol container, not a duplicate application archive.

## Independent plugin producers

- The ZiDevTools integration goal is its entire tool catalog, including planned and partial entries.
  Maintain [the all-tools scope](docs/plugins/devtools-all-tools.md) and its per-tool matrix.
  Five pilot capabilities are a milestone, never completion of this integration goal.
  Record every blocked tool with its reason, missing Host/provider capability, workaround,
  owner and reopening condition. Do not silently omit tools or equate temporary blockers with
  permanent incompatibility; new catalog entries must be added to the matrix.
- ZiDevTools integration follows [the interoperability contract](docs/plugins/devtools-interoperability.md).
- Exchange versioned plugin packages and portable contract snapshots only. Do not add sibling-repo
  imports, Cargo path dependencies, symlinks, shared mutable config/data, or require ZiDevTools.exe.
- Received directories under `tests/fixtures/devtools-*/` are byte-frozen provider artifacts.
  Keep them excluded from repository formatting and automatic fixes. Validate file counts,
  sizes and SHA-256 against their receipt before runtime acceptance; never update expected
  digests merely to make a failed check pass. Preserve drift evidence before any verified repair.
- ZiDevTools owns tool implementations and its standalone UI; Studio owns the generic Host,
  permissions, install lifecycle and integration acceptance. New Host APIs require an explicit
  versioned extension and conformance evidence before providers advertise support.

## Package manager commands

Use **Bun** exclusively. Never run `npm install` or `npm ci` — this would create a stray `package-lock.json` that drifts from `bun.lock` and confuses CI (`bun install --frozen-lockfile`).

```bash
bun install --frozen-lockfile   # install deps
bun run <script>                # run package.json scripts
```

## Common commands

```bash
bun run dev              # prepare runtime, extensions, React output, then start tauri dev
bun run test             # vitest run + check-tauri-permissions
bun run test:watch       # vitest in watch mode
bun run check:rust:static # cargo check + clippy + fmt (use after every Rust edit)
bun run check:rust       # same checks plus cargo test when testing is requested
bun run fetch:pi         # download the locked pi binary into src-tauri/resources/pi/
bun run build:extensions # compile picot-bridge and pi-chat extensions into extensions/dist/
bun run build            # full release build (Tauri beforeBuildCommand prepares resources and UI)
```

Single test file: `bun run vitest run public/settings-save-status.test.js`

## Searching the codebase

`src-tauri/target/` is a gitignored Rust build-artifact directory (like `node_modules`/`dist`) containing thousands of `.rcgu.o`/`.rlib` object files. `grep -r`/`rg` do not respect `.gitignore` by default, so a broad recursive search rooted at `src-tauri/` (instead of `src-tauri/src/`) will scan those binaries too — grep's binary-file heuristics can match embedded strings from dependencies and flood the output with thousands of meaningless object-file paths, burying the real hits and making the command look hung.

When grepping for source code, target the actual source directories directly — `public/`, `extensions/`, `src-tauri/src/` — never bare `src-tauri/`. Prefer `rg` (respects `.gitignore` by default) over `grep -r` when available.

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for JS/TS linting and formatting.

After every frontend or extension edit, run the check before declaring the work done:

```bash
bun run check         # lint + format check (read-only, shows violations)
bun run check:fix     # auto-fix all safe issues
bun run lint          # lint only
bun run format        # format check only
bun run format:fix    # auto-fix formatting
```

### Rules

- **Always** run `bun run check` after editing any `.js` / `.ts` file under `public/` or `extensions/`.
- Only mark the task complete if `bun run check` exits 0 (or all remaining violations are intentional and documented).
- Prefer `bun run check:fix` over manual reformatting — Biome is the source of truth for style.

## Design system

Before editing CSS or UI controls, read [`docs/DESIGN.md`](docs/DESIGN.md). Use tokens from `public/style-theme.css` and primitives from `public/design-system.css`; do not add literal design dimensions. After CSS, UI markup, or inline-style changes, run `bun run check` (or focused `bun run check:design`).

## Module Design

The frontend combines React/TypeScript feature views under `frontend/src/` with vanilla JS shell and protocol modules under `public/`. Keep both modular. See [`docs/MODULE_SPLIT_PLAN.md`](docs/MODULE_SPLIT_PLAN.md) for the current large-file inventory and extraction roadmap.

### Rules

- **One concern per file.** Each module owns a single responsibility (e.g. WebSocket client, session sidebar, file browser, theme switching). Do not add unrelated logic to an existing file just because it is convenient.
- **Avoid growing orchestration files.** `public/native/app.js` and `src-tauri/src/main.rs` are composition roots / entrypoints. New feature logic belongs in dedicated modules that are imported and wired there, not implemented inline.
- **New file threshold.** If a feature adds more than ~50 lines of logic, extract it into its own module in the appropriate `public/native/<subdir>/` (e.g. `public/native/features/my-feature.js`) and import it from the appropriate entry point.
- **Large-file guardrail.** Before adding code to any file over 500 lines, first prefer extracting a focused module. If adding to the large file is still the smallest safe change, keep the addition minimal and mention the exception in the final response.
- **CSS by feature.** Do not keep adding feature styles to `public/style.css`. Put component/feature styles in a nearby stylesheet and import it from `style.css`; keep `style.css` for imports, reset, and global shell rules.
- **HTML by owner.** Avoid growing `public/index.html` with large feature markup. Prefer feature-owned DOM construction/templates in the module that owns the behavior, while preserving accessibility and focus management.
- **Rust facades.** For Rust, keep large public modules as thin facades when possible (`host_server.rs`, `host_data.rs`, `main.rs`) and move implementation into submodules grouped by protocol, data, routing, lifecycle, or commands.
- **No shared-state side-effects at import time.** Modules should export functions/classes; side-effects that mutate global state should be triggered explicitly by the caller, not at module load.
- **Naming.** Use kebab-case filenames for JS/CSS that match the single responsibility (`session-sidebar-storage.js`, `file-browser.css`, `workspace-actions.js`). Use Rust module names that describe the domain slice (`sessions`, `workspaces`, `protocol`, `dispatch`).

### Review checklist

- Did this add more than ~50 lines to an existing file? If yes, should it be a new module?
- Did this touch a file already over 500 lines? If yes, can a focused extraction happen first?
- Is the new module cohesive, with explicit dependencies passed via `setup*`, `create*`, or constructor parameters?
- Are tests split or added next to the behavior that moved?
- Were the required checks run (`bun run check` for JS/CSS/TS, `bun run check:rust` for Rust)?

## Architecture

ZiCode Studio Desktop is a Tauri v2 app. The three main layers:

**1. Rust / Tauri (`src-tauri/`)** — process lifecycle, host protocol, and window management.
- `src-tauri/src/native_pi_manager.rs` — spawns and supervises native `pi --mode rpc` processes.
- `src-tauri/src/host_server.rs` — owns the HTTP/WebSocket host (`/v2/ws`, `/v2/bootstrap`) and dispatches protocol frames.
- `src-tauri/src/pi_launch.rs` — resolves the bundled pi binary and bundled compatibility bridge extension.

**2. Frontend (`frontend/src/` and `public/`)** — React feature views plus vanilla JS shell and protocol modules.
- `bootstrap-entry.js` + `native/app.js` — native host protocol entry point, wires up all native modules

`public/native/` is organized into domain subdirectories. Each directory owns its JS, CSS, and test files:

| Subdir | Responsibility |
|---|---|
| `transport/` | RPC adapters & gateways: `runtime-adapter`, `runtime-gateway`, `data-gateway`, `config-gateway`, `config-gateway-readiness`, `control-gateway` |
| `session/` | Session state, sidebar, navigation, search: `session-store`, `session-tree`, `session-sidebar`, `session-navigation`, `session-search-dialog` |
| `composer/` | Message input controls: `composer-images`, `composer-slash-menu`, `composer-submit`, `slash-commands`, `queued-messages` |
| `settings/` | Settings panel and all sub-panels: `settings-panel`, `settings-config`, `settings-toggles`, `settings-save-status`, `package-browse`, `cost-dashboard`, `thinking-effort-control` |
| `workspace/` | Header, project info, file browser: `project-header`, `header-open-app`, `workspace-actions`, `context-usage`, `file-browser` |
| `extensions/` | Extension UI, dialogs, command palette: `dialog`, `extension-ui-host`, `inline-extension-prompt`, `command-palette` |
| `features/` | Independent self-contained features: `app-updater`, `lan-qr`, `remote-auth`, `rpiv-todo-mirror` |
| `utils/` | Pure utilities (no DOM, no side-effects): `random-id`, `router`, `keyboard-shortcuts` |

CSS-only files without a JS pair (`sidebar.css`, `header.css`, `messages.css`, `composer.css`, `instance-swap.css`) stay at the `native/` root and are imported from `public/style.css`.

Cross-subdir import conventions:
- Files within the same subdir use `./foo.js`.
- Files importing from another subdir use `../other-dir/foo.js`.
- Files in a subdir importing from sibling `public/` folders use `../../ui/foo.js`, `../../themes.js`, etc. (one extra `../` vs the root-level `native/` equivalent).
- `ui/message-renderer.js`, `ui/markdown.js`, `ui/tool-card.js` — chat message rendering (dependency-free markdown, collapsible tool cards)
- `ui/context-viz.js`, `ui/conv-nav.js`, `ui/image-lightbox.js`, `ui/layout-insets.js`, `ui/resizable-panel.js` — chat layout/nav helpers (context bar, turn navigator, image zoom, scroll insets, resizable panels)
- `themes.js` — theme switching (6 built-in themes)

**Where to put a new `native/` module:** place it in the subdir whose responsibility best matches it. If a module is purely algorithmic/pure-function with no DOM, prefer `utils/`. If it spans two subdirs equally, prefer the subdir of its primary consumer.

**3. Pi bridge extensions (`extensions/`)** — TypeScript compiled into `extensions/dist/`.
- `picot-bridge.ts` runs inside Pi and exposes product-specific commands. The
  filename and `picot-*` protocol names are retained for compatibility.
- `pi-chat` remains an optional bundled extension for chat integrations.

## Key data flows

- User action → `native/transport/runtime-gateway.js` → `/v2/ws` → `HostServer` → `NativePiManager` → Pi stdio RPC.
- Extension UI requests → Pi stdio RPC event → `HostServer` → `native/extensions/extension-ui-host.js` dialog host → response over `/v2/ws`.

## Bumping the embedded pi version

1. Edit `scripts/pi-version.json` → `version`.
2. `bun run fetch:pi` (re-downloads the platform tarball, replaces `src-tauri/resources/pi/`).
3. Smoke test: `./src-tauri/resources/pi/pi --version` and `bun run dev`.
4. Commit `scripts/pi-version.json`. Do **not** commit `src-tauri/resources/pi/`; it is gitignored.

## Embedded pi: how it ends up inside the .app

End users never run `fetch:pi`. The flow that puts `pi` inside the shipped bundle is:

1. **Tauri before-hooks.** `tauri.conf.json` `build.beforeBuildCommand` and `build.beforeDevCommand` run `bun run fetch:pi`. The release hook also prepares the other bundled resources, extensions, React output, and CSS. `bun run build` invokes the project Tauri CLI, which runs this hook; direct `tauri build` / `tauri dev` calls use the same hooks.
2. **Tauri bundling.** `tauri.conf.json` `bundle.resources` maps `./resources/pi` → `pi`, so the entire pi runtime tree is copied into `<App>.app/Contents/Resources/pi/` at package time.
3. **Last-line guard (build.rs).** `src-tauri/build.rs` PANICS at compile time if `resources/pi/<bin>` is missing in a release profile. This prevents `cargo build --release` (or any IDE that bypasses Tauri) from silently producing a .app with no pi inside. Override only for local experiments via `PI_STUDIO_SKIP_BIN_CHECK=1`.

Net effect: there is no path that ships a ZiCode Studio Desktop release without
the embedded pi binary. End users do not need `bun run fetch:pi` or a manual
install of pi. macOS and Linux currently use system Git and shell tools.

## Post-fix verification (Rust / Tauri)

After every edit under `src-tauri/` (or any Rust fix), run the static lint+check script before declaring the work done. It catches compile-time errors (e.g. `E0282`, `E0061`, Tauri v1→v2 API drift, deprecated APIs) without producing a binary, so it is much faster than `tauri build`. The full script also runs Rust tests and remains the release gate.

```bash
bun run check:rust:static
# or directly
bash scripts/check-rust.sh --static-only
```

`scripts/check-rust.sh` runs, in order:

1. `cargo check --all-targets` — type/borrow/API signature check (~1–5s).
2. In the full `check:rust` mode only, `cargo test` — compile and run Rust tests.
3. `cargo clippy --all-targets -- -D warnings` — lints, warnings as errors.
4. `cargo fmt --check` — advisory only; prints a hint if formatting drifts, but does not fail the script.

### Rules

- **Never** run `tauri build` / `cargo build` just to verify a fix — use `bun run check:rust:static` instead. Per project policy, full builds are not used for verification.
- After editing any `*.rs` file under `src-tauri/`, run `bun run check:rust:static` and only mark the task complete if it exits 0. Run `bun run check:rust` when tests are requested or required by the release process.
- When upgrading Tauri or its plugins, run the script first to surface any deprecation warnings before touching feature code.

## Auto-updater

ZiCode Studio Desktop includes the Tauri v2 updater plugin. The repository is
public; updater artifacts remain disabled until release signing and verification
are configured. Install public releases manually. See `docs/AUTO_UPDATER.md`.

## Tests

For local Windows full Rust checks involving cold WASI compilation, prefer
`RUST_TEST_THREADS=2` for the test harness to avoid oversubscribing the machine.
Windows platform CI and the release Rust gate also use two harness threads;
the platform JSON/summary records the effective selection. Other systems retain
their existing harness setting. Preserve the earlier default-concurrency failure
as evidence when evaluating a bounded-concurrency rerun.
Preserve an explicitly selected thread count and record the actual setting in
the validation receipt. This controls concurrency between tests only: do not
reduce each test's internal load, skip assertions, increase production Worker
budgets, or treat a prior default-concurrency failure as erased by a rerun.
Run required ignored real-runtime acceptance tests separately and retain their
failures even when the ordinary full suite passes.

Vitest tests live in `public/` as `*.test.js` files (jsdom environment). The full `bun run test` also runs `scripts/check-tauri-permissions.js` to validate Tauri capability permissions.
