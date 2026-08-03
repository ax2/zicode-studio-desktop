# ADR 0005: Application plugins are hosted above Pi extensions

- Status: Proposed
- Date: 2026-07-31

## Context

ZiCode Studio Desktop currently has two extension-like mechanisms:

1. Pi extensions run inside each `pi --mode rpc` process and add commands, tools, prompts, or
   extension UI requests.
2. Product features such as Finance Workbench and Help are frontend modules compiled into the
   application.

Neither mechanism provides an installable desktop application plugin with its own main view,
toolbar commands, storage, permissions, lifecycle, or management UI. Treating a desktop plugin as
only another Pi extension would also make the plugin lifecycle depend on one session runtime and
would give application UI code no stable host contract.

The product requires Chat to behave like the default application, plugins to replace the main
content area, command-only plugins to remain useful without a sidebar entry, and both Chat and Pi
to invoke plugin capabilities. The proposed plugin top toolbar and application-menu contributions
were removed from scope on 2026-07-31; commands use the Command Palette, shortcuts, contextual
actions, or plugin-owned views instead.

## Decision

Create an application-level plugin platform owned by the Rust Host and the application shell.
Application plugins are distinct from Pi extensions, even when a plugin contributes Pi tools.

```text
Application shell
  ├── activity bar, sidebar views, command palette and main-view router
  ├── Chat core plugin
  └── sandboxed plugin views
             │ typed Plugin Host API
             ▼
Rust Plugin Host
  ├── registry, install, update, enable/disable and uninstall
  ├── manifest validation, permission decisions and audit
  ├── plugin data, secret and network brokers
  └── capability and command registry
             │ local authenticated tool bridge
             ▼
Pi plugin-broker extension
  └── exposes approved plugin tools to the active Pi runtime
```

The stable contract is a versioned application Plugin API. A plugin may contribute:

- an activity and one or more sidebar views;
- a main view that replaces Chat while active;
- commands, settings, keybindings, and contextual actions;
- background capabilities callable by Chat, another authorized plugin, or Pi;
- Pi tools whose execution is routed through the Host capability broker.

Chat is a non-removable core plugin using the same view and command registry. It remains the default
activity and can call plugin capabilities through the Host API. Finance Workbench will be migrated
to a built-in plugin after the platform shell and broker are stable.

The Rust Host is authoritative for installation, path validation, permissions, secrets, network
access, and capability invocation. The WebView must not load plugin assets from arbitrary file URLs.
Plugin views use a dedicated local origin, restrictive Content Security Policy, an iframe sandbox,
and a message-based SDK.

The first implementation milestone supports trusted built-in plugins and explicitly trusted local
development plugins. It must not describe the WebView sandbox as an operating-system security
boundary. A public third-party registry is blocked until signed packages and a sandboxed background
runtime such as WASI are available.

Pi integration uses one bundled broker extension. Installing a plugin must not append arbitrary
`--extension` arguments to Pi. The broker receives only the approved tool schemas for the current
scene and forwards calls to the Host using a per-runtime credential. Raw Pi RPC remains private to
the Host; plugins use capability-checked facade methods.

## Consequences

- Plugins remain available while users switch sessions; Pi processes can restart independently.
- A plugin can expose a main application experience without duplicating the Chat shell.
- Simple plugins can omit activities and views and contribute only Command Palette actions or
  shortcuts.
- Plugin enablement and permissions can be scoped per scene.
- Built-in and external plugins share one manifest and SDK, but built-ins can declare trusted
  capabilities unavailable to third-party packages.
- Plugin tools can block an agent turn; invocation needs timeouts, cancellation, idempotency, audit,
  and bounded request/response sizes.
- Migrating Finance Workbench requires preserving its current scene restrictions and deterministic
  service behavior.
- Headless plugin execution is not part of the first milestone. Until a Host-owned background
  runner exists, UI-worker capabilities require an attached desktop client and fail explicitly when
  unavailable.

## Rejected alternatives

### Make every application plugin a Pi extension

Rejected because Pi extension lifetime is tied to a runtime instance, Pi does not own the desktop
navigation shell, and direct extension UI cannot provide install/update/permission management.

### Give plugin views direct Tauri or filesystem access

Rejected because it bypasses scene policy, path authorization, audit, and remote-client
restrictions.

### Allow arbitrary native sidecars in the first public plugin format

Rejected because a child process is not sandboxed and would make permissions largely advisory.
Native sidecars may be considered later as a separately signed, high-trust distribution class.
