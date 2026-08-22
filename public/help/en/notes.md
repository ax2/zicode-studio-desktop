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

### Capture preview and Pi digest

Click **Preview** to see how many readable characters were extracted and expand
the full text with **Show full content**, confirming that navigation, headers,
footers, ads, and sidebars were removed. To digest the article quickly, click
**Summarize with Pi**; the app asks the scene's configured model for a
structured digest (a one-line summary, key points, and conclusions) that you
can copy or dismiss. The digest is only for preview — the saved note keeps the
full original text.

## Pi tools

When the plugin is enabled and the active scene grants `pi.tools.register`, Pi can search, read, or create notes. The tools are restricted to Notes-managed vaults, and their audit metadata excludes note bodies and credentials.

## Import, backup, and recovery

The **Data management** section provides five operations:

- **Import Markdown** copies ordinary Markdown or a Frontmatter document into a new note;
- **Export readable backup** creates a `.zicode-notes.json` file containing notes, source metadata, and attachments;
- **Import backup** validates the schema, IDs, file types, sizes, and references before creating an independent imported vault;
- **Check and rebuild Vault** rescans Markdown into `.zicode/index.json` and reports damaged files or orphan attachment directories without deleting source files.
- **Trash** lists deleted notes and lets you restore a single note, purge it permanently, or empty the trash in one step.

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
