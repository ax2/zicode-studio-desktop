# Parent-owned native file export, draft1

Profile `resource.export.file.draft1`, schemaVersion1. This is a Studio parent
workflow, not a plugin filesystem API. Existing plugin outputs and resource
budgets are unchanged. No new provider package or manifest permission is needed.
Only trusted workspace windows may call the native commands below; HTTP clients,
workers and plugin frames are not given a destination-path operation.

1. `select_resource_export({workspaceId, source})` opens the native Save dialog.
   `source` is an existing confirmed derived-output Access with exact owner,
   resourceId and contentVersion. The Host revalidates the live runtime, matching
   workspace, plugin revision/permission and delegated ancestors before the picker
   and after it. Native cancellation returns null and writes nothing. A selected
   new local file produces a 60-second, bounded, window/route/source-bound grant.
   Selection never writes or executes a tool. Existing/reparse/ambiguous paths are
   rejected; nothing is overwritten, even if the native dialog offered replace.
2. The parent shows `preview.destination`, byteLength and MIME before offering
   separate confirmation. The result has schemaVersion1, profile, grantId,
   expiresInSeconds60, requiresConfirmation:true, saved:false,
   operation:create_new_file, and preview `{schemaVersion,profile,grantId,
   destination,mimeType,byteLength,contentVersion,source}`. Only the trusted parent
   sees the destination. It never forwards it to a plugin or writes it into inputs.
3. `commit_resource_export({workspaceId,source,grantId,confirmed:true})` writes
   exact existing immutable chunks to a new same-directory pending file, flushes
   and checks complete SHA-256/length, then revalidates resource and ancestor
   authority immediately before publication. Windows locks directory ancestry
   during writing and renames the opened pending file by handle without replace;
   the selected parent must still have the prepared identity. No truncation,
   Base64 re-encoding, arbitrary caller path, shell delegation or overwrite is
   allowed. Success is `{schemaVersion:1,profile,status:"saved",saved:true,
   receipt:preview}`. A second commit is rejected, never repeated.
4. `cancel_resource_export({workspaceId,source,grantId})` discards an uncommitted
   choice. Parent cancellation/disposal before commit never writes. An explicitly
   confirmed commit is not undone by closing/navigating; approved files remain.
5. After an ambiguous response, `verify_resource_export` with the same arguments
   performs only a full size/SHA read, returning status:"verified" and the exact
   saved receipt. This never retries writing or repairs a user-edited destination.
   Saved receipts are bounded in memory for15 minutes; they are not a permanent
   output library, and the external file persists beyond them. Restart clears
   grants and never removes an approved external file.

Errors carry stable codes in native command rejections: resource_confirmation_required,
resource_export_conflict, resource_export_path_invalid, resource_export_directory_unavailable,
resource_export_destination_changed, resource_export_window_changed,
resource_export_grant_invalid, resource_export_requires_output,
resource_export_already_saved, resource_export_not_verified,
resource_export_write_failed, resource_export_busy, plus existing resource authority
errors. Failures never authorize automatic retry. A process interruption after
confirmed writing may leave an owned `.zicode-export-<uuid>.pending` file; it does
not replace existing user data. This draft does not claim crash cleanup/recovery,
network volumes or other-platform acceptance. Windows actual acceptance is tracked
separately; source compilation alone is not delivery.
