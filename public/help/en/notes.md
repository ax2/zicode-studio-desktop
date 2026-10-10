# Local Notes library

Notes is a built-in, local-first application. It uses the same three-column shell as Chat, Settings, and Help: the activity rail switches applications, the function area contains notebooks, tags, search, and the note list, and the main view contains the editor and preview.

Notes use a tree in the function area: each notebook is a parent node and its notes appear directly below it. Expand or collapse a notebook to control density; the active note is highlighted in place. Search and tag filters preserve this hierarchy so every result keeps its notebook context.

## Create a notebook

Open Notes, choose **New notebook**, and enter a name. Each notebook is an independent vault whose source is readable Markdown, with an Astro Content Collection compatible layout and configuration. The files remain readable in an ordinary text editor without ZiCode or Astro.

## Edit and search

Choose **New note** to edit a title, tags, and Markdown content. Use **Preview** to inspect the rendered result and `Ctrl+S` to save. Search covers titles, tags, content, and source URLs. Saves verify the loaded file version so an external edit is not silently overwritten.

Search hits are highlighted inside note titles, and Preview shows a heading outline (h1–h3) on the right; clicking an entry jumps to that heading — handy for long articles.

## Organize notes

The navigation area has a **Select** toggle: enter selection mode, tick multiple notes, then use **Move to…** to move them all into a target notebook at once. You can also move a single note with its ⇄ button or by dragging it onto another notebook.

## Two-way Chat bridge

- The note action below an assistant answer captures the preceding question, full answer, session
  provenance, and tags as structured Markdown, then opens the new note.
- **Discuss in Chat** returns to Chat with a stable `zicode-note://` reference and exact
  `notes_get` parameters. Pi reads the latest note instead of copying a long, stale body into the
  composer.

## Attachments

Choose **Attach** in the editor to add PNG, JPEG, GIF, WebP, PDF, text, Markdown, CSV, or JSON files. Each file is limited to 5 MiB; executables and active formats such as SVG are rejected. Attachments live under `public/attachments/` in the current vault, and the editor inserts an Astro-compatible Markdown link. Deleting a note moves the note and its attachment directory to the trash; only a permanent purge removes the attachments.

## Capture a web page

Choose **Capture URL**, then select a notebook and a public HTTP(S) page. ZiCode does not send Cookie or Authorization headers, rejects local and private network addresses, removes active content such as scripts, and records the source URL, capture time, and content digest. Capturing the same body again returns the existing note.

### Capture preview and model digest

Click **Preview** to see how many readable characters were extracted and expand
the full text with **Show full content**, confirming that navigation, headers,
footers, ads, and sidebars were removed. To digest the article quickly, click
**Summarize with selected model** after choosing a configured channel under **Model service**. The app asks that model for a
structured digest (a one-line summary, key points, and conclusions) that you
can copy or dismiss. The digest is only for preview — the saved note keeps the
full original text.

Without a model service, you can still preview, save and edit notes. No default service is called automatically. Summarization requires Notes network permission. See [Translation](translate.md) for channel and local service configuration.

## Pi tools

When the plugin is enabled and the active scene grants `pi.tools.register`, Pi can search, read, or create notes. The tools are restricted to Notes-managed vaults, and their audit metadata excludes note bodies and credentials.

## Import, backup, and recovery

The **Data management** section provides five operations:

- **Import Markdown** copies ordinary Markdown or a Frontmatter document into a new note;
- **Export readable backup** creates a `.zicode-notes.json` file containing notes, source metadata, and attachments;
- **Import backup** validates the schema, IDs, file types, sizes, and references before creating an independent imported vault;
- **Check and rebuild Vault** rescans Markdown into `.zicode/index.json` and reports damaged files or orphan attachment directories without deleting source files.
- **Trash** lists deleted notes and lets you restore a single note, purge it permanently, or empty the trash in one step.

Imports and exports wait for the current note to save successfully. If saving fails or newer edits remain unsaved, the operation stops and keeps the editor content.
Only one transfer runs at a time. Switching workspaces while choosing or reading a file stops subsequent import steps; a request already sent may still finish in its original workspace.
If you edit during an import, the editor stays open; find the imported notes in the list afterward.
If content changes during an export, save and export again.

