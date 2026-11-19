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
