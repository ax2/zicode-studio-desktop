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
  await native('size',950,670);
  const state=()=>ui.evaluate(async()=> (await window.__TAURI__.core.invoke('browser_get_state')).session);
  const snap=async()=>{const s=await state();return {tabs:s.tabs.map(t=>({id:t.id,url:t.url,zoom:t.zoom,muted:t.muted})),active:s.activeTab};};
  const current=(s,id)=>s.tabs.find(t=>t.id===id);
  const id=(await snap()).active;
  await child.evaluate(()=>{document.documentElement.style.height='5000px';window.scrollTo(0,500);});
  const point=()=>ui.locator('.browser-viewport').evaluate(el=>{let r=el.getBoundingClientRect();return [(r.left+r.width*.48)/innerWidth,(r.top+r.height*.4)/innerHeight]});
  let pt=await point();console.log('Starting state',await snap());
  const results=[];async function check(label,fn){try{await fn();record(label);}catch(e){results.push(label+': '+String(e));console.log('FAIL',results.at(-1));}}
  await check('positive ordinary physical wheel scrolls the real document without zoom',async()=>{
    let original=(await snap());await native('wheel',...pt);await wait('scroll',()=>child.evaluate(()=>scrollY<500),6500);assert.equal(current(await snap(),id).zoom,current(original,id).zoom);
  });
  await check('native Ctrl+wheel changes and persists zoom on selected tab',async()=>{
    let original=current(await snap(),id).zoom||1;await native('ctrlwheel',...pt);let t=await wait('new zoom',async()=>{let t=current(await snap(),id);return t.zoom>original&&t},7000);console.log('Host persisted zoom',t.zoom);
  });
  await check('physical F11 goes fullscreen and restores window',async()=>{
    await child.locator('body').click({position:{x:4,y:4}});let before=await native('info');await native('f11',...pt);
    let full=await wait('fullscreen HWND',async()=>{let u=await native('info');return u.width>before.width&&u},7000);await native('f11',...pt);await wait('restore size',async()=>(await native('info')).width===before.width,9000);console.log('Window sizes',before.width,full.width);
  });
  await check('physical right click activates WebView2 Browser tools / Zoom in',async()=>{
    pt=await point();let prev=current(await snap(),id).zoom||1;await native('right',...pt);let m=await native('menu');console.log('Native menu',m);if(!m.activated){await native('escape');throw Error('No custom native menu command activated');}await wait('menu zoom change',async()=>current(await snap(),id).zoom>prev,6500);
  });
  for(const action of ['ctrlclick','middle','shiftclick'])await check('physical '+action+' opens real link exactly once',async()=>{
    await ui.locator('[role=tab]').filter({hasText:'Example Domain'}).first().click();
    const sourceTab=await snap();const source=sourceTab.active;
    let url=site+'?q10='+action;
    await child.evaluate(url=>{let a=document.querySelector('#q10link')||document.createElement('a');a.id='q10link';a.href=url;a.textContent='Open test link';a.style.cssText='position:fixed;inset:0;display:block;z-index:10000;background:white';document.documentElement.append(a)},url);
    await native(action,...await point());const after=await wait('link destination '+action,async()=>{let s=await snap();return s.tabs.some(t=>t.url===url)&&s},8000);
    assert.equal(after.tabs.length,sourceTab.tabs.length+1);assert.equal(current(after,source).url,site);console.log('Link disposition',action,after.active===source?'background':'foreground');
  });
  console.log('Results',JSON.stringify({checks,results,final:await snap()}));if(results.length)throw Error(results.join('; '));
  }catch(e){pageFailure=e;console.error('PAGE CHECK:',e.message,JSON.stringify(await describe()));}
  if(pageFailure)throw pageFailure;
}finally{await nativeBrowser?.close().catch(()=>{});await browser?.close().catch(()=>{});app?.kill();}
