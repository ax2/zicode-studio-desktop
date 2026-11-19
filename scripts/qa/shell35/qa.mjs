import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';

import path from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_WORKFLOW,'Isolated Windows shell acceptance');
const exec=promisify(execFile),profile=path.join(process.env.RUNNER_TEMP,'shell35-profile');
const site='https://example.com/';
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

  const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'};
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

  console.log('Bootstrap',await ui.evaluate(async()=>({visibility:document.visibilityState,body:document.body.className,display:getComputedStyle(document.body).display,modules:await Promise.all([...document.querySelectorAll('script[type=module][src]')].map(async s=>{try{await import(s.src);return [s.src,'ok']}catch(e){return [s.src,String(e)]}}))})));
  const stage=setInterval(()=>ui.evaluate(()=>({ready:document.readyState,app:!!window.__picotNative,body:document.body.className,tags:document.querySelectorAll('[data-plugin-id]').length,assets:performance.getEntriesByType('resource').length,tail:performance.getEntriesByType('resource').slice(-4).map(e=>new URL(e.name).pathname),text:document.body.innerText.slice(0,90),nodes:[...document.body.children].filter(n=>n.tagName!=='SCRIPT').slice(0,5).map(e=>[e.id,e.className,getComputedStyle(e).visibility,getComputedStyle(e).display])})).then(v=>console.log('Startup progress',JSON.stringify(v))).catch(()=>{}),15000);
  try{await ui.locator('.studio-browser[aria-busy=false]').waitFor({timeout:60000});}finally{clearInterval(stage);}
  const input=ui.locator('.browser-address');
  await input.fill(site);await input.press('Enter');
  nativeBrowser=await chromium.connectOverCDP(await wait('isolated child profile endpoint',()=>endpoint('browser/profiles')));
  const child=await wait('native remote page',()=>nativeBrowser.contexts().flatMap(c=>c.pages()).find(p=>p.url()===site));
  await child.waitForFunction(()=>document.readyState==='complete'&&document.title==='Example Domain');
  console.log('Live remote document',await child.evaluate(()=>({title:document.title,url:location.href,viewport:[innerWidth,innerHeight],visibility:document.visibilityState,heading:document.querySelector('h1')?.textContent})));
  const call=(name,args)=>ui.evaluate(({name,args})=>window.__TAURI__.core.invoke(name,args),{name,args});
  const state=async()=>(await call('browser_get_state')).session;
  const initial=await state(), first=initial.activeTab;
  await ui.locator('.browser-address').press('Control+t');
  await wait('second tab',async()=>(await state()).tabs.length===2);
  const source=ui.locator('.browser-address');const other=site+'?tone=880';
  await source.fill(other);await source.press('Enter');
  const peer=await wait('second native document',()=>nativeBrowser.contexts().flatMap(c=>c.pages()).find(p=>p.url()===other));
  const second=(await state()).activeTab;
  const target=(url)=>ui.locator('[role=tab]').evaluateAll((tabs,url)=>{let t=tabs.find(t=>t.title===url);if(!t)throw Error('missing tab '+url);t.click();},url);
  async function tone(p,f){
    await p.evaluate(f=>{let b=document.createElement('button');b.id='tone';b.style.cssText='position:fixed;inset:16px;z-index:100';b.textContent='play';b.onclick=async()=>{let ctx=new AudioContext();window.qctx=ctx;await ctx.resume();let o=ctx.createOscillator();o.frequency.value=f;let g=ctx.createGain();g.gain.value=.35;let a=ctx.createAnalyser();o.connect(g);g.connect(a);a.connect(ctx.destination);o.start();window.qaAnalyser=a;};document.documentElement.append(b);},f);
    await p.locator('#tone').click();await wait('Web Audio real samples',()=>p.evaluate(()=>{if(!window.qaAnalyser)return false;let a=new Float32Array(1024);window.qaAnalyser.getFloatTimeDomainData(a);return window.qctx.state==='running'&&Math.max(...a)>.1;}));
  }
  await tone(peer,880);await target(site);await tone(child,440);
  async function setting(id){return call('browser_control',{request:{kind:'pageSettings',tab:id}})}
  async function mute(url,re){
    const tab=ui.locator('[role=tab]').filter({hasText:'Example Domain'});
    const n=await tab.evaluateAll((els,url)=>els.findIndex(e=>e.title===url),url);assert.ok(n>=0);
    await tab.nth(n).click({button:'right'});await ui.getByRole('menuitem',{name:re}).click();
  }
  await mute(other,/^(Mute tab|标签页静音|静音标签页|静音标签)$/i);
  await wait('muted peer',async()=>(await setting(second)).muted);
  assert.equal((await setting(first)).muted,false);assert.equal((await state()).activeTab,first);
  await mute(other,/^(Unmute tab|取消标签页静音|取消静音|取消静音标签页)$/i);
  await wait('unmuted peer',async()=>!(await setting(second)).muted);
  record('two real pages generate distinct audio samples while genuine tab-menu mute and unmute affects only the selected source identity', {first,second,deviceCount:process.env.QA10_RENDER_DEVICES});
  }catch(e){pageFailure=e;console.error('PAGE CHECK:',e.message,JSON.stringify(await describe()));}
  if(pageFailure)throw pageFailure;
}finally{await nativeBrowser?.close().catch(()=>{});await browser?.close().catch(()=>{});app?.kill();}
