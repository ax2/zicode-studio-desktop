# Interface and navigation

ZiCode uses one consistent three-region workspace for Chat, Notes, Projects, Settings, and Help, so routine work stays in the same window.

## The three regions

| Region | Purpose | Typical content |
|---|---|---|
| Activity rail | Switch applications | Chat, Notes, Projects, Tasks, Settings, Help |
| Function area | Operate the current application | Sessions, notebooks, settings categories, documentation tree |
| Main view | Read or edit content | Conversations, editors, forms, documentation |

> The function area changes with the active application. The activity rail stays stable, so logos, Settings, and Help are not duplicated.

## File management

The main-view header keeps a file manager button for browsing the current workspace and opening generated files. Full local paths and the “Open in…” menu do not occupy the header.

The chat's right-hand **Result panel** has three tabs so you can review
outputs in one place:

- **Files**: browse the current workspace with the directory tree, enter
  subdirectories, go up, or reveal a file in the system file manager.
- **Artifacts**: list artifacts produced in the current workspace (reports,
  charts, files, …); clicking any entry opens the Artifacts app for details.
- **File changes**: tracks files written by tools in this session (write /
  edit / create / patch, …); clicking an entry switches back to the Files view
  and locates that file, so you can check the changes before accepting the
  result.

## Workspaces

The function area (left rail) always shows the workspace bar with the current
workspace name and full path:

- The workspace name is a passive label rather than an "open folder as
  workspace" button;
- Click the "Switch workspace" button to list every registered workspace
  (name + path, current highlighted). Selecting one switches the current
  window **in place** and stays in the active application (Chat, Notes,
  Settings, …) instead of jumping back to Chat. The menu bottom offers
  "Open folder as workspace" to register a new directory through the system
  folder picker;
- On first launch the app registers a global shared workspace at
  `~/.zicode` and pins it at the top of the switcher;
- Each workspace keeps its sessions, notes, tasks, automations, finance
  research, and artifacts under
  `<workspace>/.zicode/{sessions,notes,tasks,automation,finance,artifacts}/`,
  so switching workspace switches the data.

## Switching applications

1. Select an application from the activity rail.
2. Choose a session, note, project, or category in the function area.
3. Continue in the main view. ZiCode preserves the current selection when possible.

## Narrow windows

On narrow windows, secondary on-page navigation is hidden to protect reading width. The complete documentation tree remains in the function area and can be filtered by keyword.
