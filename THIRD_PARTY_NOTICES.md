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
