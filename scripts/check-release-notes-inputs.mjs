import { appendFileSync, lstatSync, readFileSync } from "node:fs";
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
  const version = tag.slice(1).split("-")[0];
  const compare = (left, right) => left.localeCompare(right, "en", { numeric: true });
  const baseline = plan.windowsUpgradeFrom;
  if (baseline === undefined) {
    if (process.argv[4] === "true" && compare(version, "0.7.8") >= 0)
      throw Error(`Windows upgrade baseline is required for ${tag}`);
  } else {
    if (typeof baseline?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(baseline.version)
        || compare(baseline.version, version) >= 0 || typeof baseline.sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(baseline.sha256))
      throw Error(`Invalid Windows upgrade baseline for ${tag}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT,
        `windows_baseline_version=${baseline.version}\nwindows_baseline_sha256=${baseline.sha256}\n`);
    }
  }

  for (const file of ["scripts/export-windows-candidate.ps1", "src-tauri/tauri.shell.windows.conf.json"]) {
    const stat = lstatSync(file, {throwIfNoEntry: false});
    if (!stat?.isFile() || stat.size === 0) throw Error(`Missing Windows candidate input: ${file}`);
  }
}
