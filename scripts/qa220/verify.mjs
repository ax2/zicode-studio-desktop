import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const {Q220_EXE: exe, Q220_PROFILE: profile, Q220_TRIGGER: trigger} = process.env;
const data=path.join(profile,"data");
const app=spawn(exe,["--isolated-profile",profile,"--tools-only"],{
  cwd:path.dirname(exe),stdio:"ignore",windowsHide:true,
  env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=0 --remote-debugging-address=127.0.0.1"},
});
async function until(label, read, limit=90000) {
  const end=Date.now()+limit;
  let last;
  do {try {const value=await read();if(value)return value;} catch(error){last=error;} await sleep(250);} while(Date.now()<end);
  throw Error(label+" timed out: "+(last?.message??""));
}
const browser=await until("owned WebView2",async()=>{
  const dir=path.join(data,"webview");
  const match=(await readdir(dir,{recursive:true})).find(file=>path.basename(file)==="DevToolsActivePort");
  if (!match) return;
  const [port,ws]=(await readFile(path.join(dir,match),"utf8")).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port)||!ws?.startsWith("/devtools/browser/")) return;
  return chromium.connectOverCDP("ws://127.0.0.1:"+port+ws,{noDefaults:true,timeout:4000});
});
const ui=await until("workspace",()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes("/app/workspaces/")));
ui.setDefaultTimeout(30000);
await ui.waitForFunction(()=>!!window.__picotNative);
await ui.reload({waitUntil:"domcontentloaded"});
const action=ui.locator(".native-notification").filter({hasText:"0.7.0"}).locator(".native-notification-action");
await action.click({timeout:90000});
const status=ui.locator("#setting-update-status"), mode=ui.locator("#desktop-update-mode");
assert.match(await status.innerText(),/0\.7\.0/);
const notes=ui.locator("[data-settings-panel=updates] details");
await notes.locator("summary").click();
assert.ok(await notes.locator("h1,h2,h3").count());
assert.ok(await notes.locator("a[href^='https://']").count());
assert.equal(await notes.locator("img,iframe,script").count(),0);
assert.equal(await mode.inputValue(),"notify");
await mode.selectOption("manual");
const pref=path.join(data,"desktop-update-mode.json");
await until("saved manual preference",async()=>JSON.parse(await readFile(pref,"utf8"))==="manual");
await ui.reload({waitUntil:"domcontentloaded"});
await ui.waitForFunction(()=>!!window.__picotNative);
await ui.locator('[data-plugin-id="core.commands"]').click();
const zh=await ui.evaluate(()=>document.documentElement.lang.startsWith("zh"));
await ui.locator("#command-palette [role=combobox]").fill(zh?"设置":"Settings");
await ui.locator("#command-palette [role=option]").filter({has:ui.locator(".command-label",{hasText:zh?/^设置$/:/^Settings$/})}).first().click();
await ui.locator('[data-settings-tab="updates"]').click();
assert.equal(await mode.inputValue(),"manual");
await mode.selectOption("download");
await until("verified public installer",async()=>/Install and exit|安装并退出/.test(await ui.locator("#btn-check-updates").innerText()),420000);
const dir=path.join(data,"desktop-updates");
const staged=(await readdir(dir)).find(f=>/^candidate-.*\.exe$/.test(f));
assert.ok(staged);
const sha=createHash("sha256");for await (const chunk of createReadStream(path.join(dir,staged))) sha.update(chunk);
assert.equal(sha.digest("hex"),"abaf829686980ac954fcc7a34a4fdb88ba1e3dd0d4f9038b0d8befcd777c8606");
assert.equal(app.exitCode,null);
console.log("PASS actual default reminder, Markdown links/headings, persisted setting and automatic verified v0.7.0 download while Studio runs");
for(const choice of ["cancel","confirm"]) {
  await writeFile(trigger,"quit");
  execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","dialog.ps1","-AppPid",String(app.pid),"-Choice",choice],{stdio:"inherit",windowsHide:true});
  if(choice==="cancel"){assert.equal(app.exitCode,null);assert.ok((await readdir(dir)).includes(staged));}
}
await until("actual successful install",async()=>{
  const result=JSON.parse((await readFile(path.join(dir,"result.json"),"utf8")).replace(/^\uFEFF/,""));
  assert.equal(result.version,"0.7.0");return result.status==="installed";
},300000);
await until("staged file removed",async()=>!(await readdir(dir)).includes(staged));
assert.equal(JSON.parse(await readFile(pref,"utf8")),"download");
await sleep(2500);
const running=execFileSync("powershell.exe",["-NoProfile","-Command","@(Get-Process zicode-studio-desktop -ErrorAction SilentlyContinue).Count"],{encoding:"utf8",windowsHide:true}).trim();
assert.equal(running,"0");
console.log("PASS confirmed quit ran genuine NSIS, wrote installed receipt, preserved profile preference, and left Studio closed");
process.exit(0);
