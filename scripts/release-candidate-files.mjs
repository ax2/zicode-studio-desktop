import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseBuildMatrix } from "./release-build-matrix.mjs";
import { validateReleaseBundleName } from "./release-artifact-policy.mjs";
import { verifyReleaseInventory } from "./verify-release-inventory.mjs";

async function inspect(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size === 0) throw Error("Expected nonempty regular installer");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { size: stat.size, digest: "sha256:" + hash.digest("hex") };
}

export async function stageBundles(files, dest, {tag, sha, target}) {
  await mkdir(dest);
  const entries = [];
  for (const file of files) {
    const name = basename(file).replaceAll(" ", ".");
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)) throw Error("Unsafe installer name");
    await copyFile(file, join(dest, name));
    entries.push({name, ...await inspect(join(dest, name))});
  }
  await writeFile(join(dest, "receipt.json"), JSON.stringify({tag,sha,target,entries}));
}

export async function collectBundles(root, dest, {tag, sha, version, platform}) {
  if (!/^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(tag) || !/^\d+\.\d+\.\d+([.-][\w.-]+)?$/.test(version) || !/^[a-f\d]{40}$/.test(sha)) throw Error("Invalid frozen release identity");
  const expected = releaseBuildMatrix(platform).include;
  const targets = await readdir(root);
  if (targets.length !== expected.length) throw Error("Unexpected platform artifact count");
  await mkdir(dest);
  const all = [];
  for (const {pi_target:target,bundles} of expected) {
    const dir = join(root, "verified-bundles-"+target);
    if (!(await lstat(dir)).isDirectory()) throw Error("Invalid platform folder");
    const manifest = join(dir,"receipt.json");
    if (!(await lstat(manifest)).isFile()) throw Error("Invalid platform receipt");
    const receipt = JSON.parse(await readFile(manifest,"utf8"));
    const types = bundles.split(",");
    if (receipt.tag!==tag || receipt.sha!==sha || receipt.target!==target || receipt.entries?.length!==types.length ||
        (await readdir(dir)).length!==types.length+1) throw Error("Wrong platform receipt or inventory");
    for (const [index,entry] of receipt.entries.entries()) {
      if (typeof entry.name!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.name) || !entry.name.includes("_"+version+"_") ||
          all.some(previous=>previous.name===entry.name)) throw Error("Unexpected or duplicate bundle name");
      validateReleaseBundleName(target,types[index],entry.name);
      const src=join(dir,entry.name), actual=await inspect(src);
      if (actual.size!==entry.size || actual.digest!==entry.digest) throw Error("Bundle differs from build receipt");
      await copyFile(src,join(dest,entry.name));
      all.push({name:entry.name,...actual});
    }
  }
  if(platform!=="macos-intel") verifyReleaseInventory(all,{tag,platform});
  return all;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [root,dest]=process.argv.slice(2);
  const files=await collectBundles(root,dest,{tag:process.env.RELEASE_TAG,sha:process.env.RELEASE_SHA,version:process.env.APP_VERSION,platform:process.env.RELEASE_PLATFORM});
  console.log(JSON.stringify(files,null,2));
}
