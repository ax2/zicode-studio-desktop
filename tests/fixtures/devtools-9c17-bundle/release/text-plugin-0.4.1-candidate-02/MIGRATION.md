# Migration to Text plugin 0.4.1

This candidate adds the required Studio `tool.directory.v1@1.0.0-preview.1` profile and per-capability categories, descriptions, and English/Chinese aliases. The seven capability IDs and compute input/output contract are unchanged. Compared with 0.4.0, this build uses a single-pass strict JSON visitor and includes fresh Wasmtime fuel and cold-start evidence for the exact module hash. Hosts that do not implement the required directory profile must keep using the previous Text 0.3.0 candidate. The candidate is unsigned and is not Host-accepted.
