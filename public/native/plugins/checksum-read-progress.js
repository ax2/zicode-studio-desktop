import { t } from "../../i18n.js";

const profile = "resource.local-directory.checksum-progress.preview1";
const interval = 200;

function readProgress(report, grantId, total) {
  if (report?.schemaVersion !== 1 || report.profile !== profile || report.grantId !== grantId ||
      report.filesTotal !== total || !Number.isInteger(report.filesCompleted) ||
      report.filesCompleted < 0 || report.filesCompleted > total) return null;
  const completed = report.filesCompleted;
  const fractional = completed < total && Number.isSafeInteger(report.fileSize) && report.fileSize > 0 &&
    Number.isSafeInteger(report.fileBytesRead) && report.fileBytesRead > 0 && report.fileBytesRead <= report.fileSize
    ? report.fileBytesRead / report.fileSize : 0;
  return { completed, value: completed + fractional };
}

export function createChecksumReadProgress(container) {
  const root = document.createElement("div");
  root.hidden = true;
  const tools = document.createElement("div");
  tools.className = "ui-toolbar file-digest-manifest-actions";
  const meter = document.createElement("progress"), label = document.createElement("span");
  tools.append(meter, label);
  root.append(tools);
  container.append(root);
  let stopActive = null;

  function start(query, grantId, total, isCurrent) {
    stopActive?.();
    let done = false, timer = null;
    const current = () => !done && isCurrent();
    function stop() {
      done = true;
      clearTimeout(timer);
      if (stopActive === stop) {
        stopActive = null;
        root.hidden = true;
        label.textContent = "";
      }
    }
    async function poll() {
      if (!current()) { stop(); return; }
      try {
        const report = readProgress(await query(), grantId, total);
        if (!current()) { stop(); return; }
        if (report) {
          meter.max = total;
          meter.value = report.value;
          meter.setAttribute("aria-label", t("Checksum file reading progress"));
          label.textContent = t("{completed} of {total} files processed")
            .replace("{completed}", String(report.completed)).replace("{total}", String(total));
          root.hidden = false;
        }
      } catch {
        // An advisory status failure does not change the grant or commit outcome.
      }
      if (current()) timer = setTimeout(poll, interval);
      else stop();
    }
    stopActive = stop;
    void poll();
    return stop;
  }
  return { start, stop() { stopActive?.(); } };
}
