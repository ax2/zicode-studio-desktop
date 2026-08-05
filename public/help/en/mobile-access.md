# Use ZiCode on a phone

ZiCode on a phone is a secure remote interface for the desktop host. Pi, project files, and tool
execution remain on the computer; the phone handles chat, Notes, and workflow controls. The current
ZiCode mobile client does not install Pi on the phone or run chat tools against the phone file system.

Upstream Pi separately supports its command-line client running locally on Android through
[Termux](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/termux.md).
That is a separate runtime mode: a Pi process in Termux does not automatically share ZiCode scenes,
sessions, credential storage, or plugins. There is currently no equivalent local Pi path for
iPhone or iPad. Connecting to a trusted desktop Host remains ZiCode's recommended mobile mode on
both Android and iOS.

## First connection

1. On the computer, open **Settings → Remote access**, enable secure mobile access, and restart ZiCode.
2. Put the phone and computer on the same trusted local network.
3. In the target chat, choose **Open on Mobile**, switch to **First-time setup**, and scan the certificate setup QR code.
4. Select Android or iPhone/iPad and compare the CA fingerprint exactly.
5. Download and trust the certificate. Return to the QR dialog and switch to **Open this chat**.
6. Scan the freshly generated session QR code. It expires after five minutes, can be used only once, and provides a refresh action after expiry.

> Phone trust setup uses a separate HTTP port that serves only the public CA and setup instructions. It never serves conversations, files, or pairing tokens.

## Install the certificate on Android

Menu names vary by manufacturer. Search system Settings for **Install certificate**, **CA certificate**, or **Credentials**, then select `ZiCode-Studio-Mobile-CA.pem`. Android may show a security warning. Continue only when the fingerprint exactly matches the trusted desktop.

## Install the certificate on iPhone or iPad

After downloading, install the profile from **Profile Downloaded** near the top of Settings. Then open **Settings → General → About → Certificate Trust Settings** and enable full trust for ZiCode Studio Mobile CA.

## Add ZiCode to the Home Screen

- Android: ZiCode shows an install card when the browser exposes installation.
- iPhone/iPad: in Safari, tap **Share**, then **Add to Home Screen**.
- Home Screen and installation UI consistently use **ZiCode Studio**, without labeling the phone entry
  as Desktop. iPhone and iPad receive an explicit PNG Home Screen icon. Android treats the current brand
  image as a regular icon so a circular, teardrop, or vendor mask cannot crop the important “Zi” mark.
- Where the browser or installed app supports it, browser and system-bar color follows the selected
  Bright White, Midnight Black, Warm Sand, or other ZiCode theme instead of retaining a stale brand color.
- **Not now** and the iPhone/iPad **Got it** action postpone guidance for seven days rather than
  disabling it permanently. Manual installation remains available from the browser menu at any time.
- The installed entry still requires the computer to be online and network-reachable.
- A cold start from the Home Screen restores the most recently opened session path on that phone.
  The record updates immediately after in-app session changes, system Back navigation, or replacement
  of a temporary session ID with its final ID. Settings and other application views do not overwrite
  the most recent chat. ZiCode stores only a validated path—never query parameters, fragments, or the
  pairing token from the QR code.
- When an installed ZiCode returns to the foreground, it performs an hourly-throttled check for newer
  offline and sharing support. It never forces a reload while you are reading or editing a conversation;
  the update takes effect on a later normal open or refresh.

Mobile operating systems may cache an installed app's name and icon. If an upgrade still shows the old
**ZiCode Studio Desktop** name or a cropped icon, open ZiCode normally once and allow the update to finish.
If it remains unchanged, remove the old Home Screen installation and add it again. Removing a Home Screen
entry does not normally clear site data, but preserve important drafts before using any system cleanup action.

## Switch applications

The bottom navigation keeps **Chat, Projects, Notes, Files,** and **More** visible with touch targets at
least 56px high. These are application-navigation buttons, not tabs; screen readers identify the active
application as the current page. Tasks, Automation, Finance, Artifacts, Commands, Plugin Manager,
Settings, and Help are available from **More**.

After selecting a secondary application, More's accessible name includes the current page, for example
**More: Settings**. Closing the panel no longer performs an extra browser Back action, so Settings cannot
bounce immediately back to Chat. A later Android or iOS system Back gesture still returns to the previous
application normally. In landscape, the More panel scrolls internally and respects side safe areas. Its
automatic current-item scrolling becomes immediate when the system requests reduced motion.

