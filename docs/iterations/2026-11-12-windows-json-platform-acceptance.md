# Windows JSON plugin acceptance repair — 2026-11-12

## Failure and scope

Windows-only developer-platform run [43143695367](https://github.com/ax2/zicode-studio-desktop/actions/runs/43143695367) failed the JSON Host/Worker and embedded-Pi acceptance steps before either reached the runtime. Both selected the older `devtools-json-object-candidate06` external receipt. It declares a directory-index digest without the structured encoding needed to reproduce it. The verifier correctly returns `encoding-unverified` and CLI exit 1. Other platform checks passed; Rust formatting was advisory.

Both checks now explicitly select the already-frozen provider `json-object-0.1.1-candidate-03` from `tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/`. The Pi test consumes the same required candidate/receipt environment variables as the Host test instead of silently selecting candidate06. Failure diagnostics include the JSON verification report as well as stderr.

Verified package: 43 files, 371,860 logical bytes; external receipt SHA-256 `757c53ddf8b0e0ef0c4dc2c66d466682fe5920c8bbed7e42d7b0c15c037beb9a`; reproduced directory-index SHA-256 `ea76508d7e0987ae914730bcaeabdf1988570687cc5227be2a30e377635981cc`.

No frozen package, receipt or verifier rule changed. The old receipt remains a negative regression case. Signature verification remains false; these checks prove the named mechanism, not full provider/catalog acceptance.

## Validation

- 43 focused JavaScript tests passed, including real frozen-file verification, shared Host/Pi candidate selection, preserved old encoding failure and rejection of incorrect runtime receipts.
- `bun run check` exited 0; existing warnings remain advisory.
- Both exact ignored real-runtime tests passed. Host/Worker exercised object inspection, a confirmation-required transfer to the receiving capability, and JSON artifact saving. Embedded Pi discovered/loaded/executed the tool, captured its JSON result and rejected use after revocation. Each receipt passed the platform runner's exact identity and evidence gates. The existing Windows Worker SHA-256 was `fc0d49bb5896dc722c137b0afb89d0b457e8bf4c1cb18d1aa1eedd336251feaa`.
- The initial Host run completed functional assertions but failed to write its final evidence to the task workspace with Windows error 5. That failure log remains in `outputs/json-platform-native/`. Using the project-owned `.cache/task-scratch/json-platform-receipts/` resolved receipt output; both runtime tests then completed successfully. This was an evidence-path failure, not an omitted functional assertion.
- Final `bun run check:rust:static` exited 0, including all-target Cargo checks and strict Clippy. Existing unrelated Rust formatting drift remains advisory; the edited JSON test has no format diff.

Task-workspace evidence: `outputs/json-ci-candidate-receipt.json`, `outputs/json-platform-js.log`, `outputs/json-platform-check.log`, `outputs/json-platform-native-passed/`, `outputs/json-platform-rust-static-final.log`, and `outputs/json-platform-storage-after.json`. Runtime tests use temporary isolated data and the existing Windows Worker/Pi; no paid model request, user-data migration or application installer is involved. The final Rust formatting change is whitespace only; no runtime semantics changed after the passing tests.
