# Host Resource Input Profile

Status: implemented in Studio as a preview contract for narrowly allowlisted built-in receivers. This is a Studio-owned extension; it does not change the ZiDevTools package ABI or make arbitrary plugin manifests eligible for Host execution.

## Contract

- Profile requirement: `resource.host.input.v1 =1.0.0-preview.1`.
- Runtime declaration: `resourceInputProfile: resource.host.image-input.v1`.
- The OCR capability declares `resourceInputProfile: resource.host.ocr-input.v1` at capability scope; it does not change the manifest-wide WASI input profile.
- The text inspector declares `resourceInputProfile: resource.host.text-input.v1` at manifest scope.
- Admitted targets are the built-in `com.zicode.resource-inspector/image.inspect`, `com.zicode.text-inspector/text.inspect`, and, on Windows only, `com.zicode.ocr/ocr.resource-text`.
- The OCR receiver is a distinct capability from the ordinary `ocr.text` interface. It accepts only a language choice; the image comes from the confirmed Host resource, never from a plugin-supplied path or data URL.
- The receiver must be enabled and hold the `resource.read` grant. Host checks the profile, built-in origin, capability, session, current resource proof and grant at transfer preparation, commit and execution.
- The user confirms sharing in the trusted parent UI, then separately starts execution. No plugin iframe receives the resource handle or absolute path.
- The Host reads confirmed bytes from its bounded resource store. The image inspector returns image metadata; the text inspector returns a bounded UTF-8 preview and counts. Neither writes files, accesses the network, or forwards bytes to a third-party process.

## Image input limits

The preview accepts PNG, JPEG and WebP up to 20 MiB. Decoding is bounded to 20,000 pixels per side and a 256 MiB decoder allocation limit. MIME/decoder mismatch, unsupported formats and invalid images return the public `resource_input_invalid` error.

The image inspector returns `ok`, `mimeType`, `format`, `width`, `height` and `byteLength`, and creates no derived resource. The OCR receiver uses the existing Windows OCR engine and installed language packs, returns `ok`, recognized `text` and `charCount`, and has a 45-second child-process deadline. Only one OCR child runs at a time. Cancellation terminates its PowerShell child and temporary image files are removed on success or failure. After OCR succeeds, the Host creates one bounded `text/plain` derived resource tied to the confirmed OCR input and its provenance. It expires after 15 minutes unless the user separately confirms a transfer or save. The Host retains the existing one-use input grant and rechecks authorization before publishing the text resource.

## Text input limits

The cross-platform text inspector accepts only `text/plain` containing valid UTF-8, up to 32 MiB. It returns byte and character counts plus the first 4,096 Unicode scalar values, with `truncated` when more remain. The JSON output is capped at 32 KiB. Invalid UTF-8, mismatched MIME and oversized inputs fail without publishing another resource. It has no filesystem write or network permission.

## Compatibility boundary

This Host profile is not interchangeable with `resource.wasi.input.draft2`. ZiDevTools packages continue to use the WASI profile and remain independently installable. Adding another Host receiver requires a versioned contract, a narrowly scoped capability allowlist, data and execution limits, and conformance evidence. Adding a manifest string alone cannot grant Host code execution.

The image and text inspectors are cross-platform. OCR remains Windows-only because the current implementation depends on Windows.Media.Ocr and installed Windows language packs; the receiver is omitted from non-Windows catalogs. The Windows debug UI flow was exercised on 2026-10-16 with a synthetic image: image resize → explicit sharing → OCR execution → text output entry. This does not verify macOS/Linux OCR, cancellation/timeout, installed-language-pack failure, or save.

The nested output preview exposes “Send to tool” and opens the resource receiver directory with the source MIME type. A 2026-10-16 Windows run verified that `text/plain` excludes image receivers. The first run after adding the text inspector still showed an empty directory because the trusted parent UI kept a separate built-in receiver allowlist; the source of that gap has since been fixed, but the rebuilt desktop flow has not been rechecked after Computer Use was stopped by the user. See [Resource input type declaration](resource-input-type-declaration.md) for the versioned MIME contract. The Studio `ocr` application is disabled by default, so users must enable it before it can receive a shared image.