## Edit Notes on a phone

After opening a note, the Edit/Preview switch and note actions appear as two clearly named control
groups. On phones, each group uses two columns, so Discuss in Chat, Attach, Save, and Delete never
form an overflowing single row. Every button is at least 40px high. The same layout applies to very
narrow screens and coarse-pointer landscape views, while the title, tags, and Markdown editor remain
inside the page width.

Edit and Preview expose their selected state to screen readers. Save becomes available only after the
title, tags, or body changes and becomes disabled again after a successful save, preventing duplicate
submissions. With an external keyboard, focus either view button and press Enter or Space. Wrapping the
action area does not introduce page-level horizontal scrolling.

## Forms and controls in built-in applications

Projects, Tasks, Automation, Finance, Artifacts, Plugin Manager, and Settings share a touch-safe mobile
baseline. Regular buttons and checkbox labels are at least 40px high; single-line fields and selects are
also at least 40px high. Form text uses at least a 16px font so iPhone and iPad Safari do not zoom the
whole page merely because a smaller field receives focus. Existing larger headings remain larger, while
desktop keeps its compact control density.

Automation keeps visible labels above Name, Target project, Task instructions, Schedule, Maximum cost,
and Maximum retries. Entering a value therefore never leaves an unexplained number or field. Each label
uses the native label-control relationship, so tapping the text focuses its field and screen readers use
the same name. Narrow screens also remove one redundant page-padding layer, preserving about 32px more
usable field width.

To create an automation, enter its name and task instructions, choose the schedule, cost, and retry
limits, then tap **Create automation**. A successful submission clears the form and immediately adds the
new rule below it. If creation fails, ZiCode keeps the entered content and shows the failure.

## Share into ZiCode from Android

After installing ZiCode to the Android Home Screen, open the system share sheet from a web page,
selected browser text, or another application and choose **ZiCode**. The shared title, body, and web
address are added to the current chat composer. An existing draft is preserved, and you can edit,
remove, or extend the content before sending. ZiCode **never sends an incoming share automatically**.

You can also share PNG, JPEG, GIF, or WebP images from Photos, a screenshot tool, or another app.
ZiCode accepts at most four images, no more than 8 MB each or 12 MB combined. They enter the existing
preview and compression pipeline, which limits the longest edge to 2048px, and still wait for your
confirmation before sending. If an image is unsupported or exceeds a limit, ZiCode keeps any text
and images it can read and explains that some shared images could not be added.

To keep shared content out of browser history, server logs, and durable caches, Android delivers it
to ZiCode with a POST request and then redirects only to the most recent validated session path on
that phone. Text lives briefly in tab-scoped session storage. Images enter a one-time local inbox
under a random ID and timestamp; ZiCode deletes the record before creating previews. Malformed,
timed-out, or more than ten-minute-old content is discarded with a friendly message.

Whether ZiCode appears as a share target depends on the Android version, browser, and installed-PWA
support. iPhone and iPad may not expose a web app as a system share target; **Share answer** inside
ZiCode can still send content to other applications.

## Network changes and recovery

After the phone loses connectivity, locks, or changes Wi-Fi, a compact offline or reconnecting status appears. ZiCode automatically rebuilds the WebSocket and restores the current session subscription when the network returns. A revoked device stops reconnecting and requires a new pairing link.

If reconnecting takes about eight seconds, the status explains that the connection is taking longer than expected and shows **Retry**. Confirm that the desktop is running, remote access is enabled, and both devices are network-reachable, then use the button to replace the connection immediately. You do not need to leave the Home Screen app or scan another QR code while the device credential remains valid.

When ZiCode returns from the lock screen or another app, it actively replaces a connection that may have gone stale in the background. Repeated operating-system resume events still create only one replacement connection.

If the desktop is unreachable when the installed app starts, a standalone offline page distinguishes a phone that is offline from a phone that is online but cannot reach the desktop. It checks only the local ZiCode Host every five seconds and automatically restores the original session route when the desktop returns. You can also choose **Try now**; the check never contacts a model service.

## Software keyboard and composer

When the message field receives focus on Android or iPhone/iPad, ZiCode follows the browser's actual
visible area, keeps the composer immediately above the software keyboard, and temporarily hides the
bottom application navigation. If iOS pans the page because of the address bar or input focus, the
top controls, composer, and message scroll insets continue following the visible viewport. You should
not need to scroll the page manually to find the input field.

