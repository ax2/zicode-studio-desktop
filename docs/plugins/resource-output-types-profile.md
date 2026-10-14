# Resource output types profile (preview)

`resource.output.types.v1` at `1.0.0-preview.1` negotiates the Host's fixed MIME index table for WASI resource outputs. It is implemented in the current Studio source but is not a stable `resource.v1` API or a released provider contract. A producer that uses indices 5–26 must require this profile so an older Host rejects its package at admission instead of failing after execution.

The manifest must use `schemaVersion: 2`, declare a WASI module, `resourceInputProfile: "resource.wasi.input.draft2"`, `resourceOutputProfile: "resource.wasi.output.draft1"`, and an output contract (`outputSchema` or `maxResultBytes`) for its JSON result. Its `requiredProfiles` must include both `"resource.output.types.v1": "=1.0.0-preview.1"` and `"output.schema.v1": "=1.0.0-rc.1"`. Unknown or incompatible requirements fail package validation. The first five legacy indices remain usable without this new requirement; the Host rejects an extended output type before resource publication if the package did not declare it.

| Index | MIME | Saved suffix |
| ---: | --- | --- |
| 0 | `application/octet-stream` | `.bin` |
| 1 | `image/png` | `.png` |
| 2 | `image/jpeg` | `.jpg` |
| 3 | `image/webp` | `.webp` |
| 4 | `text/plain` | `.txt` |
| 5 | `application/x-zicode-archive-zip` | `.zip` |
| 6 | `application/x-zicode-archive-sevenzip` | `.7z` |
| 7 | `application/x-zicode-archive-tar` | `.tar` |
| 8 | `application/x-zicode-archive-targzip` | `.tar.gz` |
| 9 | `application/x-zicode-archive-tarzstd` | `.tar.zst` |
| 10 | `application/x-zicode-archive-tarxz` | `.tar.xz` |
| 11 | `application/x-zicode-archive-tarlzma` | `.tar.lzma` |
| 12 | `application/x-zicode-archive-tarbzip2` | `.tar.bz2` |
| 13 | `application/x-zicode-archive-tarlz4` | `.tar.lz4` |
| 14 | `application/x-zicode-archive-gzip` | `.gz` |
| 15 | `application/x-zicode-archive-zstandard` | `.zst` |
| 16 | `application/x-zicode-archive-xz` | `.xz` |
| 17 | `application/x-zicode-archive-lzma` | `.lzma` |
| 18 | `application/x-zicode-archive-bzip2` | `.bz2` |
| 19 | `application/x-zicode-archive-lz4` | `.lz4` |
| 20 | `application/x-zicode-archive-brotli` | `.br` |
| 21 | `application/x-zicode-archive-rar` | `.rar` |
| 22 | `application/x-zicode-archive-cab` | `.cab` |
| 23 | `text/csv` | `.csv` |
| 24 | `text/markdown` | `.md` |
| 25 | `text/html` | `.html` |
| 26 | `application/x-zicode-sqlite` | `.sqlite` |

The table is append only. One invocation may publish at most four outputs totaling 32 MiB. The Worker and Host check the frame, lengths and SHA-256; the Host also checks source authorization and the declared JSON output contract. The MIME label controls the fixed suffix and limited preview, not content parsing or proof that bytes form a valid archive or database. A plugin cannot supply a destination path or override an existing file. Cross-tool transfer and managed save each require a separate desktop confirmation.

Current conformance evidence: manifest admission tests cover missing runtime fields, missing output schema profile and incompatible versions; Host publication tests cover rejection without the profile. The real Windows HTTP Host → current Studio Worker fixture produces index 5 (ZIP) and indices 25/26 (HTML/SQLite), then verifies confirmed save and typed cross-plugin transfer. These are Studio synthetic modules. Provider packages, content semantics, native ZiFile Worker, rendered UI and macOS/Linux still need their own acceptance evidence.
