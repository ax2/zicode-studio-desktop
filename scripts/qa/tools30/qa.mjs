import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_WORKFLOW,'Windows tool entry acceptance');
const exec=promisify(execFile),profile=path.join(process.env.RUNNER_TEMP,'q30-profile');
const plugin='com.zicode.devtools.text';
const encode=JSON.stringify([plugin,'devtools.text.base64.encode']),decode=JSON.stringify([plugin,'devtools.text.base64.decode']);
const access=id=>'manual.tool:'+createHash('sha256').update(id).digest('hex');
const opened=id=>"[data-open-tool-id='"+id+"']";
let app,b,ui,hwnd;
const report=(text,obj='')=>console.log('PASS',text,JSON.stringify(obj));
async function wait(label,read,ms=50000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const v=await read();if(v)return v;}catch(e){last=e;}await sleep(150);}throw Error(label+': '+(last?.message||'timed out'));}
async function native(action){return (await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.resolve('native.ps1'),action,String(hwnd)],{timeout:60000})).stdout.trim();}
try{
  await mkdir(profile);await writeFile(path.join(profile,'profile.json'),'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}\n');
  app=spawn(process.env.STUDIO_Q35_EXE,['--tools-only','--isolated-profile',profile],{cwd:path.dirname(process.env.STUDIO_Q35_EXE),env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
  const folder=path.join(profile,'data','webview');
  const endpoint=await wait('DevTools port',async()=>{const f=(await readdir(folder,{recursive:true})).find(p=>path.basename(p)==='DevToolsActivePort');if(!f)return; const [port,ws]=String(await readFile(path.join(folder,f))).trim().split(/\r?\n/);if(ws)return 'ws://127.0.0.1:'+port+ws;});
  b=await chromium.connectOverCDP(endpoint,{noDefaults:true});
  ui=await wait('desktop workspace',()=>b.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/app/workspaces/')));
  ui.setDefaultTimeout(16000);await ui.waitForFunction(()=>!!window.__picotNative,{},{timeout:65000});
  hwnd=Number((await exec('powershell.exe',['-NoProfile','-Command','(Get-Process -Id '+app.pid+').MainWindowHandle.ToInt64()'])).stdout.trim());assert.ok(hwnd);
  const pending=ui.evaluate(()=>window.__TAURI__.core.invoke('select_developer_plugin_package'));
  pending.catch(()=>{});
  console.log(await native('choose'));
  const preview=await Promise.race([pending,sleep(20000).then(()=>{throw Error('Real folder picker did not return selected fixture')})]);
  assert.equal(preview.pluginId,plugin);
  await ui.evaluate(async({preview,plugin})=>{
    await window.__TAURI__.core.invoke('install_previewed_developer_plugin',{sourcePath:preview.sourcePath,contentSha256:preview.contentSha256});
    const {PluginHostGateway}=await import('/native/plugins/plugin-host-gateway.js');
    await new PluginHostGateway({fetchImpl:window.__zicodeHostFetch,location:window.location}).setEnabled('programming',plugin,true);
  },{preview,plugin});
  await ui.reload();await ui.waitForFunction(()=>!!window.__picotNative,{},{timeout:65000});
  report('real development package preview, installation and activation',plugin);
  const favorite=async(id,pin=false)=>{
    const menu=ui.locator('.quick-tools-menu summary:visible').first();await menu.click();
    const field=ui.locator('.tool-launcher-search');await field.fill('Base64');
    const open=ui.locator('[data-tool-launcher-open="'+access(id)+'"]');
    await open.waitFor();
    if(pin){const star=open.locator('..').locator('button[aria-pressed]');if(await star.getAttribute('aria-pressed')!=='true')await star.click();}
    const title=await open.locator('strong').count()?await open.locator('strong').innerText():await open.getAttribute('title');
    await open.click();return title;
  };
  const active=id=>ui.locator(opened(id)+'[aria-pressed=true]');
  const close=async id=>{const tab=active(id);await tab.waitFor();await tab.locator('..').hover();await tab.locator('..').locator('.tool-tab-close').click();await ui.locator('dialog[open] .ui-button--danger').click();};
  await favorite(decode);await active(decode).waitFor();
  await favorite(encode,true);await active(encode).waitFor();
  assert.equal(await ui.locator(opened(encode)).count(),1);
  report('main window opens the exact selected package and Base64 encoder while preserving its decoder tab',encode);
  await close(encode);await active(decode).waitFor();assert.equal(await ui.locator(opened(encode)).count(),0);
  await close(decode);await active('').waitFor();report('closing the active tool returns to the still-open decoder, then the directory when no tools remain');
  const menu=await native('quick');
  await active(encode).waitFor();assert.equal(await ui.locator(opened(encode)).count(),1);
  report('Explorer tray Quick tools opens exactly the same pinned encoder and no duplicate tab',{id:encode,menu});
  await close(encode);await active('').waitFor();report('closing the tray-origin tool returns to the directory');
}catch(e){console.error('Actual failed step',e.message);if(ui&&!ui.isClosed())console.error('UI diagnostic',String(await ui.locator('body').innerText()).slice(-2300),await ui.locator('[data-open-tool-id]').evaluateAll(a=>a.map(i=>[i.getAttribute('data-open-tool-id'),i.getAttribute('aria-pressed')])));throw e;}
finally{await b?.close().catch(()=>{});app?.kill();}
