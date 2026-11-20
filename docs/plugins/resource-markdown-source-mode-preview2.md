# Markdown source preparation, preview 2

Exact requirement: `resource.wasi.markdown.v1 =1.0.0-preview.2`. Plugin 0.1.1
candidate02 is now installed and verified on current Windows; see
[editable-copy acceptance](../iterations/2026-10-30-markdown-editable-copy.md).
The original preview1 contract and its frozen receipts remain valid.

All limits, input snapshot draft2, output draft1, single render capability,
resource permission, result shape and budgets from preview1 remain unchanged.
The input schema is exactly:

```json
{"type":"object","properties":{"sourceMode":{"type":"string","enum":["file","draft"],"default":"file"}},"required":[],"additionalProperties":false}
```

Missing `sourceMode` retains legacy `file` behavior: validate UTF-8, remove one
leading BOM, then render. `draft` validates UTF-8 and preserves every character,
including a leading BOM. This matches native `build_preview(draft)`, which does
not repeat the native file reader's normalization. Invalid/null modes fail
without output resources. MIME and filenames never choose the mode.

The trusted parent owns source-mode selection. The ordinary manual form hides
this managed field; paste/edit mode sends `draft`, confirmed file execution
sends `file`. Legacy preview1 schemas remain supported and do not gain the new
editable-copy workflow. A different profile or merely similar field never enables
the special parent control. Direct resource clients may explicitly request either
documented mode; it changes text normalization, not resource authority.

Loading a file into an editable copy is a separate explicit parent action after
sharing confirmation. It reads only the granted immutable snapshot in 32KiB
chunks, at most 2MiB, validates its full SHA-256, decodes fatal UTF-8, removes one
leading BOM, and rechecks scoped read authority before adopting the copy. It
never reads a path or bypasses Host resources. A nonempty old draft needs an
explicit replace/keep choice. Failure, cancel, new selection, view disposal or
permission loss before adoption preserves the old draft. The copied draft
requires a fresh sharing confirmation before execution. The original file is
never written. Copying/loading does not execute, save, download or call a model.

Double-BOM case: raw `BOM+BOM+# title` becomes draft `BOM+# title`; rendering that
draft must keep the remaining BOM, producing exactly the native file-loaded
preview. A user adding text at the start must likewise keep the native draft's
characters. A 2MiB BOM-prefixed file leaves three bytes of editable headroom,
as in the native reader; adding three bytes back to the copied draft is accepted.

The parent may normalize textarea line endings as part of creating/editing its
text copy; the newly confirmed resource digest covers the actual editable value,
never falsely reuses the original file digest. Unmodified file execution still
retains its exact original bytes. Existing preview1 candidates and their receipts
remain immutable and valid. Signing and other platforms do not block a proven
current-Windows flow, but candidate compilation is not installation acceptance.
