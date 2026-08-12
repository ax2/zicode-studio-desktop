# Data, security, and backup

ZiCode is local-first: conversations, notes, tasks, and plugin data stay in application-managed storage, while sensitive credentials are delegated to the operating-system credential store.

## Credential storage

- Windows stores scene and provider API keys in Credential Manager.
- Ordinary configuration files keep only non-sensitive indexes.
- Compatibility authentication files are materialized briefly for runtime startup and removed after loading.
- Help, project archives, logs, and exports must never contain secrets.

## Scene boundaries

Each scene has its own model configuration, credentials, and runtime directory. Renaming or deleting a provider also cleans up its associated credential.

## Mobile and remote access

Remote access is off by default. While off, the Host listens only on `127.0.0.1`. After you explicitly
enable it in desktop **Settings → Remote access** and restart, the Host starts HTTPS/WSS on private LAN
addresses.

Remote security foundations are already enforced: non-local connections must use a paired-device
identity, HTTP data requests require the device token, and a remote device cannot issue more pairing
credentials. An unpaired or expired link blocks workspace access and asks for a new link from the
trusted desktop app. An external WebSocket Origin must also exactly match an advertised HTTPS address.

Both QR modes in **Open on Mobile** can be requested only through a local loopback connection. Even a
paired phone with a valid device token cannot use the HTTP QR endpoint to issue another pairing
credential.

Open **Settings → Remote access** on the desktop to review paired devices, pairing time, recent
activity, and revocation state. Revocation requires a second confirmation; it invalidates the token
and closes an active remote connection within a few seconds. Repeated failed pairing exchanges are
temporarily rate-limited.

For first-time setup, open the **Phone trust setup** HTTP address shown in Settings on the phone, then
download and install the public CA certificate. That port does not serve the main app or data APIs.
Before installation, compare the fingerprint on the phone page character-for-character with the
trusted desktop Settings page. Do not install it if they differ. The CA private key stays only in the
operating-system credential vault.

ZiCode on a phone is a secure client of the desktop host. Pi, workspace files, and tool execution
remain on that host and are not copied to a connected device. Upstream Pi can run independently on
Android through Termux, but the current ZiCode client neither connects to nor manages that process.
There is currently no equivalent local Pi runtime path on iOS.

The Android system share target accepts only bounded titles, text, web addresses, and supported
images. Incoming content arrives through POST and is never written to a URL or the Cache API. Text
is deleted as soon as the tab reads it. Images use a one-time IndexedDB inbox with a random ID,
ten-minute expiry, and strict capacity limits, and are deleted before entering the image pipeline.
Nothing is ever sent automatically.

Unsent phone text and bounded image drafts are encrypted separately with a browser-generated,
non-extractable 256-bit AES-GCM `CryptoKey`. The key and ciphertext remain in same-origin IndexedDB.
Drafts are session-isolated: text is limited to 32,768 characters, while image recovery keeps four
images, 8 MB per image and 12 MB total, for the three most recent sessions with images. Records expire
after seven days. This keeps text and image plaintext out of storage at
rest, but is not end-to-end encryption and cannot defend against script already executing in the
ZiCode origin. Successful submission or clearing site data deletes the corresponding draft.

An explicitly requested offline send stores only an encrypted, session-scoped marker; it does not duplicate
the prompt outside the draft ciphertext described above. The marker expires after 24 hours. Reconnection
only reveals a confirmation bar and never sends to a model automatically. Cancelling the intent preserves
the draft, while successful submission or clearing site data removes both.

## Backup guidance

| Data | Recommendation |
|---|---|
| Notes and project files | Include in regular file backups or version control |
| Conversations (sessions) | Use **Settings → General → Export session backup** for readable JSON |
| Application data | Back up consistently after closing the application |
| API keys | Keep recovery with the provider, never in backup documentation |
| Astro output | Rebuildable; do not treat it as the only source |

> Restoring ordinary files to a new computer does not restore API keys. Enter them again into the system credential store.

Session backup is a read-only export containing the full message history and project paths,
never credentials; the JSON file is directly readable and suitable for archiving or pre-migration retention.

To restore, open **Settings → General → Import session backup** and pick a previously
exported JSON file. Entries are validated per item (the session id must match the first
line of its content, paths must belong to the current workspace, each entry is capped at
10 MiB, and the total at 50 MiB); existing session ids are skipped rather than overwritten.
Imported conversations appear in the sidebar and are ready for migration or recovery.

## Workspace data snapshots

The app snapshots the current workspace automatically on startup (at most once per
day) and on demand from **Settings → General → Workspace data backup**: sessions,
notes, artifacts, tasks, automations, and finance data are copied to
`~/.zicode/backups/<workspace>/`, keeping the newest 7 per workspace. Backups live
outside the workspace data, so accidental deletion or corruption can be recovered by
restoring from a snapshot. Restoring replaces the current workspace data and
automatically snapshots the current state first (it appears in the backup list),
making the operation reversible; restart the app afterwards to load the restored
data. Deleting a backup requires confirmation.

Note deletion always goes through trash first (including whole notebooks), with
30-day retention; session and automation deletion require confirmation. Core data
therefore has three layers of protection: trash, snapshots, and exports.
