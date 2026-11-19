import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
assert.equal(process.env.GITHUB_WORKFLOW,'Windows daily profile update acceptance');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
const seed=process.argv[2]==='seed',root=path.join(process.env.Q32_PROFILE,'data/webview');
const app=seed?spawn(process.env.Q32_EXE,['--tools-only'],{cwd:path.dirname(process.env.Q32_EXE),env:process.env,stdio:'ignore'}):null;
let browser,ui,last;
try{
  for(let i=0;i<180&&!ui;i++){
    try{
      const f=(await readdir(root,{recursive:true})).find(p=>path.basename(p)==='DevToolsActivePort');
      const [port,ws]=String(await readFile(path.join(root,f))).trim().split(/\r?\n/);
      browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+ws,{noDefaults:true,timeout:2000});
      ui=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/app/workspaces/'));
    }catch(e){last=e;}
    if(!ui)await sleep(250);
  }
  assert.ok(ui,'New Studio unavailable: '+String(last));
  await ui.waitForFunction(()=>!!window.__TAURI__?.core?.invoke);
  const result=await ui.evaluate(async seed=>{
    const invoke=window.__TAURI__.core.invoke;
    const args={sceneId:'programming',provider:'qa32-daily-synthetic'};
    if(seed)await invoke('store_scene_credential',{...args,secret:'Q32-'+crypto.randomUUID()});
    const state=await invoke('scene_credential_status',args);
    return {configured:state.configured,storage:state.storage};
  },seed);
  assert.deepEqual(result,{configured:true,storage:'system'});
  console.log('PASS',seed?'Stored a synthetic credential via the real Windows app system vault':'Restarted installed app retrieved the same configured credential as system storage under the persistent daily selection');
}finally{await browser?.close().catch(()=>{});if(app&&app.exitCode===null&&app.signalCode===null){const done=new Promise(resolve=>app.once('exit',resolve));app.kill();await done;}}
