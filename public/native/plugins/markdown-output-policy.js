const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
export function markdownOutputPolicy(response, profile, capabilityId) {
  if (profile !== "resource.wasi.markdown.v1") return null;
  const fail = () => { throw new Error("[resource_response_invalid]"); }, result = response.result;
  if (capabilityId !== "devtools.markdown.render" || response.outputProfile !== "resource.wasi.output.draft1" ||
      result?.ok !== true || result.sourceUnchanged !== true || result.mimeType !== "text/html" ||
      !integer(result.inputBytes, 2097152) || !integer(result.utf8Bytes, result.inputBytes) ||
      ![0, 3].includes(result.inputBytes - result.utf8Bytes) || !integer(result.eventCount, 200000) ||
      !integer(result.htmlBytes, 16777216) || result.htmlBytes === 0 || response.resources?.length !== 1) fail();
  return { maxBytes: 16777216, maxRecords: 1, label: () => "HTML document", validate(row) {
    if (row.mimeType !== "text/html" || row.byteLength !== result.htmlBytes) fail();
  } };
}
