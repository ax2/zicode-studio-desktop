#!/usr/bin/env node
// Regression for the Documents import pipeline: builds a minimal DOCX in
// memory, uploads it through the real /v2/documents/import endpoint, and
// asserts the extracted Markdown contains the expected heading/paragraphs.
//
// Usage (app must be running on localhost):
//   node scripts/qa-docx-import.mjs <workspaceId>
import { strToU8, zipSync } from "fflate";

const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const workspaceId = process.argv[2] || process.env.ZICODE_WORKSPACE;
if (!workspaceId) {
  throw new Error("Usage: node scripts/qa-docx-import.mjs <workspaceId>");
}

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>QA 导入测试标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>这是第一段正文内容。</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段：包含额外内容。</w:t></w:r></w:p>
  </w:body>
</w:document>`;

async function main() {
  const docx = zipSync({
    "word/document.xml": strToU8(XML),
  });
  const dataUrl =
    "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64," +
    Buffer.from(docx).toString("base64");

  const response = await fetch(`${HOST}/v2/documents/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      sceneId: "programming",
      document: dataUrl,
      fileName: "qa-test.docx",
    }),
  });
  const body = await response.json();
  const pass =
    response.ok === true &&
    body.ok === true &&
    body.kind === "docx" &&
    body.markdown.includes("QA 导入测试标题") &&
    body.markdown.includes("这是第一段正文内容") &&
    body.title === "QA 导入测试标题";
  console.log(
    JSON.stringify(
      {
        status: response.status,
        kind: body.kind,
        title: body.title,
        markdown: body.markdown,
        pass,
      },
      null,
      2,
    ),
  );
  process.exitCode = pass ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
