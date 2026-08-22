# Chat workflow

Chat is both a conversation surface and an entry point to projects, notes, and artifacts. Each session keeps the scene and runtime selected when it was created.

## Organize sessions

- Create separate sessions for long-running topics.
- Use a project to group conversations, tasks, and artifacts for one goal.
- New sessions use the scene selected in Settings; existing sessions keep their original scene.

## Send and queue

| Action | Result |
|---|---|
| `Enter` | Send, or add live guidance while work is running |
| `Alt+Enter` | Queue a follow-up |
| `//text` | Send ordinary text that begins with `/` |

## Work mode

The composer's **Work mode** selector decides the execution boundary for the
next message:

- **Ask**: answer and inform only — never create, modify, or delete files,
  and run no side effects;
- **Craft (default)**: execute the task and modify files directly;
- **Plan**: first propose an execution plan (steps, files to change, expected
  output) and do not modify any files until you confirm.

The selected mode prepends a matching instruction to the message. Daily use
stays on the default **Craft**.
Set the initial mode for every conversation under Settings → General →
Agent → **Default work mode**; the composer follows changes immediately.
Type `/mode` to cycle Ask → Craft → Plan → Ask; non-default modes are
highlighted in the composer.

## See what the agent is doing

While the agent works, tool cards show human-readable stage labels instead of
internal tool names — "Running a command", "Reading a file", "Editing files",
"Searching", "Opening a page" — and the label highlights while the call is
running. Click a card to expand its arguments, output, and a diff for edit
tools (only the lines that actually changed).

While a run is in progress, the composer's send button becomes **Stop** (or
press `Esc`) so you can interrupt the current execution, then add new
instructions or send again.

The right-side result panel has **Files / Artifacts / Changes** views: Changes
lists every file the session's tools touched, each with a badge (modified /
created / appended). Click a file to expand its diff; the magnifier button
locates the file in the file browser.

## Extract memory

Type `/memory` (or `/` and choose **Extract memory from this conversation**)
to distill stable facts, preferences, and follow-ups into memory entries,
deduplicated against what you already saved. New messages then carry
**Relevant memory** automatically; manage, edit, delete, or disable this in
Settings → General → Memory.

## Add photos on a phone

Use **Attach image** below the composer to choose **Take photo** or **Choose from photos**.
While ZiCode resizes a phone photo, it shows **Preparing image** and temporarily disables Send.
This prevents a text message from being sent before its photo is ready. The remove control stays
visible on touch devices. If an image cannot be read, ZiCode shows an actionable error so you can
retry with a smaller PNG or JPEG.

## Share an answer

On a phone browser or Home Screen app that supports system sharing, **Share answer** appears below
each Pi response. It can send the answer to chat, mail, notes, and other applications exposed by the
operating system. ZiCode shares only the visible answer, never reasoning, tool calls, or session
credentials. Closing the system share sheet is treated as cancellation. If the browser cannot open
the sheet, ZiCode copies the answer instead and shows **Copied** on the button.

Copy, Save to Notes, and Share use action areas of at least 40×40px on narrow or touch devices.

After ZiCode is installed to the Android Home Screen, it can also receive a system share. A page
title, selected text, link, and common image formats enter the current composer without replacing
its draft. Images appear as previews and nothing is sent automatically. See **Use ZiCode on a phone
→ Share into ZiCode from Android** for format, size, compatibility, and privacy details.

## Unsent drafts on a phone

ZiCode encrypts phone-entered text and bounded image attachments per session in local device storage.
Reopening the same session after a reload or process reclaim restores the text and image previews without
sending them, and a successful submission deletes them. See **Use ZiCode on a phone → Recover an unsent
draft** for encryption, image capacity, expiry, and deletion boundaries.

If the phone is disconnected when you choose Send, ZiCode saves an encrypted send-later draft instead
of contacting a model. After reconnection, confirm with **Send now** above the composer or choose **Keep
as draft** to cancel the send intent. See **Use ZiCode on a phone → Save a message while disconnected**
for the complete lifecycle.

## Connect Chat and Notes

Use “Link conversation” in Notes to create a durable source relationship instead of copying text through a chat command. You can then:

- return from a note to its source conversation and message;
- assemble related notes into a context pack for a new chat;
- inspect similar notes, conflicting claims, and knowledge links;
- turn conversation findings into a maintainable knowledge base.

## Recover from errors

Failed model requests show a friendly error card. Choose “Retry request” to reuse the original text and images, or open model settings to repair the configuration.

> If a task appears active without new output, inspect its state and error card before sending duplicate requests.
