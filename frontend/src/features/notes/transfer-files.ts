import { t } from "../../shared/i18n";

export function defaultDownloadFile(fileName: string, content: string, type: string): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error(t("File downloads are not available in this view."));
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function defaultChooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener("focus", onWindowFocus);
      resolve(file);
    };
    const onWindowFocus = () => {
      // Native file dialogs are modal: regaining focus without a change
      // event means the user cancelled the picker.
      setTimeout(() => finish(input.files?.[0] ?? null), 0);
    };
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), {
      once: true,
    });
    window.addEventListener("focus", onWindowFocus);
    document.body.append(input);
    input.click();
  });
}

export function defaultFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const failed = () =>
      reject(new Error(t("Could not read the attachment file. Choose it again and retry.")));
    reader.onerror = failed;
    reader.onabort = failed;
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        failed();
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0 || !reader.result.slice(separator + 1)) {
        failed();
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
