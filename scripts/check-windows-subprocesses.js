#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const rustRoot = join(root, "src-tauri", "src");
const allowed = new Set(["process_command.rs"]);
const violations = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!name.endsWith(".rs") || allowed.has(name)) continue;

    const source = readFileSync(path, "utf8");
    const productionSource = source.split("\n#[cfg(test)]")[0];
    const lines = productionSource.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("Command::new(")) {
        violations.push(`${relative(root, path)}:${index + 1}`);
      }
    });
  }
}

walk(rustRoot);

if (violations.length > 0) {
  console.error("Production subprocesses must use process_command::new_command:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Windows subprocess policy check passed.");

