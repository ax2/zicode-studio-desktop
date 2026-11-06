# Host-derived image metadata report resource, draft1

Profile `resource.host.image-metadata-report.draft1` extends the trusted parent
response to a successful `resource.wasi.image.metadata.v1` execution. The Host
first validates the complete existing schema2 Worker report and its image
outputs. It serializes the report object itself as UTF-8 JSON, at most 48 KiB,
and admits it atomically with the image outputs. It is not an additional guest
output type, a new WASI MIME index, a filesystem permission, or an automatic
save. The frozen provider package and its image output cardinality are unchanged.

The optional `reportResource` is separate from the existing `resources` array:
`{profile,index:0,resourceId,contentVersion,mimeType:"application/json",
byteLength,expiresInSeconds,origin:"host-report",saved:false,derivedFrom}`.
Its bytes parse to exactly the validated `result.report`; contentVersion is
SHA-256 of the complete serialized bytes. It has the same owner as the input,
and its lineage retains every confirmed source. Revoking the input, changing
the plugin's permission/revision, stopping the runtime, or resource expiry
invalidates access. The resource consumes the ordinary Draft1 reservation and
the shared total budget; no existing image or legacy budget is increased. If
there is insufficient room for the extra report, the Host omits that optional
resource and retains the original image result. Invalid/failed Worker results
produce no report resource. Cancellation publishes neither report nor image.

The parent may expose an explicit **Save report** action, using the existing
project save or native `resource.export.file.draft1` confirmation and
no-overwrite flow. The user chooses whether and where to save; the plugin never
gets a destination path. Older Hosts omit the optional field and retain the
existing selectable report. Unknown profiles, oversized references, mismatched
source IDs, duplicate output IDs or MIME types are rejected by the parent.
This draft does not provide automatic memo creation, image-instance handoff,
or a claim of acceptance until actual Windows Host/Worker/UI tests pass.
