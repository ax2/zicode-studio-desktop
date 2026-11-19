import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_WORKFLOW,'Isolated Windows shell acceptance');
const exec=promisify(execFile),profile=path.join(process.env.RUNNER_TEMP,'shell35-profile');
const site='http://shell35.example.org:37035/native-paint';
const proxy=createServer((req,res)=>{
  if(req.url!=='/native-paint'){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end('<!doctype html><html style="height:100%;background:linear-gradient(to right,#267ea8 50%,#ce672a 50%)"><title>Native page pixels</title><body><label>Unsaved synthetic form <input id="value"></label></body></html>');
});
proxy.on('connect',(_,s)=>s.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
let app,browser,nativeBrowser,hwnd;
const checks=[],record=(message,data='')=>{checks.push(message);console.log('PASS',message,JSON.stringify(data));};
async function wait(label,read,timeout=45000){
  let last;const end=Date.now()+timeout;while(Date.now()<end){try{const v=await read();if(v)return v;}catch(e){last=e;}await sleep(220);}
  throw Error(label+': '+String(last||'timed out'));
}
async function native(action,...args){
  const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.resolve('native.ps1'),action,String(hwnd),...args.map(String)],{timeout:35000});
  return JSON.parse(stdout.trim());
}
try{
  await mkdir(profile);await writeFile(path.join(profile,'profile.json'),'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}\n');
  await new Promise(r=>proxy.listen(37035,'127.0.0.1',r));
  const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --host-resolver-rules="MAP shell35.example.org 127.0.0.1"'};
  const processes=await exec('powershell.exe',['-NoProfile','-Command','if(!(Get-Process explorer -ErrorAction SilentlyContinue)){Start-Process explorer.exe;Start-Sleep -Seconds 3};(Get-Process explorer -ErrorAction SilentlyContinue).Count']);
  console.log('Explorer processes on disposable runner:',processes.stdout.trim());
  app=spawn(process.env.STUDIO_Q35_EXE,['--isolated-profile',profile],{env,stdio:'ignore'});
  async function endpoint(folder){
    const root=path.join(profile,'data',folder);
    const file=(await readdir(root,{recursive:true})).find(s=>path.basename(s)==='DevToolsActivePort');
    if(!file)return;const [port,p]=String(await readFile(path.join(root,file))).trim().split(/\r?\n/);
    return /^\d+$/.test(port)&&p?.startsWith('/devtools/browser/')?'ws://127.0.0.1:'+port+p:null;
  }
  browser=await chromium.connectOverCDP(await wait('workspace profile endpoint',()=>endpoint('webview')));
  const pages=()=>browser.contexts().flatMap(c=>c.pages());
  const ui=await wait('workspace',()=>pages().find(p=>/^http:\/\/127\.0\.0\.1:\d+\/app\/workspaces\//.test(p.url())));
  ui.setDefaultTimeout(12000);
  ui.on('pageerror',e=>console.error('Workspace error',String(e)));
  ui.on('console',m=>{if(m.type()==='error')console.error('Workspace console',m.text().slice(0,300));});
  const describe=()=>ui.evaluate(()=>({url:location.href,title:document.title,lang:document.documentElement.lang,body:document.body.innerText.slice(0,900),
    active:document.body.dataset.activePlugin,viewport:[innerWidth,innerHeight],plugins:[...document.querySelectorAll('[data-plugin-id]')].map(e=>e.dataset.pluginId).slice(0,30),
    tauri:!!window.__TAURI__,chrome:[...document.querySelectorAll('[data-window-action]')].map(e=>[e.dataset.windowAction,e.getBoundingClientRect().width,e.closest('[hidden]')?.className])}));
  const fromPid=await exec('powershell.exe',['-NoProfile','-Command','(Get-Process -Id '+app.pid+').MainWindowHandle.ToInt64()']);
  hwnd=Number(fromPid.stdout.trim());assert.ok(hwnd>0);
  const original=await native('info');assert.ok(original.visible && original.dpi>=96 && original.monitors>=1);console.log('Actual virtual display',original);
  let pageFailure,paintAgain;
  try {
  ui.on('requestfailed',r=>console.error('FAILED',r.url(),r.failure()?.errorText));
  ui.on('response',r=>{if(r.status()>=400)console.error('HTTP',r.status(),r.url());});
  await ui.reload({waitUntil:'domcontentloaded'});
  console.log('Bootstrap',await ui.evaluate(async()=>({visibility:document.visibilityState,body:document.body.className,display:getComputedStyle(document.body).display,modules:await Promise.all([...document.querySelectorAll('script[type=module][src]')].map(async s=>{try{await import(s.src);return [s.src,'ok']}catch(e){return [s.src,String(e)]}}))})));
  const stage=setInterval(()=>ui.evaluate(()=>({ready:document.readyState,app:!!window.__picotNative,body:document.body.className,tags:document.querySelectorAll('[data-plugin-id]').length,assets:performance.getEntriesByType('resource').length,tail:performance.getEntriesByType('resource').slice(-4).map(e=>new URL(e.name).pathname),text:document.body.innerText.slice(0,90),nodes:[...document.body.children].filter(n=>n.tagName!=='SCRIPT').slice(0,5).map(e=>[e.id,e.className,getComputedStyle(e).visibility,getComputedStyle(e).display])})).then(v=>console.log('Startup progress',JSON.stringify(v))).catch(()=>{}),15000);
  try{await ui.locator('.browser-address').waitFor({timeout:105000});}finally{clearInterval(stage);}
  const input=ui.locator('.browser-address');
  await input.fill(site);await input.press('Enter');
  nativeBrowser=await chromium.connectOverCDP(await wait('isolated child profile endpoint',()=>endpoint('browser/profiles')));
  const child=await wait('native remote page',()=>nativeBrowser.contexts().flatMap(c=>c.pages()).find(p=>p.url()===site));
  await child.locator('#value').fill('survives overlay and tray');
  const dimensions=await native('size',725,620);
  assert.ok(await ui.evaluate(()=>innerWidth<=768),'OS resize did not reach narrow shell breakpoint');
  record('native HWND moved to narrow size at the runner’s observed Windows DPI',dimensions);
  async function pixels(){
    const locations=await ui.locator('.browser-viewport').evaluate(el=>{const r=el.getBoundingClientRect();return [.26,.74].map(k=>[(r.left+r.width*k)/innerWidth,(r.top+r.height*.7)/innerHeight]);});
    return Promise.all(locations.map(([x,y])=>native('pixel',x,y).then(r=>r.color)));
  }
  async function restored(label){
    let actual;await wait(label,async()=>{actual=await pixels();return actual[0]==='267ea8'&&actual[1]==='ce672a';},18000).catch(e=>{throw Error(e.message+' colors='+JSON.stringify(actual));});
    assert.equal(await child.locator('#value').inputValue(),'survives overlay and tray');
    record(label,{colors:actual});
  }
  paintAgain=restored;
  await restored('real native browser pixels before overlays');
  await input.focus();await ui.keyboard.press('Control+d');
  await ui.locator('.browser-bookmarks-dialog').waitFor();await ui.keyboard.press('Escape');await ui.locator('.browser-bookmarks-dialog').waitFor({state:'hidden'});
  await restored('closing narrow bookmarks restores the same native page and both painted colors');
  await ui.locator('[data-mobile-activity-more]').click();
  await ui.locator('[data-mobile-plugin-id="core.commands"]').click();
  await ui.locator('#command-palette').waitFor();await ui.keyboard.press('Escape');
  await ui.locator('#command-palette').waitFor({state:'hidden'});
  assert.ok(await ui.evaluate(()=>document.activeElement?.matches('[data-mobile-activity-more],[data-mobile-plugin-id="core.commands"],[data-plugin-id="core.commands"]')));
  await restored('narrow command Escape returns keyboard focus and rendered native page');
  }catch(e){pageFailure=e;console.error('PAGE CHECK:',e.message,JSON.stringify(await describe()));}
  const close=ui.locator('[data-window-action="close"]');
  try{await ui.mouse.move(350,260);await ui.keyboard.press('Tab');await close.focus();await ui.keyboard.press('Shift+Tab');
    assert.equal(await ui.evaluate(()=>document.activeElement?.dataset.windowAction),'toggleMaximize');
    record('actual WebView2 window controls retain keyboard focus across Shift+Tab');
  }catch(e){console.error('KEYBOARD CHECK:',e.message);pageFailure??=e;}
  if(await close.isVisible())await close.click();
  else {const r=await exec('powershell.exe',['-NoProfile','-Command','(Get-Process -Id '+app.pid+').CloseMainWindow()']);assert.equal(r.stdout.trim(),'True');}
  await wait('close-to-tray hid native HWND',async()=>!(await native('info')).visible);
  const tray=await native('tray');await wait('Explorer tray menu restored same HWND',async()=>(await native('info')).visible);
  record('Explorer notification icon restores the same native window using the recorded action',tray);
  if(!paintAgain)console.log('Initialization terminal', await ui.evaluate(async()=>Promise.race([import('/native/app.js').then(()=>['loaded',!!window.__picotNative],e=>['error',String(e)]),new Promise(r=>setTimeout(()=>r('pending after 5s'),5000))])));
  if(paintAgain)await paintAgain('tray restoration preserves unsaved input and both native page colors');
  if(pageFailure)throw pageFailure;
}finally{await nativeBrowser?.close().catch(()=>{});await browser?.close().catch(()=>{});app?.kill();proxy.closeAllConnections();proxy.close();}