**Export all notebooks backup** creates one JSON bundle for the current workspace. **Import all notebooks backup** creates separate imported notebooks without overwriting the originals. The complete batch is prepared in hidden staging storage before publishing, preserving notebook hierarchy and icons. A single-notebook import remains independent of its original parent.
A publishing failure rolls back the new directories. After a process interruption, the next workspace access recovers unfinished imports first. If recovery fails, keep the `.imports` recovery directory and resolve folder permissions or free disk space before retrying.
Another process using the workspace may cause a busy message. The operating system releases the lock when that process exits; do not delete `.notes.lock` to unlock it.
A timed-out request may still have completed. Refresh the list before retrying.

## Trash

Deleting a note is not immediate: the note moves into its notebook's trash, which shows the icon, title, source notebook, and deletion time. **Restore** returns the note and its attachments to the original notebook; **Delete permanently** requires a second confirmation and cannot be undone, as does **Empty trash**. Trash is isolated per workspace.

Trash entries are retained for 30 days; entries older than that are permanently removed automatically the next time the trash is opened (use **Delete permanently** or **Empty trash** to clean up earlier). Exported backups include trash entries, so a backup taken right after deletion still restores everything.

Shortcuts: `Ctrl+N` creates a new note, `Ctrl+Shift+T` opens the trash, and `Ctrl+S` saves the current note.
The editor toolbar offers Markdown formatting buttons (bold, italic, heading,
code, quote, list, table, link), plus `Ctrl+B` bold, `Ctrl+I` italic, and
`Ctrl+Shift+K` code block shortcuts; selecting comma-separated CSV data and
clicking "Convert CSV to table" (⇶) turns it into a Markdown table.

## Data location

The desktop app stores vaults under `plugin-data/com.zicode.notes/vaults/` in the ZiCode data directory. Markdown and attachments remain readable without a private database. Astro publishing commands, cross-device synchronization, and an independent client remain future work.

## Portable note links

**Copy note link** creates a Markdown link with stable notebook and note IDs. Paste it into another note in the same workspace and open it from the preview.
Wiki links accept `[[Title]]` and `[[Title|Display text]]`. Title lookup prefers a unique match in the current notebook, then a unique match in the loaded list; ambiguous matches prompt you to use an ID link.
Title lookup depends on the current filters and loaded range. ID links request the target directly from the Host and show an error if it does not exist.

During backup import, standard ID links in ordinary prose are remapped when their targets are included in the batch. Single-notebook import also remaps references within that notebook.
Targets outside the backup, code regions, blockquotes and extended URL forms such as queries or fragments remain unchanged. Title Wiki links keep using title lookup.

## Backlinks and relationship status

Backlinks use saved notes and skip fenced, inline and indented code, as well as blockquotes. Title Wiki links resolve only to a unique candidate in the current notebook, or a unique candidate across the indexed library. Ambiguous titles do not create a relationship.
The relationship index processes up to 200 notebooks and 2000 notes. At the scan limit it reports an incomplete result and stops inferring title uniqueness; explicit ID links can still connect known targets inside the indexed range.
Saving refreshes relationships for the current note. Unsaved edits are not indexed. Switching notes clears the previous list; failures show an error with **Retry** instead of retaining another note's relationships.
Similar notes retain at most 100 pairs. Parsing is conservative, so complex Markdown and extended URI forms may not be recognized.

### Protecting edits during actions

Filtering, creating, duplicating, selecting notebooks, opening web capture, deleting and moving wait for the current note to save. If saving fails, edits stay in the editor. Editing while a new note is being created keeps your current editor; open the new note from the list. Editing pauses during deletion and moves. Failed items in a batch remain selected for retry. Saving a chat response as a note also preserves unsaved edits in the current editor.

### Local draft recovery

Edits are written after a short delay to encrypted recovery storage in this browser or desktop profile. After switching projects and returning, use Local note recovery to open a draft, save a new note, download Markdown, or confirm discarding it. Successful saves clear the corresponding recovery copy. Separate windows keep separate drafts.

Opening a recovered draft keeps its original note version; saving still checks conflicts. Save as a new note remains available after a conflict. Copies use the original notebook when it exists, otherwise the selected or first available notebook. Create a notebook first if none exists, or download the draft.

Pending writes and storage failures are shown. Each recovery record is limited to 8 MiB, including the original note and edits; content is never truncated. Failed writes remain available in memory for this process, and unreadable stored records are retained while readable drafts remain available. Recovery is not backup or sync: clearing browser data, changing address/port or profile, immediate shutdown, or a crash can prevent recovery. Attachments still refer to the original note; saving a copy or downloading Markdown does not copy attachment files.

### Attachment uploads and recovery

