# Defensive browser privacy defaults — 2026-11-18

Scoped follow-up for [#8](https://github.com/ax2/zicode-studio-desktop/issues/8). **Actual fix target: v0.6.6**, `integration/v0.6.6`, initially based on `fe9b5b44`. The Issue's historical v0.6.5 acceptance is retained; this does not change frozen release artifacts or complete the entire browser-isolation requirement.

## Audit and smallest change

The actual Windows engine already disables native web messages and host objects before navigation, disables Wry's clipboard auto-grant, and denies every `PermissionRequested` event. The last decision is not conditional on a user gesture; no per-site grant UI or new grant was introduced. Navigation/resource/download policies are unchanged.

One concrete privacy default was missing: locked Wry 0.55.1 defaults `general_autofill_enabled` to true and forwards it to WebView2 Settings4. [Microsoft documents](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings4) that general autofill defaults to enabled and may store/suggest ordinary form information. The browser builder now explicitly calls `with_general_autofill_enabled(false)` until Studio has an explicit privacy setting. This suppresses general suggestions/new retention; it does not disable regular input fields, delete profile contents, or implement password/credit-card autofill control. In particular, password autosave being false is not a promise that previously saved password suggestions are removed.

The production change is one builder option plus its comment. A separate test-only module is declared in the engine. No new dependency, permission API, handler allowlist, network relaxation or credentials migration was added.

## Actual verification, without desktop interaction

An explicitly selected Windows test creates a fresh task-owned profile and its own hidden `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` parent HWND; the child is created hidden and never presented. It opens **about:blank only**, reads native COM settings, and exercises a harmless ordinary input field. No user window is selected, shown, resized, focused or closed.

The unchanged assertion first **failed on the actual runtime**: general autofill was true, while web messages, host objects, password autosave and child visibility were false. After the single builder option, the actual native test **passes (1/1, 0 ignored, 0.68 seconds)** with all five flags false. The synthetic field remains enabled and writable and retains its assigned value; this is not physical-keyboard acceptance. Setting general autofill true only in this temporary profile then creating a second page verifies that page construction reapplies the false default across the shared profile. Both parent and child remain hidden.

All-target Cargo check and strict all-target Clippy pass with the existing shared target/toolchain. Four existing pure URL-policy tests pass without network access; their probe-origin-named case only constructs/compares policy values, not a server, DNS test or scan. The new test module passes rustfmt; repository-wide existing format differences remain advisory. The real native test is opt-in in normal CI and was explicitly run here, not counted as an ignored pass. No full application/Pi build or desktop launch was performed.

The compact [receipt](evidence/2026-11-18-browser-permission-defaults.json) records before/after values, source hashes and scope. Full initial/final logs remain in the main-session workbench `outputs/issue8-*`. The initial missing-tempfile and wrapper-path errors were fixture/setup failures, retained separately from the actual default-value failure; no dependency was added, assertion skipped or budget widened. Referenced temporary profiles contain only blank-page/synthetic form fixtures and are marked under the isolated worktree's `.cache/task-scratch/browser-permissions-008`.

## Remaining #8 work in small steps

1. Keep the unconditional permission deny until an explicit, owner-bound per-origin UI and typed permission decisions exist. A website gesture alone must not become a grant. Persist/revoke grants independently of model, download and external-submit approval. [Permission event semantics](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2permissionrequestedeventargs) and [profile persistence](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2permissionrequestedeventargs3) need to be handled together before enabling that UI.
2. If a general-autofill preference is offered, make it an explicit profile-level choice and test disable/re-enable without deleting existing data. Passwords, credit cards, cookies and login-state management remain separate; do not treat this option as clearing or securing them all.
3. Continue to record frame/worker/private-network coverage as unaccepted until separately scoped verification is authorized and completed. This batch neither creates nor runs exploit, DNS-rebinding or target-scanning cases, including the existing broad native probe runners. It makes no blanket isolation claim.

No user data, real credentials, paid/local model interfaces, other-platform application builds or schedules were used. Project priority/history are preserved; only this defensive increment and its actual delivery version are updated. #8 remains open for its broader scope rather than becoming an unsupported release gate for this small default fix.
