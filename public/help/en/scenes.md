# Scenes and isolation

Scenes keep different kinds of work separate. Programming, finance, and creative work can use different instructions, credentials, model channels, extensions, and session histories.

## Current session scene

The scene badge in the chat header describes the current session. Its configuration remains stable for the lifetime of that session.

## Scene for the next session

Use **Settings → General** to choose the scene used when a new session is created. This does not silently move the current session to another scene.

## Isolated data

Scene-specific data is stored under the application's managed data directory. Credentials remain local and are never included in help documents or project archives.

## Workspace data and system configuration

Scenes govern model and agent configuration; **data is isolated per
workspace**, not per scene:

- Sessions, notes, tasks, automations, finance research, and artifacts live
  under `<workspace>/.zicode/{sessions,notes,tasks,automation,finance,artifacts}/`;
  switching workspace switches the data. Data saved by older versions in the
  app-data directory is migrated once on first launch;
- System configuration (model/agent config, scene profiles, remote access,
  credential index, workspace registry) lives under `~/.zicode`; Pi command
  configuration no longer writes to `~/.pi`;
- Runtime instances, logs, and WebView data stay in the system app-data
  directory and do not enter the workspace.
