import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';

assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_WORKFLOW,'Isolated Windows clipboard translation');
const profile=path.join(process.env.RUNNER_TEMP,'clipboard-synthetic-56');
const en='Please translate this sentence from the clipboard into Chinese.';
const zh='请把剪贴板中的这句话翻译成英文。';
const translations=new Map();
const requests=[];
let holdNext=false, finishedHeld=false, releaseHeld, app, browser;
const server=createServer(async(req,res)=>{
 let raw=''; for await(const chunk of req) raw+=chunk;
 try {
  assert.equal(req.url,'/v1/chat/completions');
  const obj=JSON.parse(raw),prompt=obj.messages.at(-1).content;
  const text=prompt.split('\n\n').at(-1); assert.ok([en,zh].includes(text));
  assert.ok(prompt.includes(text===zh?'from Chinese into English':'from English into Chinese'));
  requests.push(text);
  const held=holdNext;
  if(held){holdNext=false;await new Promise(r=>{releaseHeld=r;});}
  const result=await exec(process.execPath,['offline.mjs',text===en?'en_zh':'zh_en',Buffer.from(text).toString('base64')],{timeout:45000});
  const translation=Buffer.from(result.stdout.trim(),'base64').toString('utf8');
  if(text===en) {assert.match(translation,/翻译|译成/);assert.match(translation,/中文|汉语|中国/);}
  else {assert.match(translation,/translat/i);assert.match(translation,/English/i);}
  console.log('OPUS-MT CPU '+(text===en?'en→zh':'zh→en')+': '+translation);
  translations.set(text,translation);
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:translations.get(text)}}]}));
  if(held)finishedHeld=true;
 }catch(e){console.error(String(e));res.writeHead(400).end();}
});
const exec=promisify(execFile);
async function clipboard(action,text=''){
 const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.resolve('input.ps1'),action,Buffer.from(text).toString('base64')],{timeout:25000});
 return Buffer.from(stdout.trim(),'base64').toString('utf8');
}
async function wait(label,read){
 let last;for(let i=0;i<180;i++){try{const v=await read();if(v)return v;}catch(e){last=e;}await sleep(250);}
 throw new Error(label+': '+String(last||'timed out'));
}
try {
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const dir=path.join(profile,'system/scenes/ab2620f9b7154d9f9dc1b3c2d949d85d/agent');
 await mkdir(dir,{recursive:true}); await writeFile(path.join(profile,'profile.json'),'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}\n');
 await writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:origin+'/v1',authHeader:false,models:[{id:'qa',name:'Fixture'}]}}}));
 const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=18956 --remote-debugging-address=127.0.0.1',WEBVIEW2_USER_DATA_FOLDER:path.join(profile,'webview')};
 app=spawn(process.env.STUDIO_56_EXE,['--tools-only','--isolated-profile',profile],{env,stdio:'ignore'});
 await wait('WebView2 started',async()=>{if(app.exitCode!==null)throw Error('Studio exited '+app.exitCode);return(await fetch('http://127.0.0.1:18956/json/version')).ok;});
 browser=await chromium.connectOverCDP('http://127.0.0.1:18956');
 const pages=()=>browser.contexts().flatMap(c=>c.pages());
 const main=await wait('workspace window',()=>pages().find(p=>/^http:\/\/127\.0\.0\.1:\d+\/app\/workspaces\//.test(p.url())));
 const invoke=request=>main.evaluate(request=>window.__TAURI__.core.invoke('clipboard_translation',{request}),request);
 const approval=await wait('candidate model ready',()=>invoke({kind:'preview',provider:'fixture',model:'qa'}));
 await invoke({kind:'enable',provider:'fixture',model:'qa',identity:approval.identity,preferred:'Chinese',alternate:'English'});
 assert.equal(requests.length,0);
 const control=async(command)=>(await exec('powershell.exe',['-NoProfile','-Command',command])).stdout.trim();
 const hwnd=await control('$p=Get-Process -Id '+app.pid+'; $p.MainWindowHandle.ToInt64()');
 assert.match(hwnd,/^[1-9]\d*$/);
 const visible=async()=>await control('Add-Type -Name W -Namespace QA -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);\'; [QA.W]::IsWindowVisible([IntPtr]'+hwnd+')')==='True';
 assert.equal(await control('(Get-Process -Id '+app.pid+').CloseMainWindow()'),'True');
 await wait('closed to tray before hotkey',async()=>!await visible());
 await clipboard('copy',en);
 const popup=await wait('OS hotkey opened Studio popup',()=>pages().find(p=>p.url().includes('translation-popup')));
 async function translated(text){
  await wait('translated popup for '+text,async()=>translations.has(text) && (await popup.locator('#result').inputValue())===translations.get(text));
  assert.equal(await popup.locator('#source-text').inputValue(),text);
  assert.equal(await popup.locator('#target-language').inputValue(),text===zh?'English':'Chinese');
  assert.equal(await visible(),false);
 }
 await translated(en);console.log('PASS real offline English to Chinese');
 await popup.locator('#workbench').click();
 const input=main.locator('.translate-textarea');
 await wait('first real result handed off',async()=>await input.inputValue()===en);
 await input.fill('My existing synthetic workbench draft');
 assert.equal(await control('(Get-Process -Id '+app.pid+').CloseMainWindow()'),'True');
 await wait('back in tray',async()=>!await visible());
 holdNext=true;
 await clipboard('copy',en);await wait('first overlapping request in flight',()=>releaseHeld);
 await clipboard('copy',zh);
 const currentPopup=()=>pages().find(p=>p.url().includes('translation-popup'));
 const latest=await wait('new popup',currentPopup);
 await wait('latest real result',async()=>translations.has(zh)&&await latest.locator('#result').inputValue()===translations.get(zh));
 assert.equal(await latest.locator('#target-language').inputValue(),'English');
 releaseHeld();await wait('old request exited',()=>finishedHeld);
 assert.equal(await latest.locator('#source-text').inputValue(),zh);
 assert.equal(await latest.locator('#result').inputValue(),translations.get(zh));
 console.log('PASS real offline Chinese to English; older in-flight result does not overwrite latest');
 await latest.locator('#workbench').click();
 const incoming=main.locator('.translate-incoming');
 await incoming.waitFor();assert.equal(await input.inputValue(),'My existing synthetic workbench draft');
 await incoming.locator('button').nth(1).click();assert.equal(await input.inputValue(),'My existing synthetic workbench draft');
 assert.equal(await incoming.count(),0);
 await clipboard('copy',zh);
 const again=await wait('last popup',currentPopup);
 await wait('fresh completed result',async()=>requests.length===4&&await again.locator('#copy').isVisible());
 await again.locator('#workbench').click();await incoming.waitFor();await incoming.locator('button').first().click();
 assert.equal(await input.inputValue(),zh);assert.equal(await main.locator('.translate-result-text').inputValue(),translations.get(zh));
 assert.deepEqual(requests,[en,en,zh,zh]);console.log('PASS workbench keep draft and explicitly replace without additional model request');
} finally {releaseHeld?.();await browser?.close().catch(()=>{});app?.kill();server.closeAllConnections();server.close();}
