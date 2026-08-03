# Plugin installation and trust

ZiCode application plugins are separate from Pi extensions. Application plugins can contribute
navigation, function views, main views, commands, and capabilities callable from Chat. Pi
extensions are loaded only by a Pi Runtime.

## Manage plugins

Open **Manage plugins** in the navigation. Enablement and permissions are stored per scene.

- **Install local plugin** selects a development directory and is only for code you fully trust.
- **Install signed package** selects a `.zicode-plugin`; every file hash and the publisher signature
  are verified before installation.
- **Enable/disable** affects only the current scene.
- **Rollback** activates a retained older version after an update.
- **Revoke publisher** removes that publisher's active registrations and rejects later packages.

## First trust

A valid signature does not automatically make a publisher trusted. On first installation, verify
the publisher name, 64-character key fingerprint, and requested permissions. ZiCode stores the
public key only after confirmation. Do not trust a package based on its displayed name alone.

Fully trusted local Developer plugins may register Capabilities and Commands in a Worker. The
Command Palette, plugin Views, and Chat invoke them through the Host Broker; each call runs in a
time-limited process without DOM, network, filesystem, or environment-variable APIs.

Signed plugin views run in isolated iframes. Public third-party background Workers remain disabled;
a signature is not a replacement for WASI or an operating-system sandbox.
