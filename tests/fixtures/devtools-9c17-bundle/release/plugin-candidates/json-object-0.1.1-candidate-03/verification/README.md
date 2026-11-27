# Replaying provider functional cases

Requires Python 3.10+ and Node.js with WASI Preview 1 support. From this directory run:

```powershell
python verification/verify_json_object_wasi.py --output $env:TEMP\json-object-replay-proof.json
```

The packaged script checks the module hash, runs every stored request through the WASI module, and compares exact response bytes to the included expected files. This proves provider behavior only; it does not simulate Studio Host capture, transfer confirmation, save, permissions or installation. Native/WASI and Wasmtime fuel/cold proofs are included as signed-by-hash evidence, not a signature.
