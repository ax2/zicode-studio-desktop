#!/usr/bin/env node
// Detect UI strings that go through t() but have no zh-CN dictionary entry,
// i.e. English that would leak into the Chinese interface. This is the
// inverse of qa-locale (which looks for Chinese leaking into English UI).
//
// Usage:
//   node scripts/check-i18n-coverage.mjs [--max=N]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MAX_REPORT = Number(
  process.argv.find((arg) => arg.startsWith("--max="))?.slice(6) || 60,
);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "target" ||
        entry.name === ".git" ||
        entry.name === "react"
      ) {
        continue;
      }
      walk(full, out);
    } else if (
      /\.(ts|tsx|js)$/.test(entry.name) &&
      !/\.test\./.test(entry.name) &&
      !entry.name.endsWith(".bundle.js") &&
      !entry.name.startsWith("style.")
    ) {
      out.push(full);
    }
  }
  return out;
}

function dictionaryKeys() {
  const source = readFileSync(join(ROOT, "public/i18n.js"), "utf8");
  const keys = new Set();
  const re = /^[ ]*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w-]+):/gm;
  for (const match of source.matchAll(re)) {
    keys.add(unquoteKey(match[1]).trim().replace(/\s+/g, " "));
  }
  return keys;
}

function unquoteKey(key) {
  if (key.startsWith('"')) {
    try {
      return JSON.parse(key);
    } catch {
      return key.slice(1, -1);
    }
  }
  if (key.startsWith("'")) {
    return key.slice(1, -1).replace(/\\(['\\])/g, "$1");
  }
  return key;
}

function tKeys(source) {
  const keys = new Set();
  const re = /\b(?:t|l|i|n|s|a)\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/g;
  for (const match of source.matchAll(re)) {
    try {
      keys.add(JSON.parse(match[1]).trim().replace(/\s+/g, " "));
    } catch {
      // Ignore malformed literals.
    }
  }
  return keys;
}

const dict = dictionaryKeys();
const missing = new Map();
const roots = [
  join(ROOT, "frontend/src"),
  join(ROOT, "public/native"),
  join(ROOT, "public/ui"),
  join(ROOT, "public/components"),
];
for (const file of roots.flatMap((root) => walk(root))) {
  const source = readFileSync(file, "utf8");
  for (const key of tKeys(source)) {
    if (!dict.has(key)) {
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(file.replace(join(ROOT, ""), ""));
    }
  }
}

const sorted = [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`zh-CN dictionary keys: ${dict.size}`);
console.log(`missing keys: ${sorted.length}`);
for (const [key, files] of sorted.slice(0, MAX_REPORT)) {
  console.log(`- ${key}  (${files.slice(0, 2).join(", ")})`);
}
if (sorted.length > MAX_REPORT) {
  console.log(`... and ${sorted.length - MAX_REPORT} more`);
}

// Placeholder entries ("Foo": "Foo") render English even though they have a
// dictionary row, so flag them as untranslated too.
const source = readFileSync(join(ROOT, "public/i18n.js"), "utf8");
const identity = [];
const entryRe = /^[ ]*(("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w-]+))\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,?$/gm;
for (const match of source.matchAll(entryRe)) {
  const key = unquoteKey(match[1]).trim();
  const value = unquoteKey(match[3]).trim();
  if (key === value) identity.push(key);
}
if (identity.length > 0) {
  console.log(`untranslated placeholder entries: ${identity.length}`);
  for (const key of identity.slice(0, MAX_REPORT)) console.log(`- ${key}`);
}
process.exitCode = sorted.length === 0 && identity.length === 0 ? 0 : 1;
