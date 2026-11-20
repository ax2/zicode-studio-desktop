import { jsonReportMarkdown } from "./json-report-markdown.js";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";

const MAX_REPORT_BYTES = 48 * 1024;
const fail = () => {
  throw new Error("image_report_unavailable");
};

// Read the Host-owned report again at handoff time. A displayed result alone
// does not prove that the source permission or the report is still available.
export async function loadImageReportNoteMaterial({ resource, owner, read, isCurrent }) {
  if (
    resource?.origin !== "host-report" ||
    resource.saved !== false ||
    resource.mimeType !== "application/json" ||
    !Number.isSafeInteger(resource.byteLength) ||
    resource.byteLength < 1 ||
    resource.byteLength > MAX_REPORT_BYTES ||
    !/^[0-9a-f]{64}$/.test(resource.contentVersion ?? "") ||
    !["devtools.image.metadata.inspect", "devtools.image.metadata.clean"].includes(
      owner?.capabilityId,
    ) ||
    typeof read !== "function" ||
    typeof isCurrent !== "function" ||
    !isCurrent()
  )
    fail();
  const result = await loadResourcePreview({
    resource,
    read: (offset, length) => read(owner, resource, offset, length, isCurrent),
    isCurrent,
  });
  if (!isCurrent() || result.kind !== "text") fail();
  let report;
  try {
    report = JSON.parse(result.text);
  } catch {
    fail();
  }
  if (
    !report ||
    Array.isArray(report) ||
    report.schemaVersion !== 2 ||
    report.material !== "image-metadata-report" ||
    !isCurrent()
  )
    fail();
  return { title: "Image metadata report", content: jsonReportMarkdown(result.text) };
}
