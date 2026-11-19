import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';

assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_WORKFLOW,'Windows updater settings acceptance');
const {Q32_PROFILE:profile,Q32_EXE:exe}=process.env;
const data=path.join(profile,'data');
const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'};
const seen=[],checks=[];
function pass(label){checks.push(label);console.log('PASS',label);}
async function until(label,read,ms=50000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){try{const result=await read();if(result)return result;}catch(e){last=e;}await sleep(170);}
  throw Error(label+': '+(last?.message||'timed out'));
}
async function attach(previous=''){
  const folder=path.join(data,'webview');
  const endpoint=await until('new WebView2 endpoint',async()=>{
    const f=(await readdir(folder,{recursive:true})).find(p=>path.basename(p)==='DevToolsActivePort');
    if(!f)return;const [port,ws]=String(await readFile(path.join(folder,f))).trim().split(/\r?\n/);
    const url='ws://127.0.0.1:'+port+ws;
    if(!/^\d+$/.test(port)||!ws?.startsWith('/devtools/browser/')||url===previous)return;
    return url;
  },85000);
  const b=await until('attach workspace webview',()=>chromium.connectOverCDP(endpoint,{noDefaults:true,timeout:6000}));
  const ui=await until('normal workspace route',()=>b.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/app/workspaces/')));
  ui.on('pageerror',e=>console.error('page error:',e.message));
  ui.setDefaultTimeout(18000);
  await ui.waitForFunction(()=>!!window.__picotNative,{},{timeout:55000});
  return {b,ui,endpoint};
}
async function noteAndBookmark(ui,seed,prior=null){
  return ui.evaluate(async ({seed,prior})=>{
    const {NotesGateway}=await import('/native/plugins/notes-gateway.js');
    const gateway=new NotesGateway(),ws=location.pathname.match(/\/workspaces\/([^/]+)/)[1],scene='programming';
    const invoke=(command,args)=>window.__TAURI__.core.invoke(command,args);
    if(seed){
      await gateway.createNotebook(scene,ws,{title:'Issue 32 retained notebook'});
      const {snapshot}=await gateway.list(scene,ws),book=snapshot.notebooks.find(v=>v.title==='Issue 32 retained notebook');
      await gateway.create(scene,ws,book.id,{title:'Issue 32 retained note',content:'Local full upgrade · 文件完整保留'});
      const lib=await invoke('browser_bookmarks',{request:{kind:'list'}});
      await invoke('browser_bookmarks',{request:{kind:'save',expectedRevision:lib.revision,folders:lib.folders,bookmarks:[...lib.bookmarks,{id:'0c4908f1-f40f-405a-aed1-0fa8e317b22f',title:'Issue32 bookmark',url:'https://example.org/issue32',folderId:null}]}});
    }
    const {snapshot}=await gateway.list(scene,ws),note=snapshot.notes.find(v=>v.title==='Issue 32 retained note');
    if(!note)throw Error('Retained note missing');
    const full=(await gateway.get(scene,ws,note.notebookId,note.id)).note;
    const bookmark=(await invoke('browser_bookmarks',{request:{kind:'list'}})).bookmarks.find(v=>v.id==='0c4908f1-f40f-405a-aed1-0fa8e317b22f');
    if(!bookmark)throw Error('Retained bookmark missing');
    const attachmentId=seed?(await gateway.uploadAttachment(scene,ws,full,{fileName:'retained-32.txt',mimeType:'text/plain',dataBase64:btoa('Q32 synthetic attachment bytes')})).attachment.id:prior.attachmentId;
    const attachment=await fetch(gateway.attachmentUrl(scene,ws,full,attachmentId));
    if(!attachment.ok||await attachment.text()!=='Q32 synthetic attachment bytes')throw Error('Original real attachment is missing or changed');
    const gallery=request=>invoke('visual_assets_control',{workspaceId:ws,request});
    let library=await gallery({kind:'list'});
    if(seed){
      await gallery({kind:'changeCollections',libraryId:library.libraryId,edit:{kind:'create',name:'Q32 retained collection'}});
      library=await gallery({kind:'list'});
    }
    const collection=library.collections?.find(c=>c.name==='Q32 retained collection');
    if(!collection)throw Error('Original gallery collection is missing or changed');
    return {note:[full.id,full.title,full.content],bookmark,attachmentId,libraryId:library.libraryId,collection};
  },{seed,prior});
}
let app,b,ui;
try{
  await mkdir(profile,{recursive:true});
  await writeFile(path.join(profile,'profile.json'),'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}\n');
  app=spawn(exe,['--isolated-profile',profile,'--tools-only'],{env,cwd:path.dirname(exe),stdio:'ignore'});
  let endpoint;({b,ui,endpoint}=await attach());
  const committed=await noteAndBookmark(ui,true);
  const calls=new Set(['check_desktop_update','install_desktop_update','restart_desktop_after_update','cancel_desktop_update']);
  ui.on('request',req=>{const name=new URL(req.url()).pathname.split('/').at(-1);if(calls.has(name))seen.push(name);});
  await ui.exposeBinding('recordUpdate32',(_,name)=>seen.push(name));
  await ui.addInitScript(()=>{
    const ipc=window.__TAURI_INTERNALS__,original=ipc?.invoke;
    const names=new Set(['check_desktop_update','install_desktop_update','restart_desktop_after_update','cancel_desktop_update']);
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){const name=new URL(entry.name).pathname.split('/').at(-1);if(names.has(name))window.recordUpdate32(name);}});
    observer.observe({type:'resource',buffered:true});
    if(!ipc||!Object.getOwnPropertyDescriptor(ipc,'invoke')?.writable)return;
    ipc.invoke=function(name,...args){if(['check_desktop_update','install_desktop_update','restart_desktop_after_update','cancel_desktop_update'].includes(name))window.recordUpdate32(name);return original.call(this,name,...args);};
  });
  await ui.reload({waitUntil:'domcontentloaded'});
  await ui.waitForFunction(()=>!!window.__picotNative,{},{timeout:55000});
  await ui.locator('[data-plugin-id="core.commands"]').click();
  const field=ui.locator('#command-palette [role=combobox]');
  const zh=await ui.evaluate(()=>document.documentElement.lang.startsWith('zh'));
  await field.fill(zh?'设置':'Settings');
  const opt=ui.locator('#command-palette [role=option]').filter({has:ui.locator('.command-label',{hasText:zh?/^设置$/:/^Settings$/})});
  await opt.first().click();
  await ui.locator('[data-settings-tab="updates"]').click();
  const btn=ui.locator('#btn-check-updates'),status=ui.locator('#setting-update-status');
  assert.match(await ui.locator('#setting-app-version-value').innerText(),/0\.6\.1/);
  await until('initial version read',()=>btn.isEnabled());
  if(await btn.getAttribute('data-mode')==='check')await btn.click();
  await until('real stable metadata',async()=>(await status.innerText()).includes('0.6.2'),65000);
  assert.ok((await ui.locator('[data-settings-panel=updates] details p').textContent()).trim().length>0);
  pass('production settings shows current 0.6.1, public 0.6.2 and nonempty release notes');
  await btn.click();
  const cancel=ui.getByRole('button',{name:/Cancel download|取消下载/});
  await cancel.click({timeout:90000});
  await until('download cancellation reported',async()=>/cancelled|取消/i.test(await status.innerText()));
  assert.equal(app.exitCode,null);
  pass('real download cancelled from the settings page with original Studio still open');
  await btn.click();
  await until('retry downloaded complete verified installer',async()=>/Install and exit|安装并退出/.test(await btn.innerText()),300000);
  const store=path.join(data,'desktop-updates');
  const installedBundle=await until('ready candidate file',async()=>(await readdir(store)).find(v=>/^candidate-.*\.exe$/.test(v)));
  const bundle=await readFile(path.join(store,installedBundle));
  assert.equal(bundle.length,368501225);
  assert.equal(createHash('sha256').update(bundle).digest('hex'),'e6f18ac3d4de6dfab123755ff75cb3ca7cd6486ed4a11619c5269d8760abdb9c');
  pass('retry verified the exact 368501225-byte public Windows NSIS before installation');
  await ui.getByRole('button',{name:/Discard update|取消本次更新/}).click();
  await until('verified candidate removed',async()=>!(await readdir(store)).includes(installedBundle));
  assert.equal(app.exitCode,null);
  pass('discarding the verified full update deletes its candidate and keeps Studio running');
  await btn.click();
  await until('redownload after discarding',async()=>/Install and exit|安装并退出/.test(await btn.innerText()),300000);
  await btn.click({noWaitAfter:true}).catch(e=>{if(!/closed|destroyed/i.test(e.message))throw e;});
  await until('original Studio exited normally',()=>app.exitCode===0,90000);
  const r=await until('post-install handoff receipt',async()=>JSON.parse(await readFile(path.join(store,'result.json'),'utf8')),240000);
  assert.equal(r.status,'installed',r.message);assert.equal(r.version,'0.6.2');
  for(const name of ['check_desktop_update','install_desktop_update','cancel_desktop_update','restart_desktop_after_update'])assert.ok(seen.includes(name),'missing observed production IPC: '+name);
  ({b,ui}=await attach(endpoint));
  assert.deepEqual(await noteAndBookmark(ui,false,committed),committed);
  pass('actual app check/install/cancel/restart IPC, an installed receipt, relaunch and the same note content, exact attachment bytes, bookmark and gallery collection IDs');
} catch(e){if(ui&&!ui.isClosed())console.error('visible diagnostic',String(await ui.locator('body').innerText()).slice(-1700));throw e;}
finally{await b?.close().catch(()=>{});}
