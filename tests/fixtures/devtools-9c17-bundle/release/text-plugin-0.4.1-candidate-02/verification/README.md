# Replaying the independent runtime proofs

The package is an unsigned provider directory, not a Studio Host acceptance result. Replaying requires Windows PowerShell, Python 3.13, network access for the hash-pinned Wasmtime 36.0.2 C-API archive, and the package files. From the repository root, create a new cache under `target` and record its local engine identity:

```powershell
py -3.13 verification/bootstrap_engine.py --cache-dir target/text-plugin-wasmtime-36.0.2 --provenance target/text-plugin-engine.json
$env:PYTHONPATH = (Resolve-Path target/text-plugin-wasmtime-36.0.2).Path
py -3.13 verification/verify_fuel.py --wasm release/text-plugin-0.4.1-candidate-02/runtime/tools.wasm --fixtures release/text-plugin-0.4.1-candidate-02/fixtures/budget --output target/text-plugin-fuel --text-results --engine-provenance target/text-plugin-engine.json
py -3.13 verification/verify_cold.py --wasm release/text-plugin-0.4.1-candidate-02/runtime/tools.wasm --fixtures release/text-plugin-0.4.1-candidate-02/fixtures/budget --output target/text-plugin-cold.json --engine-provenance target/text-plugin-engine.json
```

The packaged fuel/cold proofs bind the WASM digest, raw requests, exact expected response bytes, Wasmtime native DLL digest and all 43 case IDs. They do not test Studio's production Worker, UI bridge, Pi authorization, install lifecycle or Host pipe behavior.
