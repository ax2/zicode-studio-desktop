# Image metadata resource candidate, preview 1

The two operations passed current Windows Host/Worker and WebView acceptance on 2026-10-29; see [scope and evidence](../iterations/2026-10-29-windows-devtools-image-metadata.md). A declaration or compiled module alone is not acceptance. These explicit profiles do not change the old input, output, resize, regex or ordinary compute budgets. Native instance relay and report workflows remain separate unfinished scope.

Required exact preview versions:

- `resource.wasi.image.metadata.v1 =1.0.0-preview.1`
- `resource.wasi.output.draft2 =1.0.0-preview.1`
- `resource.save.image-metadata.v1 =1.0.0-preview.1` for durable parent-managed copies
- Existing `output.schema.v1 =1.0.0-rc.1`, resource input/output types and tool directory preview 1.

The schema-2 WASI manifest declares exactly `devtools.image.metadata.inspect` and `.clean`, both using the metadata execution profile and an output schema. It requests `resource.read`, has no commands, and accepts precisely PNG/JPEG/WebP. Exactly one input uses the existing omitted multi-input fields, not `resourceInputMax:1`. Runtime input remains `resource.wasi.input.draft2` with a 2 MiB module snapshot and a 32 MiB total source byte ceiling.

The guest uses the existing `zicode_resource_input_draft1` read imports and a separate `zicode_resource_output_draft2` create/write/finish namespace. Only image MIME indices 1, 2 and 3 are accepted. Each write remains 1–65536 bytes; the existing 4096 output-call ceiling remains. Output buffers are append-only and must all be sealed. Neither namespace grants filesystem, network or save access.

Draft-2 output frame magic is `ZIWO 00 00 00 02`, followed by little-endian u32 header length, schema-2 JSON header (`profile:resource.wasi.output.draft2`, result, ordered descriptors), then exact raw blobs. Header and digest checks remain the old 1 MiB+4096 ceiling, contiguous indices, exact lengths and SHA-256. Legacy frame magic/schema/profile continue to be version 1 and 32 MiB. Cross-version decoding, downgrade, or output-v2 without metadata execution negotiation is rejected.

Metadata outputs allow at most two image records, 128 MiB per full cleaned image, 2 MiB per PNG thumbnail and 130 MiB total. Inspect returns one orientation thumbnail. Clean returns the source-format cleaned image at index 0 and its orientation thumbnail at index 1. `previewIndex` and operation/resource count must match. Full display dimensions remain within 12000 per edge, 16000000 pixels and a 192 MiB decoded allocation ceiling; thumbnails are at most 640×640. Animation is rejected, orientation is applied, and cleaned output is decoded and metadata-scanned again. JPEG quality remains 35–95, default 85. Full images are never silently replaced by thumbnails.

The bounded result carries report schema 2: source byte count/display dimensions and metadata categories, optional exact cleaned byte count and recheck, source tool/program versions, UTC timestamp, and anonymous OS/architecture/build fingerprint. It contains no paths, coordinates or original EXIF/XMP/text values. The fingerprint uses the native provenance algorithm with domain `ZiDevTools runtime environment v1` and NUL-separated appVersion/OS/architecture/build fields. Reports state the color/quality caveat and the limit of recognizing unknown private metadata. Host validates the fixed result structure and counts, image headers, role dimensions and provenance. Runtime diagnostics are replaced by a fixed public failure message.

The new execution budget is 640 MiB guest memory, 30000000000 fuel and a 30 second Worker deadline, verified against the recorded actual Worker vectors including a 16 million pixel PNG producing a 48,007,728 byte complete copy. A call takes both existing 512 MiB reservation permits from the unchanged 1024 MiB heavy-call pool, with one call per plugin. Old budgets are unchanged. The resource store keeps a 128 MiB legacy reservation ceiling and a 256 MiB combined ceiling including explicit metadata outputs; ordinary inputs remain at most 32 MiB. Revoking/expiring ancestors removes their derived records. Publication rechecks identity, permissions, cancellation and all ancestors before atomic admission.

Parent preview remains at most 8 MiB for ordinary images. The thumbnail provides an available preview for large cleaned copies. Full copies require a separate explicit save confirmation. Save transport and no-overwrite semantics remain; typed receipts use schema 1 with `profile:resource.save.image-metadata.v1`, image MIME only and at most 128 MiB. Legacy `resource.save.draft1` receipts remain at most 32 MiB. Library listing/reads, verification and download dispatch on the exact receipt profile and image MIME; all existing workspace/receipt/digest, quota and path checks remain. No automatic file read from a source path, save, overwrite, transfer or re-execution is added.

Current scope must be stated from actual conformance evidence. Native GUI workspace-instance relay, saved report workflows or other source subranges are not implicitly accepted merely because the two resource operations pass. Signing and other platforms do not block current Windows acceptance.

