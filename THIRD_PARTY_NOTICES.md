# Third-party notices

Release artifacts contain or derive from the following projects.

## Picot

- Source: <https://github.com/shixin-guo/picot>
- License: MIT
- Use: original desktop UI and native Pi integration baseline

The original MIT notice is retained in `LICENSE` and attribution is retained in
`NOTICE`.

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
