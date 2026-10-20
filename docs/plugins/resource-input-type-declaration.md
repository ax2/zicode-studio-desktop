# Resource input type declaration

Status: Studio implementation landed in the current dirty worktree on 2026-10-16; provider adoption and native UI reacceptance remain pending.

## Evidence

The Windows debug UI completed a synthetic image resize and OCR handoff. The OCR result was `text/plain`, 20 bytes. Its nested “Send to tool” directory listed image receivers because the catalog search did not carry the source MIME type. The frozen image-resize candidate declares `resource.wasi.input.draft2` but no accepted input MIME list. Selecting it displayed image-specific transform fields; it was not run on text.

## Required contract

The Studio contract is `resource.input.types.v1 = 1.0.0-preview.1`; a capability declares `resourceInputMimeTypes`. It:

- Declare a finite list of accepted canonical MIME types on each receiving capability, rather than infer compatibility from a plugin name, UI label, or output type.
- Be included in catalog search results and detail responses, and bind both manifest declarations and the source MIME query into the catalog revision returned to the caller.
- Carry the source MIME type in resource receiver searches so Studio can list only exact matches. Unknown MIME compatibility remains unavailable in the “compatible” result set.
- Be rechecked by Host at transfer preparation, grant commit, and resource Worker execution; a WebView filter alone is not authorization.
- Bind the declaration into the receiver identity proof so changing accepted types invalidates stale transfer grants.
- Keep conversions explicit: a different MIME type is eligible only after a separately declared and user-visible conversion step.

Validation accepts 1–32 unique lowercase ASCII `type/subtype` MIME tokens with no parameters or wildcards. The Host receiver proof already includes the full manifest, so declaration changes invalidate stale grants. Built-in image inspector and OCR declare PNG/JPEG/WebP. The frozen DevTools image candidate has no declaration and therefore is intentionally absent from typed resource transfer results until ZiDevTools supplies an updated package.

## Implemented in Studio

- Profile/version, capability schema, exact canonical validation, and bounds.
- Catalog request/result and typed detail query; query-specific catalog revisions.
- Exact MIME checks at Host transfer preparation/commit and WASI plus built-in resource execution.
- Focused Rust and frontend tests for canonical declarations, exact catalog filtering, MIME-bound details, and MIME forwarding.
- The MIME filter is part of the catalog revision and must be repeated by the detail request.

## Remaining acceptance

- The real Windows Debug app re-ran resize→OCR→nested receiver search: `image/webp` offered OCR and image inspector, while `text/plain` offered no receivers; image tools disappeared. The inspected 1442×931 light-theme screenshot is retained in the technical dossier under `screenshots/host-resource-ocr-2026-10-16/text-receiver-empty-windows.jpg`.
- Add provider declarations and a new independent ZiDevTools candidate. Do not mutate the frozen candidate or DevTools source in the Studio checkout.
- Request a compatible `text/plain` provider receiver for the third-tool native handoff; see [ZiDevTools text resource interface request](devtools-text-resource-interface-request.md).
- Live Host transfer mismatch and changed-declaration grant cases passed in the ignored Host/WASI acceptance test. A typed text receiver, cancellation, failure isolation, and explicit save remain open in the native flow.
- Full cross-platform OCR and the 154-tool integration remain separate open goals.
