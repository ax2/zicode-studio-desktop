# ZiDevTools Inspect 0.1.2 candidate

This independent unsigned candidate adds the exact Studio profile `tool.open.v1@=1.0.0-preview.1` to Inspect 0.1.1. Its single `location: main` View maps each of its eight declared capability IDs to the matching operation selector. The callback only selects/focuses the UI and returns `opened`, `not_found` or `unsupported`; it does not invoke capabilities or perform file/service/network work.

The frozen 0.1.1 candidate is unchanged. Runtime WASM is byte-identical to that candidate; only the manifest, package metadata, View, contract snapshot and verification evidence differ. This is an unsigned provider candidate, not a Studio Host acceptance result.