Closing the keyboard restores the bottom navigation and normal safe-area spacing. If a third-party
keyboard, browser zoom, or split-screen mode still causes an overlap, return to the standard zoom and
focus the field again. Those operating-system combinations still require release testing on specific
Android and iOS devices.

In a long conversation, ZiCode keeps the latest message anchored when you were already near the bottom
and the keyboard, attachment previews, or composer height changes. If you have scrolled up to read
history, the same layout changes and streaming output preserve that reading position instead of jumping
back to the newest message. When a new answer arrives in that state, the **Latest ↓** button appears on
the right. Click, tap, or activate it from the keyboard to return smoothly; it hides again at the bottom.
On phones, the control provides a touch target at least 40px high and avoids the composer and right safe area.
Screen readers announce the new answer and the available action through a polite live region. Long-distance
jumps are immediate, while short jumps remain smooth. When the operating system requests reduced motion,
both conversation-dot and **Latest** jumps are always immediate.
After you activate **Latest** from a keyboard or screen reader, focus moves to the newest answer instead
of remaining on the hidden button. The answer is made programmatically focusable only while focused and
returns to its normal state afterward. Manually scrolling to the bottom never steals focus.

To keep a long conversation responsive when switching sessions on a phone, ZiCode initially renders
only the most recent part and places **Load earlier messages** at the top. Each batch preserves the
content currently in view. After the final batch, focus moves to an **All earlier messages loaded**
status instead of disappearing with the button. Conversation search expands the full history
automatically, so older content remains searchable without loading every batch manually.

Attachment and Markdown images in conversation history load only when they approach the visible area
and decode asynchronously, reducing network, main-thread, and memory pressure when a long conversation
first opens. Images currently previewed in the composer and an opened image viewer remain immediate.
External Markdown image requests do not include the ZiCode page referrer, but they still contact the
image host when the image approaches the viewport; this optimization does not make those images offline.

## Reading wide tables and code

Wide tables and long code lines scroll horizontally inside their own content area instead of widening
the whole page. Swipe them directly on a phone. With an external keyboard, focus the region named
**Scrollable table**, then use the Left and Right arrow keys. Table and code regions contain their
horizontal scroll chain so reaching an edge does not unexpectedly drag the whole application.

The code block's **Copy** action provides a touch target at least 40px high on phones. Success changes
the action to **Copied** and announces the result. If the browser denies clipboard permission, ZiCode
shows **Copy failed** and announces a suggestion to check that permission instead of becoming
unresponsive or raising an unhandled error. Failure feedback remains for five seconds before **Copy**
returns, allowing you to adjust site permissions and retry.

## Inspecting tool runs

When Pi runs a command, reads a file, or edits content, the tool card title is an expand control at
least 40px high on phones. Tap to inspect arguments and output, then tap again to collapse. With an
external keyboard, focus it and press Enter or Space. Its screen-reader name combines only the tool
name with the expand or collapse action, rather than reading an entire long path or command. A long
path is truncated in the compact header while its complete value remains in expanded arguments.

Failed tools open their error details automatically, so a red status does not require another hidden
step. Tool output and diff regions use at most 38% of the visible phone height and scroll internally.
The 40px output-copy action remains visible on phones. Success shows a green **Tool output copied**
row; denied permission shows a red suggestion for five seconds. Pending, running, complete, and error
states and all accessible labels follow the current language.

## Save a message while disconnected

While the remote connection is down, the Send button's accessible description changes to **Save draft
for reconnect**. Choosing it never contacts a model or retries silently. ZiCode first saves the current
encrypted text and images, then writes a separate encrypted, session-isolated send-later marker. If local
storage fails, the content remains in the composer and an actionable error is shown.

After reconnection, a confirmation bar appears above the composer. Only **Send now** submits the request;
**Keep as draft** removes the send intent while preserving the content. The marker expires after 24 hours,
while the underlying draft retains its seven-day lifetime, so reopening an old app cannot unexpectedly send
stale content. Each session keeps an independent confirmation state.

## Recover an unsent draft

The remote phone client keeps unsent text and processed images isolated by Workspace and session. About 250ms
after typing stops, ZiCode encrypts the draft with a device-local, non-extractable 256-bit AES-GCM
key and writes the ciphertext to IndexedDB. Reopening the same session after a reload or PWA process
reclaim restores the text and image previews, focuses the composer, and shows **Unsent draft restored on this device**.
A restore never overwrites text you started entering before the read completed.

