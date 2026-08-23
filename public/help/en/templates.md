# Conversation templates

The welcome screen of a new conversation offers **Start from a template**:
clicking any template pre-fills the composer with its starter prompt (nothing
is sent automatically), so you can add details and then send — no need to
write out common requests from scratch.

## Built-in templates

- ✍️ Write a tech blog post
- 🌐 Translate text
- 📝 Organize into notes
- 🔍 Review code
- 💡 Brainstorm ideas
- 📊 Analyze data

## Custom templates

Open **Settings → General → Conversation templates** to add, edit, or delete
your own templates:

- **Template name**: the display name
- **Emoji icon (optional)**: defaults to 📝
- **Template prompt**: the starter text pre-filled when the template is clicked

Custom templates appear together with the built-ins on the welcome screen;
name and prompt are required. You can also **export / import templates** as
JSON for backups or to move them between your computer and phone — imports
are deduplicated by id, so existing templates are skipped automatically.

> Tip: a template is just a starting point — edit it freely before sending.
> Pi runs with the current workspace as its working directory, so relative
> paths in prompts (for example `src/app.ts`) work directly; you can also
> drag a file from the Files panel into the input to insert its path.