Uploads keep the workspace and note selected when the action starts. Leaving that note before file selection or reading finishes cancels dispatch. If an upload already in flight finishes after you leave, its link is kept in Local note recovery in the original workspace. Insert attachment link appends it to the original note's current content without replacing text or adding the same link twice.

You can keep typing during upload; the link appends to your latest content. The UI distinguishes a link still awaiting note save from a completed save. Save failures leave the link in the editor and its local draft. Files must contain 1 byte to 5 MiB; read failures stop dispatch. Recovery stores text and links, not attachment files; permanently deleting the original note or removing its attachments can invalidate the link.

### Current capture page and summary

Changing the page URL clears the previous preview and summary. Refreshing the preview, changing the model, or closing the form prevents older summary responses from appearing. Switching workspaces closes the capture form and clears its results and model selection. Requests use the workspace and explicitly selected model from when they started.

Only one capture is submitted at a time in a workspace. Capture waits for the current note to save; save failure keeps the editor and reports the error. If you edit the URL, title, tags or destination, or open another note after dispatch, the previous capture will not replace your current view. Open a saved capture from the notes list.

Leaving the form stops accepting stale results; it does not cancel a dispatched Host request. The original workspace may still receive the captured note, and model work may continue. Capture form inputs and temporary previews do not yet have cross-workspace draft recovery.

### Workspace note shortcuts

Recent and pinned notes are saved separately for each scene and workspace. Only notebook and note IDs are persisted, not titles or content. Switching workspaces clears the old list before resolving the new references. Search filters do not restrict recorded shortcuts. Failed reads keep the references and offer refresh.

Recover older shortcuts imports only legacy IDs uniquely matched in the current workspace's returned note list. Old records stay intact, and list limits can make recovery incomplete. Recover separately in other workspaces as needed. Up to 8 recent and 16 pinned references are kept. The management menu requires a second click to clear either list in the current workspace; notes are not deleted. Legacy global records can still be explicitly recovered later.

Changes use device-local transactions. Failed writes stay in memory with queued changes retried on refresh or later edits. Refresh or refocus the window to read changes from other windows. These preferences are not part of Host backup exports or device sync.

### Trash operation scope

Restore, permanent delete and empty actions keep their starting workspace. After switching workspaces, older responses cannot update the new list, and a batch stops dispatching further deletions. Trash writes are serialized within a workspace. Restore refreshes the library while preserving the current editor.

Empty requires a second confirmation and processes only the displayed snapshot, one entry at a time. Partial failures report an error and refresh the remaining entries for review and retry. Updated Hosts check the entry version and deletion timestamp before restore or purge. Confirmation identifies the complete entry; changed entries need another confirmation. Permanent deletion also removes the note's attachments.

Existing Host retention cleanup can still run while listing trash and is separate from this batch. Older Hosts or clients omitting the version conditions do not provide the same check. Leaving a view does not cancel a dispatched request, and external file editors do not participate in the app's lock.

### Deletion dates and retention

New deletions have an independent timestamp for the 30-day retention period; the document modification date does not shorten it. Older entries with no known deletion date show **Retention started**, and receive 30 days from first recognition. Unreadable or invalid metadata produces an error; that entry is not automatically purged using its document date.

New backups preserve explicitly recorded deletion dates, so imported expired entries may be removed on the next trash listing. Older backups and entries with unknown deletion dates receive 30 days from import. Each deletion and import creates a new event ID. The current UI and Host check that ID along with content version and time, protecting against stale operations on a note deleted again. Older clients omitting the event ID cannot distinguish identical content deleted again within the same second.

### Build, check, and Chat handoff

**Build Astro site**, **Check and rebuild Vault**, and **Discuss in Chat** first save the current note. They stop when saving fails or newer edits remain. Changing the note, notebook, or workspace while build confirmation is pending requires starting again. Progress is displayed and repeated starts are blocked. Build and check completion keep the current editor selection.

Astro building is available in the desktop app, uses the notebook Vault and existing local Bun build chain, may download dependencies, and writes to the Vault's dist/ directory. It does not deploy the site. A usable Bun runtime is required. Switching workspaces does not cancel a dispatched build; its late result does not update the new workspace view.

Chat handoff waits for the Chat view before filling the composer. It stops if the workspace, instance, session, or note editing context changes during that wait. If the selected text changes while saving, select it again. Existing composer text is kept after the inserted context; sending remains manual. Leaving Notes is blocked if saving leaves newer unsaved edits.
