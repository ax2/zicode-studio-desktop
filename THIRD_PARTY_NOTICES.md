# Third-party notices

Release artifacts bundle the dependencies below; historical architecture references are also recorded.

## Picot

- Source: <https://github.com/shixin-guo/picot>
- License: MIT
- Use: historical inspiration for the Pi desktop-wrapper architecture; not a direct fork and not tracked upstream

The original MIT notice is retained in `LICENSE` and attribution is retained in
`NOTICE`.

According to the maintainer's historical account, Picot forked Tau
(<https://github.com/deflating/tau>). Picot's original public URL is inaccessible
as of 2026-10-10; Tau is retired. Existing historical copyright notices are
preserved independently of the current repository's fork status.

## Tau

- Source: <https://github.com/deflating/tau>
- License: MIT; Copyright (c) 2026 deflating
- Use: retained early repository history and historical UI lineage; no ongoing synchronization

The MIT copyright notice is included in `LICENSE`.

## Pi

- Source: <https://github.com/earendil-works/pi>
- Locked version: `scripts/pi-version.json`
- Use: embedded agent runtime

The official release archive includes Pi's license and package notices.

## Git for Windows / PortableGit

- Source: <https://github.com/git-for-windows/git>
- Locked version and hashes: `scripts/portable-git-version.json`
- Use: embedded `git.exe`, `bash.exe`, Unix utilities, and supporting runtime

PortableGit contains its upstream license and documentation files. The project
does not remove those files when packaging.

## Microsoft Edge WebView2

- Source: Microsoft WebView2 Runtime
- Use: Tauri WebView runtime

The NSIS installer carries a SHA-256-pinned Microsoft Evergreen Standalone
Installer and invokes it only when WebView2 is absent. Installation does not
depend on a network bootstrapper. Microsoft's runtime license applies.

## tray-icon Windows compatibility backport

- Source: <https://github.com/tauri-apps/tray-icon/tree/tray-icon-v0.23.1>
- Version: 0.23.1 with a local NOTIFYICONDATAW size initialization correction.
- License: MIT OR Apache-2.0; original license files retained under `vendor/tray-icon/`.
- Patch provenance and removal condition: `vendor/tray-icon/STUDIO-PATCH.md`.

## Whatlang

- Source: <https://github.com/greyblake/whatlang-rs/tree/584009bbdbd715681fc1c144ac986814104bedbc>
- Locked version: 0.18.0
- Use: local language detection for Windows clipboard translation

```text
(The MIT License)

Copyright (c) 2017 Sergey Potapov <blake131313@gmail.com>
Copyright (c) 2014 Titus Wormer <tituswormer@gmail.com>
Copyright (c) 2008 Kent S Johnson
Copyright (c) 2006 Jacob R Rideout <kde@jacobrideout.net>
Copyright (c) 2004 Maciej Ceglowski

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
