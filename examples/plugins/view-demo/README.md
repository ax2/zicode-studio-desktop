# View Demo

This package is a self-contained local Developer plugin for the ZiCode Plugin API v1 View
contract.

Install the `view-demo` directory from **Plugin Manager → Install local plugin**, grant any
declared permissions, then enable it for the current scene. The example intentionally declares no
filesystem, network, clipboard, secret, or Pi permissions.

Both HTML entries are self-contained because the first View runtime does not permit direct package
asset or network requests. ZiCode injects `window.zicode` before plugin scripts run.

The example demonstrates:

- sidebar and main View Contributions;
- Host context through the message SDK;
- a Host notification;
- `setDirty(true)` and navigation blocking;
- an opaque `sandbox="allow-scripts"` iframe without `allow-same-origin`.
- an independently spawned, DOM-less JavaScript Worker Runtime;
- a View-to-Host-to-Worker Capability call through `example.echo`.
- a command-palette-to-Host-to-Worker command through `example.echoCommand`.
