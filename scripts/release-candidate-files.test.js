// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBundles, stageBundles } from "./release-candidate-files.mjs";

const roots=[];
const config={tag:"v0.6.7-rc.1",version:"0.6.7-20001",sha:"a".repeat(40),platform:"windows"};
const name="ZiCode.Studio.Desktop_0.6.7-20001_x64-setup.exe";
afterEach(async()=>{for(const dir of roots.splice(0)) await rm(dir,{recursive:true,force:true});});
async function setup(){
  const dir=await mkdtemp(join(tmpdir(),"studio-receipt-")); roots.push(dir);
  const input=join(dir,"input"), part=join(input,"verified-bundles-windows-x64");
  await mkdir(input);const file=join(dir,name.replaceAll("ZiCode.Studio.Desktop","ZiCode Studio Desktop"));
  await writeFile(file,Buffer.from([1,2,3,255]));
  await stageBundles([file],part,{...config,target:"windows-x64"});
  return {part,collect:(opts={})=>collectBundles(input,join(dir,"output"),{...config,...opts})};
}
it("preserves exact candidate bytes and accepts a tagged release with its encoded bundle version",async()=>{
  const {part,collect}=await setup();
  const [asset]=await collect();expect(asset.name).toBe(name);expect(asset.size).toBe(4);
  expect(await readFile(join(part,name))).toEqual(Buffer.from([1,2,3,255]));
});
it.each(["same-size tampering","extra attachment","wrong frozen commit","wrong version","missing platform","path traversal"])("rejects %s",async(problem)=>{
  const {part,collect}=await setup(),opts={};
  if(problem==="same-size tampering") await writeFile(join(part,name),Buffer.from([1,2,4,255]));
  if(problem==="extra attachment") await writeFile(join(part,"extra.zip"),"unreviewed");
  if(problem==="wrong frozen commit") opts.sha="b".repeat(40);
  if(problem==="wrong version") opts.version="0.6.8";
  if(problem==="missing platform") opts.platform="all";
  if(problem==="path traversal"){
    const path=join(part,"receipt.json"),receipt=JSON.parse(await readFile(path));
    receipt.entries[0].name="../"+name;await writeFile(path,JSON.stringify(receipt));
  }
  await expect(collect(opts)).rejects.toThrow();
});
