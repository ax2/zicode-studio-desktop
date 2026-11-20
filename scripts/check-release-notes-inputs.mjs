import { lstatSync, readFileSync } from "node:fs";
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) throw Error("Invalid release tag");
function required(suffix) {
  const name = `docs/releases/${tag}.${suffix}`;
  if (!lstatSync(name, { throwIfNoEntry: false })?.isFile())
    throw Error(`Missing release input: ${name}`);
  const content = readFileSync(name, "utf8");
  if (!content.trim()) throw Error(`Empty release input: ${name}`);
  return content;
}
required("md");
const plan = JSON.parse(required("issues.json"));
if (!Array.isArray(plan.milestones) || !plan.milestones.includes(tag))
  throw Error(`Release issue snapshot does not include ${tag}`);

for (const field of ["extraCompleted", "known"]) {
  if (!Array.isArray(plan[field]) || !plan[field].every(id => Number.isSafeInteger(id) && id > 0))
    throw Error(`Invalid issue numbers in ${field}`);
}
for (const [field, entries] of [["exclude", plan.exclude], ["knownNotes", plan.knownNotes ?? {}]]) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw Error(`Invalid issue mapping in ${field}`);
  for (const [number, text] of Object.entries(entries)) {
    if (!/^[1-9]\d*$/.test(number) || typeof text !== "string" || !text.trim())
      throw Error(`Invalid issue entry in ${field}: ${number}`);
  }
}

if (["windows", "all"].includes(process.argv[3])) {
  for (const file of ["scripts/export-windows-candidate.ps1", "src-tauri/tauri.shell.windows.conf.json"]) {
    const stat = lstatSync(file, {throwIfNoEntry: false});
    if (!stat?.isFile() || stat.size === 0) throw Error(`Missing Windows candidate input: ${file}`);
  }
}
