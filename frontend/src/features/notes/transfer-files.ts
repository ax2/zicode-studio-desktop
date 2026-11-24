import { t } from "../../shared/i18n";

export { downloadFile as defaultDownloadFile } from "../../shared/download-file";

export async function defaultChooseFile(accept: string): Promise<File | null> {
  return (await openNotesPicker(accept, false))[0] ?? null;
}

export function defaultChooseFolder(): Promise<File[]> {
  return openNotesPicker("", true);
}

function openNotesPicker(accept: string, directory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (directory) input.setAttribute("webkitdirectory", "");
    input.hidden = true;
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener("focus", onWindowFocus);
      resolve(files);
    };
    const selected = () => Array.from(input.files ?? []);
    const onWindowFocus = () => {
      // Native file dialogs are modal. Let the file change event finish first.
      setTimeout(() => finish(selected()), 0);
    };
    input.addEventListener("cancel", () => finish([]), { once: true });
    input.addEventListener("change", () => finish(selected()), { once: true });
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
