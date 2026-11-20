import { t } from "../../shared/i18n";

export type ImportItem = {
  name: string;
  position: number;
} & (
  | { status: "imported"; duplicateOf?: { id: number; name: string } }
  | { status: "failed" | "unconfirmed" | "notAttempted" }
);

const messages = {
  failed: "Could not import. Check the file and select it again to retry.",
  unconfirmed: "Import could not be confirmed. Check the library before retrying.",
  notAttempted: "Import stopped before this file. Select it again to retry.",
} as const;

export function ImportResults({ items }: { items: ImportItem[] }) {
  const imported = items.filter((item) => item.status === "imported").length;
  const details = items.flatMap((item) => {
    const { name, position } = item;
    if (item.status !== "imported") return [{ name, position, message: t(messages[item.status]) }];
    const candidate = item.duplicateOf;
    if (!candidate) return [];
    const message = t("Same original as {name} (asset #{id}).").replace(
      /\{(name|id)\}/g,
      (_, key) => (key === "name" ? candidate.name : String(candidate.id)),
    );
    return [{ name, position, message }];
  });
  const summary = t("Imported {count} of {total} images.")
    .replace("{count}", String(imported))
    .replace("{total}", String(items.length));
  return (
    <section aria-label={t("Image import results")}>
      <p role="status">{summary}</p>
      {details.length > 0 && (
        <ul>
          {details.map((item) => (
            <li key={item.position}>
              {item.name} · {item.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
