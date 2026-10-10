// Daily blog automation sweep: verifies the most recent dated article
// directory in the tech blog has a well-formed index.html (balanced div/p
// tags), every image reference resolves, and the daily automation is still
// scheduled for its next run. Read-only.
//
// Usage:
//   node scripts/qa-blog-output.mjs [blogRoot] [date]
// blogRoot defaults to the user's 技术博客 directory; date defaults to the
// most recent YYYYMMDD article directory found.
// BLOG_WORKFLOW_FILE overrides the automation workflows.json path used for
// the scheduling check (defaults to the agent-inbox workspace).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_BLOG_ROOT = "C:\\Users\\ax2\\Documents\\技术博客";
const DEFAULT_WORKFLOW_FILE = join(
  process.env.LOCALAPPDATA || "",
  "zicode",
  "workspaces",
  "agent-inbox",
  ".zicode",
  "automation",
  "workflows.json",
);

function countTag(html, openTag, closeTag) {
  const open = (html.match(new RegExp(`<${openTag}[ >]`, "g")) ?? []).length;
  const close = (html.match(new RegExp(`</${closeTag}>`, "g")) ?? []).length;
  return { open, close };
}

async function main() {
  const blogRoot = process.argv[2] || process.env.BLOG_ROOT || DEFAULT_BLOG_ROOT;
  const dateArg = process.argv[3];
  if (!existsSync(blogRoot) || !statSync(blogRoot).isDirectory()) {
    console.error(`Blog root not found: ${blogRoot}`);
    process.exit(2);
  }
  const dirs = readdirSync(blogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (dirs.length === 0) {
    console.error("No dated article directories found");
    process.exit(2);
  }
  const target = dateArg ? `${dateArg}-` : dirs[dirs.length - 1];
  const matches = dirs.filter((name) => name.startsWith(target));
  if (matches.length === 0) {
    console.error(`No article directories match "${target}"`);
    process.exit(2);
  }

  const failures = [];
  const reports = [];
  for (const dirName of matches) {
    const dir = join(blogRoot, dirName);
    const htmlPath = join(dir, "index.html");
    if (!existsSync(htmlPath)) {
      failures.push(`${dirName}: index.html missing`);
      continue;
    }
    const sizeKb = Math.round(statSync(htmlPath).size / 1024);
    const html = readFileSync(htmlPath, "utf8");
    const div = countTag(html, "div", "div");
    const p = countTag(html, "p", "p");
    const imgRefs = Array.from(
      html.matchAll(/src="([^"]+)"/g),
      (match) => match[1],
    ).filter((src) => !/^(https?:|data:|blob:)/.test(src));
    const missingImages = imgRefs.filter(
      (src) => !existsSync(join(dir, src)),
    );
    if (sizeKb < 1) failures.push(`${dirName}: index.html too small (${sizeKb}KB)`);
    if (div.open !== div.close) {
      failures.push(`${dirName}: div tags unbalanced (${div.open}/${div.close})`);
    }
    if (p.open !== p.close) {
      failures.push(`${dirName}: p tags unbalanced (${p.open}/${p.close})`);
    }
    if (missingImages.length > 0) {
      failures.push(
        `${dirName}: ${missingImages.length} unresolved image(s): ${missingImages.join(", ")}`,
      );
    }
    reports.push({
      dir: dirName,
      sizeKb,
      divBalanced: div.open === div.close,
      pBalanced: p.open === p.close,
      imageRefs: imgRefs.length,
      unresolvedImages: missingImages.length,
    });
  }

  console.log("BLOG OUTPUT:", JSON.stringify(reports, null, 2));
  if (failures.length > 0) {
    console.error(`BLOG OUTPUT SWEEP FAILED:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `BLOG OUTPUT SWEEP: ${reports.length} article(s) well-formed (HTML balanced, images resolve)`,
    );
  }

  // Scheduling check: the daily blog automation must stay enabled and point
  // at a next run in the near future.
  const workflowFile =
    process.env.BLOG_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;
  let scheduleResult = { skipped: true };
  try {
    if (workflowFile && existsSync(workflowFile)) {
      const workflows = JSON.parse(readFileSync(workflowFile, "utf8"));
      const blogWorkflow = (workflows?.workflows ?? []).find((workflow) =>
        /每日技术博客/.test(workflow?.title ?? ""),
      );
      if (blogWorkflow) {
        const nextRun = new Date(blogWorkflow.nextRunAt ?? 0).getTime();
        const now = Date.now();
        const inFuture = nextRun > now;
        const within48h = nextRun > 0 && nextRun - now < 48 * 60 * 60 * 1000;
        scheduleResult = {
          skipped: false,
          enabled: blogWorkflow.enabled !== false,
          schedule: blogWorkflow.schedule ?? null,
          nextRunAt: blogWorkflow.nextRunAt ?? null,
          inFuture,
          within48h,
        };
        if (
          blogWorkflow.enabled === false ||
          blogWorkflow.schedule !== "daily" ||
          !inFuture ||
          !within48h
        ) {
          failures.push(
            `schedule: daily blog automation not scheduled correctly (${JSON.stringify(scheduleResult)})`,
          );
        }
      } else {
        scheduleResult = { skipped: true, note: "daily blog workflow not found" };
      }
    }
  } catch (error) {
    scheduleResult = { skipped: true, error: String(error) };
  }
  console.log("BLOG SCHEDULE:", JSON.stringify(scheduleResult));

  if (failures.length > 0) {
    console.error(`BLOG OUTPUT SWEEP FAILED:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else if (!scheduleResult.skipped) {
    console.log(
      "BLOG OUTPUT SWEEP: output well-formed and daily automation scheduled correctly",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
