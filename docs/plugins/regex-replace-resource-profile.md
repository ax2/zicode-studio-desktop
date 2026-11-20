# Regex replacement resource execution — 1.0.0-preview.1

This Windows development profile is explicitly negotiated as
`resource.wasi.regex.replace.v1 =1.0.0-preview.1`. It does not change the ordinary
compute or resource execution budgets. Candidate packaging alone is not Host
acceptance; consult the delivery receipt for actual runtime evidence.

## Admission and ordered inputs

A schema-2 WASI manifest must declare `resource.read`, require `output.schema.v1`
and `resource.output.types.v1`, and negotiate the exact execution profile above.
Exactly one contributed capability selects this execution profile. It must
declare an output schema and `resourceInputMax: 2`. Runtime profiles are
`resource.wasi.input.draft2` and `resource.wasi.output.draft1`. A text-only provider
also negotiates `resource.input.types.v1 =1.0.0-preview.1` and declares
`resourceInputMimeTypes: ["text/plain"]`.

There are exactly two ordered, independently confirmed resources:

| Index | Role | MIME | Maximum UTF-8 bytes |
| --- | --- | --- | --- |
| 0 | Input text | text/plain | 2,097,152 |
| 1 | Replacement template | text/plain | 65,536 |

Either resource may be empty. The pattern is a bounded string parameter, with a
4,096 UTF-8 byte limit enforced by the provider. A successful result is at most
2,097,152 UTF-8 bytes; the original provider permits at most 1,000 matches and
rejects the whole operation on overflow. Input files are never rewritten.

The generic directory descriptor adds `resourceInputMin: 2` and
`resourceInputLabels: ["Input text", "Replacement template"]` for this negotiated
profile. These are Host-generated metadata, not arbitrary manifest controls.
The picker labels each role, disables confirmation until the count and size
checks pass, and offers explicit reordering. Reordering revokes any previous
grants and requires a new user confirmation; it does not read or re-share files.

An exact ordered set of Host-labelled text-only inputs also offers a paste mode.
Text stays private until its explicit confirmation control is activated, then
uses the same scoped resource upload/commit path. Editing invalidates previous
grants; cancellation keeps editor text. Switching between paste and file modes
keeps the pasted draft in that mounted tool's memory and never shares it again
automatically. This is not a durable draft store across tool closure or restart.

## Execution and lifecycle

The trusted Host selects the execution profile from the installed capability;
the caller cannot select a budget. This profile uses 1,000,000,000 Wasmtime fuel
and the existing 256 MiB resource guest-memory ceiling with a 2 MiB stack.
The producer module may impose a stricter memory maximum. The parent enforces
a 10-second deadline including fresh compilation. This is an execution ceiling,
not a guarantee that every valid regular expression completes within it.

Heavy calls share the existing image execution reservation pool: at most two
globally, one per plugin, with the existing 512 MiB reservation per slot. The
ordinary resource admission pool remains in force as well. The ordinary
10,000,000 fuel / 5-second execution policy and image policy are unchanged.
The memory ceiling is guest linear memory, not a process resident-memory limit.

All existing runtime/session ownership, resource confirmation, content digest,
capability permission, package identity, cancellation, revocation, disabled
plugin and final publication checks still apply. No raw path, environment,
network, clipboard or filesystem-write access is granted to the module.

## Internal Worker framing and guest ABI

Input starts with bytes `5a 49 52 57 00 00 00 02`, then a little-endian u32 JSON
header length, the JSON header, the module bytes, then each resource's bytes in
order, and EOF. The header is at most 256 KiB and contains `profile`
(`resource.wasi.input.draft2`), `request`, `module` (`byteLength`, `sha256`), and
`resources` (`resourceId`, `contentVersion`, `mimeType`, `byteLength`). The module
is 1 byte–2 MiB. IDs, lengths, digests, duplicate IDs, trailing and missing bytes are
validated before execution. `workerPath` is not opened in module-snapshot mode.

The WASI stdin envelope contains `pluginId`, `sceneId`, `capabilityId`,
`commandId`, `input`, `resourceInputProfile`, `resourceOutputProfile`, and
`resources` descriptors with an additional ordered `index`. The guest reads
confirmed bytes only through `zicode_resource_input_draft1`:

- `size(index: i32) -> i64`
- `read(index: i32, offset: i64, destination: i32, length: i32) -> i32`

The guest publishes a separate complete raw text resource using
`zicode_resource_output_draft1`:

- `create(mime: i32, length: i64) -> i32` — text/plain MIME code is 4.
- `write(index: i32, source: i32, length: i32) -> i32`
- `finish(index: i32) -> i32`

Pointers address guest linear memory. Each read/write chunk is at most 65,536
bytes. The module writes one small JSON result to stdout; full text is never
embedded in stdout. Business errors publish no partial output resource.

The Worker output is bytes `5a 49 57 4f 00 00 00 01`, a little-endian u32 JSON
header length, JSON, raw output bytes, and EOF. Header fields are `schemaVersion`
(1), `profile` (`resource.wasi.output.draft1`), `result`, and `resources`
(`index`, `mimeType`, `byteLength`, `contentVersion`). Output SHA-256 and exact
length are verified. This binary output does not itself constitute a saved file
or a grant to another plugin. Explicit preview, save and transfer rules remain.

## Scope

The directory-owned preview for this exact execution profile can read and
verify a complete text result up to 2 MiB in 32 KiB chunks and displays it in a
bounded readonly editor with an explicit Select all control. Other text
resource previews retain their 128 KiB ceiling. Raw resource bytes and their
digest remain authoritative; browser editor line-ending normalization is not a
raw-byte save or clipboard-fidelity guarantee.

This extension permits a full-sized resource-based replacement preview, with
the current generic parent providing paste and file inputs. It does not deliver source-file overwriting, undo, a
file-watching workflow, other-platform acceptance or a signed distribution.
