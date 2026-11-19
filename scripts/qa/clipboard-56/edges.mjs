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
const translations=new Map([['OK','好'],[en,'请将剪贴板中的这句话翻译成中文。'],[zh,'Please translate this sentence from the clipboard into English.']]);
const requests=[];
let failNext=false, app, browser;
const server=createServer(async(req,res)=>{
 let raw=''; for await(const chunk of req) raw+=chunk;
 try {
  assert.equal(req.url,'/v1/chat/completions');
  const obj=JSON.parse(raw),prompt=obj.messages.at(-1).content;
  const text=prompt.split('\n\n').at(-1); assert.ok(translations.has(text));
  assert.ok(prompt.includes(text===zh?'from Chinese into English':'from English into Chinese'));
  requests.push(text);
  if(failNext){failNext=false;res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:translations.get(text)}}]}));
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

 const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=18956 --remote-debugging-address=127.0.0.1',WEBVIEW2_USER_DATA_FOLDER:path.join(profile,'webview')};
 app=spawn(process.env.STUDIO_56_EXE,['--tools-only','--isolated-profile',profile],{env,stdio:'ignore'});
 await wait('WebView2 started',async()=>{if(app.exitCode!==null)throw Error('Studio exited '+app.exitCode);return(await fetch('http://127.0.0.1:18956/json/version')).ok;});
 browser=await chromium.connectOverCDP('http://127.0.0.1:18956');
 const pages=()=>browser.contexts().flatMap(c=>c.pages());
 const main=await wait('workspace window',()=>pages().find(p=>/^http:\/\/127\.0\.0\.1:\d+\/app\/workspaces\//.test(p.url())));
 const invoke=request=>main.evaluate(request=>window.__TAURI__.core.invoke('clipboard_translation',{request}),request);


 assert.equal(requests.length,0);
 const control=async(command)=>(await exec('powershell.exe',['-NoProfile','-Command',command])).stdout.trim();
 const hwnd=await control('$p=Get-Process -Id '+app.pid+'; $p.MainWindowHandle.ToInt64()');
 assert.match(hwnd,/^[1-9]\d*$/);
 const visible=async()=>await control('Add-Type -Name W -Namespace QA -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);\'; [QA.W]::IsWindowVisible([IntPtr]'+hwnd+')')==='True';
 assert.equal(await control('(Get-Process -Id '+app.pid+').CloseMainWindow()'),'True');
 await wait('closed to tray before hotkey',async()=>!await visible());
 await clipboard('copy',en);
 const popup=await wait('OS hotkey opened Studio popup',()=>pages().find(p=>p.url().includes('translation-popup')));
 const snap=()=>popup.evaluate(()=>window.__TAURI__.core.invoke('clipboard_translation',{request:{kind:'snapshot'}})).then(v=>v.popup);
 const reason=expected=>wait(expected, async()=>(await snap())?.message===expected && !!(await popup.locator('#status').innerText()));
 await reason("Choose a service for clipboard translation in Studio");assert.equal(requests.length,0);
 console.log('PASS no approved model shows local notice and sends nothing');
 await writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:origin+'/v1',authHeader:false,models:[{id:'qa',name:'Fixture'}]}}}));
 const approval=await wait('candidate model ready',()=>invoke({kind:'preview',provider:'fixture',model:'qa'}));
 await invoke({kind:'enable',provider:'fixture',model:'qa',identity:approval.identity,preferred:'Chinese',alternate:'English'});
 await clipboard('opaque');await reason("Clipboard contains no text");
 await clipboard('oversize');await reason("Clipboard text exceeds the 50,000-character translation limit");
 assert.equal(requests.length,0);console.log('PASS non-text and oversized system clipboard explicit feedback, zero model calls');
 for(const ambiguous of ['今天测试 Windows clipboard translation and everything is working 非常顺利','OK']){
   await clipboard('copy',ambiguous);await reason("Choose the languages and try again");
   assert.equal((await snap()).draft.text,ambiguous);assert.equal(requests.length,0);
 }
 await popup.locator('#source-language').selectOption('English');await popup.locator('#target-language').selectOption('Chinese');await popup.locator('#retry').click();
 await wait('corrected language and retry',async()=>await popup.locator('#result').inputValue()==='好');
 assert.deepEqual(requests,['OK']);console.log('PASS mixed/short text requires explicit correction, then translates');
 const close=popup.waitForEvent('close');await popup.locator('#close').click();await close;assert.equal(await visible(),false);
 console.log('PASS close popup returns to tray without showing main window');
 await control(`Add-Type -Name Win -Namespace ET -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);'; [ET.Win]::ShowWindow([IntPtr]${hwnd},9)`);
 await main.bringToFront();
 await main.locator('.quick-tools-menu > summary').click();
 await main.locator('[data-tool-launcher-open="com.zicode.translate:open"]').first().click();
 const input=main.locator('.translate-textarea');
 await input.fill('synthetic draft');
 await clipboard('copyOnly','manual import from external control');
 assert.equal(await input.inputValue(),'synthetic draft');assert.equal(await main.locator('.translate-incoming').count(),0);
 await main.bringToFront();
 await main.context().grantPermissions(['clipboard-read'],{origin:new URL(main.url()).origin});
 const label=await main.evaluate(async()=>{const {t}=await import('/i18n.js');return t('Import from clipboard');});
 await main.getByRole('button',{name:label,exact:true}).click();
 const incoming=main.locator('.translate-incoming');await incoming.waitFor();assert.equal(await input.inputValue(),'synthetic draft');
 await incoming.locator('button').first().click();assert.equal(await input.inputValue(),'manual import from external control');
 assert.deepEqual(requests,['OK']);console.log('PASS manual native clipboard import requires explicit action and draft replacement');
 await browser.close();browser=undefined;
 app.kill();await wait('test Studio exited',()=>app.exitCode!==null || app.signalCode);
 const reserving=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.resolve('input.ps1'),'reserve'],{stdio:['pipe','pipe','inherit']});
 try{
  let registered='';reserving.stdout.on('data',chunk=>{registered+=chunk;});
  await wait('other process registered actual global shortcut',()=>registered.includes('RESERVED'));
  const conflictProfile=profile+'-conflict';await mkdir(conflictProfile);
  await writeFile(path.join(conflictProfile,'profile.json'),'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}\n');
  app=spawn(process.env.STUDIO_56_EXE,['--tools-only','--isolated-profile',conflictProfile],{env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.replace('18956','18957'),WEBVIEW2_USER_DATA_FOLDER:path.join(conflictProfile,'webview')},stdio:'ignore'});
  await wait('second test profile ready',async()=>(await fetch('http://127.0.0.1:18957/json/version')).ok);
  browser=await chromium.connectOverCDP('http://127.0.0.1:18957');
  const second=await wait('conflict workspace',()=>pages().find(p=>/^http:\/\/127\.0\.0\.1:\d+\/app\/workspaces\//.test(p.url())));
  const settings=await wait('system registration conflict surfaced',()=>second.evaluate(()=>window.__TAURI__.core.invoke('clipboard_translation',{request:{kind:'settings'}})));
  assert.equal(settings.shortcutError,'Translation shortcut is already in use');
  await second.locator('.quick-tools-menu > summary').click();await second.locator('[data-tool-launcher-open="com.zicode.translate:open"]').first().click();
  const notice=await second.evaluate(async()=>(await import('/i18n.js')).t('Translation shortcut is already in use'));
  await second.locator('summary').filter({hasText:await second.evaluate(async()=>(await import('/i18n.js')).t('Clipboard translation settings'))}).click();
  await second.getByText(notice,{exact:true}).waitFor();
  console.log('PASS another process owns native hotkey before launch; Studio gives visible registration-conflict feedback');
 }finally{reserving.stdin.end('\n');}
} finally {await browser?.close().catch(()=>{});app?.kill();server.closeAllConnections();server.close();}
