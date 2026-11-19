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
import {createServer} from 'node:https';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const observed=new Map();
async function serveFixture(){
  const dir=await mkdtemp(path.join(tmpdir(),'q13-'));const host='q13-browser.example.org';
  const key=path.join(dir,'key.pem'),crt=path.join(dir,'crt.pem');
  await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',crt,'-days','1','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host]);
  const keyData=await readFile(key),certData=await readFile(crt);
  const {X509Certificate}=await import('node:crypto');const cert=new X509Certificate(certData);
  const pin=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
  const pdfParts=[],objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 3 /Kids [3 0 R 5 0 R 7 0 R] >>'];
  for(const [i,col] of ['.1 .7 .3','.9 .2 .3','.2 .3 .9'].entries()){
    const content=col+' rg 0 0 360 480 re f\nBT /F1 22 Tf 0 0 0 rg 30 380 Td (Studio fixture page '+(i+1)+') Tj ET\n';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480] /Resources << /Font << /F1 9 0 R >> >> /Contents '+(4+2*i)+' 0 R >>','<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'endstream');
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');let pdf='%PDF-1.4\n';
  const offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 10\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  const server=createServer({key:keyData,cert:certData},(req,res)=>{
    if(req.headers.host?.split(':')[0]!==host){res.writeHead(403).end();return}
    observed.set(req.url,req.headers['user-agent']);
    if(req.url.startsWith('/doc.pdf')){res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline','Content-Length':Buffer.byteLength(pdf),'Cache-Control':'no-store'}).end(pdf);return}
    res.writeHead(200,{'Content-Type':'text/html'}).end('<title>Example Domain</title><h1>Studio print fixture</h1><a href="/doc.pdf">Synthetic 3-page PDF</a>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,base:'https://'+host+':'+server.address().port+'/',args:' --host-resolver-rules="MAP '+host+' 127.0.0.1" --ignore-certificate-errors-spki-list='+pin+' --no-proxy-server'};
}

const served=await serveFixture();const site=served.base;
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

  const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'+served.args};
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
  const invoke=(p,cmd,args)=>p.evaluate(({cmd,args})=>window.__TAURI__.core.invoke(cmd,args),{cmd,args});
  const state=p=>invoke(p,'browser_get_state');
  const pref=p=>invoke(p,'browser_control',{request:{kind:'getUserAgent'}});
  const marker='ZiCode-QA179/1.0', other='ZiCode-QA179-Named/2.0';
  const baseline=observed.get('/');assert.ok(baseline?.includes('Mozilla/'),'server must receive real WebView2 UA');
  async function configure(p,ua){
    const m=p.locator('.browser-options');if(!await m.evaluate(e=>e.open))await m.locator('summary').click();
    const d=m.locator('.browser-user-agent');if(!await d.evaluate(e=>e.open))await d.locator('summary').click();
    const input=d.locator('input');await wait('preference initialized',()=>input.isEnabled());
    if(ua!==null){await input.fill(ua);await d.locator('[type=submit]').click()}else await d.locator('[type=button]').click();
    await wait('saved configuration',async()=>await pref(p)===ua);
    await m.locator('summary').click();
  }
  async function load(p,key,newTab=true){
    const box=p.locator('.browser-address');
    if(newTab){const before=(await state(p)).session.activeTab;await box.focus();await box.press('Control+t');await wait('new native tab',async()=> (await state(p)).session.activeTab!==before);await p.locator('.studio-browser[aria-busy=false]').waitFor();}
    const target=site+'?qa179='+key;await box.fill(target);await box.press('Enter');
    return wait('server UA for '+key,()=>observed.get('/?qa179='+key));
  }
  assert.equal(await pref(ui),null);await configure(ui,marker);
  assert.equal(await load(ui,'existing',false),baseline);assert.equal(await load(ui,'override'),marker);
  await assert.rejects(invoke(ui,'browser_control',{request:{kind:'setUserAgent',value:'invalid\r\nInjected: not-a-header'}}));assert.equal(await pref(ui),marker);
  record('default real request header, custom first navigation, retained previous open-tab UA and rejection of malformed input');
  await invoke(ui,'browser_window_command',{action:'createProfile',profileName:'UA isolation fixture'});
  const secondary=await wait('another named workspace',async()=>{
    for(const p of browser.contexts().flatMap(c=>c.pages())){if(p===ui||!p.url().includes('/app/workspaces/'))continue;try{if((await state(p)).profileName==='UA isolation fixture')return p}catch{}}
  });
  await secondary.locator('.studio-browser[aria-busy=false]').waitFor();assert.notEqual((await state(secondary)).profileId,(await state(ui)).profileId);assert.equal(await pref(secondary),null);
  assert.equal(await load(secondary,'other-default'),baseline);await configure(secondary,other);
  assert.equal(await load(secondary,'other-custom'),other);assert.equal(await pref(ui),marker);
  await invoke(secondary,'browser_window_command',{action:'close'}).catch(()=>{});
  record('two named/default browser profiles with different server-observed headers share a single isolated installation');
  const old=app.pid,exited=new Promise(resolve=>app.once('exit',resolve));app.kill();await exited;app=spawn(process.env.STUDIO_Q35_EXE,['--isolated-profile',profile],{env,stdio:'ignore'});assert.notEqual(old,app.pid);
  const recovered=await wait('restarted Studio',async()=>{try{const b=await chromium.connectOverCDP(await endpoint('webview'),{timeout:3000});for(const p of b.contexts().flatMap(c=>c.pages())){if(p.url().includes('/app/workspaces/')&&(await pref(p))===marker)return {b,p}}}catch{}});
  browser=recovered.b;const p=recovered.p;await p.locator('.studio-browser[aria-busy=false]').waitFor();assert.equal(await load(p,'after-restart'),marker);
  await configure(p,null);assert.equal(await load(p,'reset'),baseline);
  record('real Studio restart restores profile UA, explicit reset restores original wire header',{baseline,custom:marker,named:other});

  }catch(e){pageFailure=e;console.error('PAGE CHECK:',e.message,JSON.stringify(await describe()));}
  if(pageFailure)throw pageFailure;
}finally{await nativeBrowser?.close().catch(()=>{});await browser?.close().catch(()=>{});app?.kill();served.server.closeAllConnections();served.server.close();}