Each draft is limited to 32,768 characters and expires after seven days. Switching sessions cannot
mix drafts, and a temporary new-session ID migrates its draft when the Host assigns the final ID.
ZiCode deletes the draft after a request is accepted and keeps it when submission fails. Image recovery
keeps at most four images, 8 MB decoded per image and 12 MB in total, across the three most recent sessions
that contain images. Text and image ciphertext are stored separately, so normal typing never re-encrypts a
large image. An over-limit image can still be sent from the current page, but ZiCode warns that it must be
selected again after a restart.

The draft remains inside this phone's ZiCode site storage. It is not synced to the computer, cloud,
or another device. Encryption reduces text and image plaintext exposure if browser storage is read directly, but it
is not end-to-end encryption: code running in the ZiCode origin can still ask the browser to decrypt.
Clearing site data deletes both the drafts and device key, so they cannot be recovered.

On the phone, open **Settings → General → Mobile → Protect local drafts** to explicitly ask the browser
to make the current ZiCode site's storage persistent. When granted, the browser will not evict these
encrypted drafts merely because storage is under pressure. The request uploads nothing and does not change
the seven-day lifetime or size limits. Settings shows the browser-reported protection state and, when
available, current usage and quota. If the browser declines or does not support persistence, drafts remain
encrypted but may still be reclaimed under storage pressure.

Persistent storage is not a permanent backup. Clearing site data, resetting the browser, or uninstalling
and deleting site data still removes the drafts and device key. ZiCode requests protection only after you
choose **Protect drafts**; it never raises the permission request silently in the background.

## Pi task progress

When Pi uses a task list, a compact **Tasks** progress control and completed count appear above the
composer. Tap it on a phone to reveal up to five current tasks and tap again to collapse it; an
additional count appears when more tasks exist. Long task names use up to two lines, and expanded
content stays inside a bounded scroll area instead of pushing the composer off screen.

The control provides a touch target at least 40px high and tells screen readers the completion ratio
and available expand or collapse action. Collapsed details also leave the interaction and accessibility
navigation range. Titles, statuses, remaining count, and accessible names update immediately after a
language change. Desktop users can still preview on hover or click to keep the panel expanded.

## Task completion alerts

On the phone, open **Settings → General → Mobile → Task completion alerts** and explicitly grant
notification permission. ZiCode then sends a system alert only when a tracked Pi task finishes
while the page is still in the background. Returning to ZiCode before delivery cancels a delayed
alert. The lock-screen copy is deliberately private: it never contains prompts, model responses,
file names, or workspace content. Opening the alert focuses an existing ZiCode window, or opens a
validated session entry when no window is available.

If the setting says that notifications are blocked, allow them again in the browser or operating
system site settings. On iPhone or iPad, first add ZiCode to the Home Screen, then enable alerts
from the installed app.

## Back gesture

On Android, the system Back action follows the visible interface hierarchy: it closes overlays such as **More**, then closes the current application's function-area drawer, and only then returns to the previous application or session. Closing one interface layer does not exit ZiCode. A cross-workspace history entry reloads its target workspace so the URL and visible content cannot drift apart.

The photo picker follows the same rule: Back first closes the **Take photo / Choose from photos**
sheet and restores focus to **Attach image** instead of leaving the current chat. After selecting a
large image, wait for **Preparing image** to disappear and for the preview to appear; Send becomes
available automatically when the photo is ready.

## Direct connection (P2P) and relay

The current mobile client automatically negotiates an end-to-end WebRTC connection (P2P) with the
desktop: on the same LAN or across hole-punchable NAT, chat traffic flows directly between the two
devices instead of through the relay; when hole punching fails it silently falls back to the relay
channel with no manual switching. The relay still carries pairing signaling and the fallback path,
and it never sees the desktop's session content. If your server runs STUN/TURN (coturn), paste the
`relayIceServers` array printed by the deployment script into the desktop's
`remote-access/config.json` so the phone receives public hole-punching candidates.

## Security guidance

- Enable remote access only on a network you control or trust.
- Never install a certificate whose fingerprint does not match.
- Revoke unused phones under **Settings → Remote access → Paired devices**.
- A one-time QR code can pair a device. Do not forward or share screenshots of it.
- Only the local desktop can generate a new pairing QR code. A paired phone cannot issue credentials for another device.
