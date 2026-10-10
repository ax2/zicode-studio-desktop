import { t } from "../../shared/i18n";

export function notesImportError(error: Error): Error | null {
  const code = (error as Error & { code?: string }).code;
  if (code === "notes_storage_busy")
    return new Error(t("Another process is using this Notes workspace. Try again shortly."));
  if (code === "import_recovery_required")
    return new Error(
      t(
        "Notes import recovery needs attention. Check folder permissions and free disk space, then retry. Keep the import recovery data.",
      ),
    );
  if (
    code === "invalid_parameters" &&
    /Notes backup (contains duplicate notebook IDs|notebook hierarchy contains a cycle|references a missing parent notebook)/.test(
      error.message,
    )
  )
    return new Error(
      t(
        "The backup notebook hierarchy is invalid. Check duplicate IDs, missing parents and cycles.",
      ),
    );
  if (
    code === "invalid_parameters" &&
    /Notes backup (contains duplicate attachments|trash timestamp is invalid)/.test(error.message)
  )
    return new Error(
      t(
        "The backup has duplicate attachments or an invalid trash timestamp. No notebooks were imported.",
      ),
    );
  if (
    code === "storage_unavailable" &&
    /Notes (import|storage lock|lock file|directory|content|trash timestamp)|imported (notebook|Notes content)/.test(
      error.message,
    )
  )
    return new Error(
      t(
        "Notes import could not finish. Check free disk space and folder permissions before retrying.",
      ),
    );
  return null;
}
