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
const translations=new Map([[en,'请将剪贴板中的这句话翻译成中文。'],[zh,'Please translate this sentence from the clipboard into English.']]);
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
  await wait('translated popup for '+text,async()=>(await popup.locator('#result').inputValue())===translations.get(text));
  assert.equal(await popup.locator('#source-text').inputValue(),text);
  assert.equal(await popup.locator('#target-language').inputValue(),text===zh?'English':'Chinese');
  assert.equal(await visible(),false);
 }
 await translated(en);console.log('PASS external app copy -> native shortcut -> popup (English to Chinese), main stays hidden.');
 await clipboard('empty');await wait('empty clipboard state',async()=>await popup.locator('#source-text').inputValue()==='' && !!(await popup.locator('#status').innerText()));
 assert.equal(requests.length,1);console.log('PASS empty clipboard issues no request');
 failNext=true;await clipboard('copy',zh);await wait('service rejection state',async()=>requests.length===2 && await popup.locator('#retry').isVisible() && await popup.locator('#result').inputValue()==='');
 await popup.locator('#retry').click();await translated(zh);
 console.log('PASS error recovery and Chinese to English');
 await popup.bringToFront();await popup.locator('#copy').click();
 assert.equal(await clipboard('read'),translations.get(zh));console.log('PASS copying popup result');
 await popup.locator('#workbench').click();
 await wait('workbench restored with original',async()=>await visible() && await main.locator('.translate-textarea').inputValue()===zh);
 await wait('translated output present in workbench',()=>main.evaluate(text=>[...document.querySelectorAll('textarea')].some(el=>el.value===text)||document.body.innerText.includes(text),translations.get(zh)));
 assert.deepEqual(requests,[en,zh,zh]);console.log('PASS handoff restores Studio with source and translation without another request');
} finally {await browser?.close().catch(()=>{});app?.kill();server.closeAllConnections();server.close();}
