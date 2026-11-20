# Markdown preview and HTML export candidate

Independent unsigned plugin `com.zicode.devtools.markdown` 0.1.0, source tool
`markdown` 1.0.1. The native Rust UI remains standalone. The shared
`zi-markdown-core` supplies exactly the same sanitized parser events and complete
HTML export to native and WASI adapters. The native conformance executable is a
test fixture only and is never required by Studio.

Explicitly provide one UTF-8 text resource, including empty content, up to 2 MiB.
Like the native file reader, content decides acceptance rather than filename or
transport MIME. A single leading BOM is removed. Tables, task lists,
strikethrough, code, quotes and footnotes follow the native parser. The original
200000-event and 16 MiB HTML limits remain. Source bytes are never modified.

Raw HTML is escaped; images become emphasized alt text. HTTP(S) and fragment
links use the existing native allowlist, including ordinary HTTP(S) userinfo.
No image, link, model, service, stylesheet or file is automatically fetched.
The complete output HTML includes the native document template and restrictive
CSP. Studio must independently keep its parent preview inert and require an
explicit separate save/download action. No overwrite or source-path authority
is granted by this plugin.

This candidate requires the exact bundled `resource.wasi.markdown.v1`
`1.0.0-preview.1` contract, snapshot input draft2 and output draft1. The complete
HTML travels as a resource, never as a truncated small JSON result. Budget:
256 MiB guest memory, one billion fuel and a 10-second Host deadline.

Native/production Worker conformance is required before freezing. Frozen bytes
and external receipts remain immutable. Windows installation, rendered preview,
managed save and user-data acceptance are separate delivery gates; this source
directory alone does not claim those gates have passed. Signing and other
platforms do not block verified current-Windows scope.
