# Browser reviewed analysis → Artifacts (#16, v0.6.6)

## Delivered sub-scope

The browser model answer previously lived only in its preview. A completed summary or analysis now has an explicit **Save analysis to Artifacts** action. Saving reuses the existing ArtifactGateway, Host authorization and ArtifactStore; it neither reads the page again nor invokes a model. Opening a preview, receiving a result, and selecting a model do not save automatically. A successful save offers **Open saved artifact**, using the existing scene/workspace-scoped navigation. Storage failure leaves the reviewed answer intact for retry. Successful results are deduplicated within that preview.

The report preserves the exact answer as `text/plain`, making website/model HTML inert when reopened. Its readable content includes source title/URL and capture/generation times. Provenance also preserves the native document revision, summary/analysis intent, original question and model provider/model ID, with explicit untrusted-web/model trust labels. No source body, local project root, credentials or custom endpoint is added. The display title obeys the existing 200-character Host limit without splitting emoji; full source title remains in provenance. Existing Artifacts storage enablement/permission checks are authoritative. No new Host/Tauri API, credential route or model provider was introduced.

## Automated evidence (Windows)

- 21 relevant JS/React checks passed across the two changed browser suites, existing browser assistant/navigation suites and the new Artifact React reopening case. They cover no automatic save, exact original intent/content, retry, concurrent/repeated-save prevention, destination/disposal guards, scoped open, unsafe source rejection, Unicode title limits, and inert answer display. These use synthetic existing model output and do not establish actual model generation.
- `tests/fixtures/browser-analysis-artifact.json` is a shared synthetic contract: the JS builder must equal it exactly; the native test posts that same JSON through the existing HTTP API.
- Real `HostServer` test `browser_analysis_artifact_survives_host_restart_with_provenance_and_workspace_scope`: **1 passed**, 0 failed/ignored, two harness threads. Create → stop Host → restart → list/get preserves the complete document, source and version. Another workspace gets 404; disabling Artifacts gets 403. It runs on a unique owned `.cache/task-scratch` directory and removes it on success, with no Pi session/model request, browser window or personal data.
- Required all-target `cargo check` and strict Clippy passed using the existing toolchain/cache/shared target after coordination with #23. No complete application build was performed. Formatting drift remains the repository's advisory baseline; the new Rust test was formatted.
- `bun run check` exited 0 (235 existing warnings/29 infos; own file checks have no warnings), frontend typecheck passed, i18n coverage has 0 missing keys, and diff whitespace checks passed.

Development failures remain in the local receipts: the first command script had unsuitable Windows line endings and did not run the checks; clean worktree generated-resource directories were initially absent; the new test needed an explicit filesystem Path import and the existing self-consuming stop API. Those preconditions/test-only errors were corrected before the final pass. Production Rust behavior was not changed.

## Remaining scope

This completes only the explicitly saved, already-generated browser summary/analysis → Artifacts → reopen path. The rest of #16 remains open: complex/frame capture, separately authorized image/OCR, and any broader knowledge integration not covered by these receipts. This is source/automated acceptance, not a claim that a newly packaged Windows application is installed; release packaging is coordinated by #98. No separate native desktop operation is required by this batch, and no paid model or external page request was made for verification.
