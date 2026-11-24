import { t } from "./i18n";

export function downloadFile(fileName: string, content: string, type: string): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error(t("File downloads are not available in this view."));
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
