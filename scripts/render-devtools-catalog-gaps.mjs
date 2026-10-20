// Render a receiver-owned gap ledger from a byte-verified provider revision.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCatalogRevision } from "./verify-devtools-catalog-revision.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaultRevisionId = "devtools-catalog-2026-10-18-3c7c5aa8ad679a14";
const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ").trim();

export function renderGaps(map, verified, revisionId = defaultRevisionId) {
  if (verified.revisionId !== revisionId || verified.sourceToolCount !== map.tools?.length) {
    throw new Error("catalog_revision_mismatch");
  }
  const ids = new Set();
  const rows = map.tools.map((tool) => {
    if (ids.has(tool.sourceToolId) || !tool.uncoveredScope?.trim()) {
      throw new Error("catalog_gap_incomplete");
    }
    ids.add(tool.sourceToolId);
    const scopes = tool.operationScopes ?? [];
    const packages = [
      ...new Set(scopes.map((scope) => `${scope.packageId}@${scope.packageVersion}`)),
    ];
    const candidateWithoutMappedScope = tool.pluginStatus === "candidate" && packages.length === 0;
    const delivery = packages.length
      ? packages.join("、")
      : candidateWithoutMappedScope
        ? "候选标签；本修订无包操作映射"
        : "本修订无候选包映射";
    const next =
      tool.migration === "standalone_incomplete"
        ? "提供方完成独立版对应范围并交付插件候选；Studio 接收验证"
        : tool.migration === "await_host"
          ? "Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收"
          : "提供方交付完整范围的独立包与收据；Studio 验收";
    return `| ${cell(tool.sourceToolId)} / ${cell(tool.title)} | ${cell(tool.sourceVersion)} / ${cell(tool.sourceStatus)} | ${cell(delivery)} | ${cell(tool.uncoveredScope)} | ${cell(next)} |`;
  });
  const mapped = map.tools.filter((tool) => tool.operationScopes?.length).length;
  const orphan = map.tools.filter(
    (tool) => tool.pluginStatus === "candidate" && !tool.operationScopes?.length,
  );
  if (mapped !== verified.candidateToolCount) {
    throw new Error("catalog_candidate_mapping_changed");
  }
  const packageCount = verified.packageCount === 6 ? "六个" : `${verified.packageCount} 个`;
  const orphanSummary = orphan.length
    ? `提供方另将 ${orphan.map((tool) => `\`${tool.sourceToolId}\``).join("、")} 标为 candidate，但本修订没有它的包操作映射。`
    : "本修订所有标为 candidate 的源工具都有包操作映射。";
  return `${[
    "# ZiDevTools 全目录修订逐项接入缺口（2026-10-18）",
    "",
    `来源：Studio 冻结的 [${revisionId}](../../tests/fixtures/${revisionId}/package-map.json)，包外收据已逐文件、目录索引和语义核验。修订 SHA-256：\`${verified.revisionSha256}\`。本页由 \`scripts/render-devtools-catalog-gaps.mjs\` 从冻结字节生成；修改原因应先取得提供方新修订，不能编辑冻结夹具。`,
    "",
    `范围：${verified.sourceToolCount} 个源工具；${packageCount}无签名候选包有具体操作映射的源工具 ${mapped} 个；其余 ${verified.sourceToolCount - mapped} 个在这${verified.packageCount === 6 ? "六" : verified.packageCount}包中无操作映射。${orphanSummary}候选映射、Host 子能力或历史 Windows 样例均不等于完整工具验收；完整接受仍 0/154。`,
    "",
    "下面的原因逐项沿用提供方 `uncoveredScope` 声明，属于待核验的交付范围说明；Studio 的责任与重开条件按迁移类别列出。任何行都不表示永久不可接入。需要正式签名包、收据、完整范围与真实 Host/Worker/Pi/View、权限/取消/错误/结果接力及跨平台验收后，才能更新接受状态。用户决定暂不启用的 JSON 对象插件保持禁用。",
    "",
    "| 源 ID / 工具 | 提供方版本 / 状态 | 本修订候选映射 | 未覆盖范围或阻塞原因 | 责任方 / 重开条件 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")}`;
}

async function main() {
  const mode = process.argv[2];
  const selectedRevision = process.argv.length === 5 && process.argv[3] === "--revision";
  if (
    (mode !== "--write" && mode !== "--check") ||
    (process.argv.length !== 3 && !selectedRevision)
  ) {
    throw new Error(
      "usage: node scripts/render-devtools-catalog-gaps.mjs --write|--check [--revision <revision-id>]",
    );
  }
  const revisionId = selectedRevision ? process.argv[4] : defaultRevisionId;
  if (!/^devtools-catalog-\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/.test(revisionId)) {
    throw new Error("catalog_revision_id_invalid");
  }
  const fixture = resolve(root, "tests/fixtures", revisionId);
  const receiptPath = resolve(root, "tests/fixtures", `${revisionId}-verification.json`);
  const outputPath = resolve(
    root,
    "docs/plugins",
    revisionId === defaultRevisionId
      ? "devtools-catalog-revision-gaps-2026-10-18.md"
      : `devtools-catalog-revision-gaps-${revisionId}.md`,
  );
  const verified = await verifyCatalogRevision(fixture, receiptPath);
  const map = JSON.parse(await readFile(resolve(fixture, "package-map.json"), "utf8"));
  const content = renderGaps(map, verified, revisionId);
  if (mode === "--write") await writeFile(outputPath, content, "utf8");
  else if ((await readFile(outputPath, "utf8")) !== content)
    throw new Error("catalog_gap_document_drift");
  console.log(JSON.stringify({ verified: true, revisionId, rows: map.tools.length, mode }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
