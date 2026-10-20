"""Run the diagnostics View in Chromium with the real WASI adapter over loopback."""
import argparse
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import wasmtime
from cdp_client import DevTools

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / 'plugins/diagnostics/views/main.html'
parser = argparse.ArgumentParser()
parser.add_argument('--wasm', type=Path, required=True)
parser.add_argument('--engine-provenance', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
wasm_path = args.wasm.resolve()
module_bytes = wasm_path.read_bytes()
assert len(module_bytes) <= 2 * 1024 * 1024
module_sha = hashlib.sha256(module_bytes).hexdigest()
identity = json.loads(args.engine_provenance.read_text(encoding='utf-8'))
from wasmtime import _ffi
assert Path(_ffi.dll._name).resolve() == Path(identity['dllPath']).resolve()
assert hashlib.sha256(Path(_ffi.dll._name).read_bytes()).hexdigest() == identity['dllSha256']
config = wasmtime.Config()
config.consume_fuel = True
config.epoch_interruption = True
config.max_wasm_stack = 2 * 1024 * 1024
engine = wasmtime.Engine(config)
module = wasmtime.Module(engine, module_bytes)

def invoke(capability_id, payload):
    request = dict(pluginId='com.zicode.devtools.diagnostics', sceneId='view-proof',
                   capabilityId=capability_id, commandId=None, input=payload)
    encoded = json.dumps(request, ensure_ascii=False, separators=(',', ':')).encode()
    with tempfile.TemporaryDirectory(prefix='zidiag-view-') as temporary:
        folder = Path(temporary)
        (folder / 'stdin').write_bytes(encoded)
        wasi = wasmtime.WasiConfig()
        wasi.stdin_file = str(folder / 'stdin')
        wasi.stdout_file = str(folder / 'stdout')
        wasi.stderr_file = str(folder / 'stderr')
        with wasmtime.Store(engine) as store:
            store.set_limits(memory_size=64 * 1024 * 1024)
            store.set_fuel(10_000_000)
            store.set_epoch_deadline(1)
            store.set_wasi(wasi)
            linker = wasmtime.Linker(engine)
            linker.define_wasi()
            timer = threading.Timer(5, engine.increment_epoch)
            timer.start()
            try:
                instance = linker.instantiate(store, module)
                instance.exports(store)['_start'](store)
                output = (folder / 'stdout').read_bytes()
                assert not (folder / 'stderr').read_bytes()
                assert len(output) <= 48 * 1024
            finally:
                timer.cancel()
                timer.join()
    return json.loads(output)

class Handler(http.server.BaseHTTPRequestHandler):
    calls = []
    html = ''
    def do_GET(self):
        body = self.html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        assert 0 < length <= 48 * 1024
        request = json.loads(self.rfile.read(length))
        Handler.calls.append(request['capabilityId'])
        response = invoke(request['capabilityId'], request['input'])
        body = json.dumps(response, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

sdk = r'''<script>
window.zicode={ready:async()=>{},context:{get:async()=>({})},setDirty:()=>{},capabilities:{invoke:async(id,input)=>{
const r=await fetch('/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capabilityId:id,input})});
return await r.json();}}};
window.addEventListener('load',()=>{(async()=>{
const wait=async test=>{const end=Date.now()+12000;while(Date.now()<end){if(test())return;await new Promise(r=>setTimeout(r,25));}throw Error('view wait timeout')};
await wait(()=>document.querySelector('#run')&&!document.querySelector('#run').disabled);
const select=document.querySelector('#operation'), results=[], actions=[...select.options].map(o=>o.value);
for(const id of actions){select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));
document.querySelector('#sample').click();document.querySelector('#run').click();
await wait(()=>document.querySelector('#status').textContent==='分析完成。');
const report=JSON.parse(document.querySelector('#output').textContent);
if(report.diagnosticsProtocol!=='2.0.0-rc.1'||!report.generatedBy?.toolId||!report.generatedBy?.toolVersion||!report.generatedBy?.runtimeFingerprint?.sha256||typeof report.data!=='object')throw Error('wrong report envelope '+id);
}
const expected=actions.map(id=>'devtools.diagnostics.'+id);
if(JSON.stringify(window.__calls)!==JSON.stringify(expected))throw Error('unexpected invocation list');
const row={theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',width:innerWidth,height:innerHeight,devicePixelRatio,pass:true,calls:window.__calls.length,actions,actualWasi:true};
document.documentElement.setAttribute('data-proof',encodeURIComponent(JSON.stringify(row)));
})().catch(e=>document.documentElement.setAttribute('data-proof-error',String(e)))});
</script>'''
# Record exactly the calls crossing the public SDK-shaped boundary.
sdk = sdk.replace("const r=await fetch", "(window.__calls||(window.__calls=[])).push(id);const r=await fetch")
view_html = VIEW.read_text(encoding='utf-8')
Handler.html = view_html.replace('<script>\n(() => {', sdk + '\n<script>\n(() => {', 1)
assert Handler.html != view_html
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
edge = shutil.which('msedge.exe') or shutil.which('chrome.exe')
for candidate in [
    Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe',
    Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
]:
    if edge is None and candidate.is_file():
        edge = str(candidate)
assert edge, 'Install Microsoft Edge or Google Chrome for the browser proof'
local_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open
results = []
try:
    for theme, width, height in [('light', 1180, 900), ('dark', 390, 844)]:
        Handler.calls = []
        with tempfile.TemporaryDirectory(prefix='zidiag-browser-profile-') as profile:
            command = [edge, '--headless=new', '--disable-gpu', '--no-first-run',
                       '--no-default-browser-check', '--disable-extensions',
                       '--disable-background-networking', '--no-proxy-server', f'--user-data-dir={profile}',
                       '--remote-debugging-port=0', '--window-size=1280,1000', 'about:blank']
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            cdp = None
            try:
                port_file = Path(profile) / 'DevToolsActivePort'
                deadline = time.monotonic() + 15
                while not port_file.is_file() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.05)
                assert port_file.is_file(), 'Chromium did not open its DevTools endpoint'
                port = int(port_file.read_text(encoding='utf-8').splitlines()[0])
                target = None
                deadline = time.monotonic() + 15
                while target is None and time.monotonic() < deadline:
                    try:
                        with local_open(f'http://127.0.0.1:{port}/json/list', timeout=2) as response:
                            targets = json.load(response)
                        target = next((entry for entry in targets if entry.get('type') == 'page'), None)
                    except (OSError, urllib.error.URLError, json.JSONDecodeError):
                        pass
                    if target is None:
                        time.sleep(.1)
                assert target, 'Chromium did not expose an initial page target'
                cdp = DevTools(target['webSocketDebuggerUrl'])
                cdp.command('Page.enable')
                cdp.command('Runtime.enable')
                cdp.command('Log.enable')
                cdp.command('Emulation.setDeviceMetricsOverride',
                            {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 650})
                cdp.command('Emulation.setEmulatedMedia',
                            {'features': [{'name': 'prefers-color-scheme', 'value': theme}]})
                cdp.command('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/'})
                deadline = time.monotonic() + 45
                encoded_proof = None
                while time.monotonic() < deadline:
                    encoded_proof = cdp.evaluate("document.documentElement.getAttribute('data-proof')")
                    error = cdp.evaluate("document.documentElement.getAttribute('data-proof-error')")
                    if error:
                        raise AssertionError(urllib.parse.unquote(error))
                    if encoded_proof:
                        break
                    time.sleep(.05)
                assert encoded_proof, 'View did not finish its operation suite'
                row = json.loads(urllib.parse.unquote(encoded_proof))
                assert row['pass'] and row['actualWasi'] and row['actions']
                assert row['calls'] == len(row['actions']) == 11
                assert Handler.calls == ['devtools.diagnostics.' + action for action in row['actions']]
                assert row['theme'] == theme and row['width'] == width and row['height'] == height, row
                for _ in range(3):
                    cdp.evaluate('0')
                    time.sleep(.05)
                page_errors = [event for event in cdp.events
                               if event.get('method') == 'Runtime.exceptionThrown'
                               or (event.get('method') == 'Log.entryAdded'
                                   and event.get('params', {}).get('entry', {}).get('level') == 'error')
                               or (event.get('method') == 'Runtime.consoleAPICalled'
                                   and event.get('params', {}).get('type') == 'error')]
                assert not page_errors, page_errors
                screenshot = cdp.command('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
                screenshot_path = args.output.parent / f'view-{theme}.png'
                screenshot_bytes = base64.b64decode(screenshot['data'])
                screenshot_path.write_bytes(screenshot_bytes)
                row['screenshot'] = screenshot_path.name
                row['screenshotSha256'] = hashlib.sha256(screenshot_bytes).hexdigest()
                row['pageErrors'] = page_errors
                results.append(row)
            finally:
                if cdp:
                    try:
                        cdp.command('Browser.close')
                    except Exception:
                        pass
                    cdp.close()
                if process.poll() is None:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
finally:
    server.shutdown()
    server.server_close()
proof = dict(wasmSha256=module_sha, viewSha256=hashlib.sha256(VIEW.read_bytes()).hexdigest(),
             browser=Path(edge).name, results=results, offlinePass=True,
             limitations=['Actual Chromium View with injected public SDK-shaped bridge',
                           'Each action invokes the actual WASI module through a loopback-only harness',
                           'Not Studio bridge, permissions, package lifecycle, or Host acceptance'])
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f"View proof passed: {proof['browser']}; {len(results)} themes/viewports; {sum(len(r['actions']) for r in results)} actual WASI calls")
