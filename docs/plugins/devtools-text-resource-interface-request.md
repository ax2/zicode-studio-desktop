# ZiDevTools `text/plain` resource receiver request

Date: 2026-10-16. Owner: ZiDevTools provider for a new candidate; Studio owns Host integration and acceptance. This is an interface request, not a claim that the provider has implemented it.

## Why this is needed

In the real Windows Studio tools-only window, the frozen image resize candidate generated an `image/webp` resource, which was explicitly shared with Studio OCR. OCR generated a 20-byte `text/plain` resource. The new MIME-filtered receiver directory correctly excluded image tools, but showed no text receiver. This proves type filtering while leaving the resource → third-tool execution path unverified. The representative screenshot is in the technical dossier at `screenshots/host-resource-ocr-2026-10-16/text-receiver-empty-windows.jpg`.

## First provider adapter

Adapt the already cataloged `devtools.transforms.url.encode` operation as the first receiving capability for a raw UTF-8 `text/plain` resource. URL encoding accepts the synthetic OCR phrase used in the Windows flow, so success can be checked without treating a business input error as a successful handoff. The standalone ZiDevTools program must remain usable independently; produce this adapter as an independent Studio plugin package with no sibling-repository path, shared mutable config, or ZiDevTools EXE dependency.

- Declare the existing `resource.wasi.input.draft2` input runtime and `requiredProfiles["resource.input.types.v1"] = "=1.0.0-preview.1"`. On the receiving capability, declare `resourceInputMimeTypes: ["text/plain"]` and the exact existing tool ID/version. Do not add image MIME types or wildcards.
- Read only the one explicitly granted resource through the existing bounded Worker input ABI. Reject invalid UTF-8, empty or oversized content with stable business errors. Declare the accepted byte limit and keep it within the Host resource budget; do not infer a local path or read user files directly.
- Preserve the standalone operation's URL encoding behavior and strict input/output schema. The plugin result must include the encoded string and the source byte count; it must not auto-save, call Pi, send network traffic, or auto-chain another tool. A user may separately preview or save through Studio controls.
- Deliver a new versioned candidate directory/container, manifest, module, fixture vectors, file count/length/SHA-256 receipt, and negative cases for wrong MIME, invalid UTF-8, over-limit text, cancellation, permission revocation, and stale transfer grant. Do not mutate the frozen provider candidates already under Studio `tests/fixtures/devtools-*/`.

## Studio acceptance

Studio will first verify the provider receipt and manifest declaration, then use a fresh isolated tools-only profile to discover the candidate by catalog search, lazy-load its input form, and execute OCR `text/plain` → explicit grant → URL encode. Verify exact encoded text from `ZiCode OCR test 2026`, source provenance, visible result, and that no save occurred without a separate approval. Check Host rejection for wrong MIME, stale grant and revoked permission, and that a failed receiver does not remove the OCR result or affect another tool. Retain a Windows screenshot and run equivalent Host conformance on macOS/Linux when those runtimes are available.

This adapter is one coverage step. It does not represent all 154 ZiDevTools tools, complete OCR portability, or a signed release package.
