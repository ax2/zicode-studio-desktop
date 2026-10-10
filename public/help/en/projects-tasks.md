# Projects, tasks, and automation

## Project knowledge and chat drafts

In **Knowledge**, choose **Use context pack** for similar notes or **Compare in chat** for a
potential conflict. This prepares a draft in the current project's chat session. It includes
notebook/note IDs, titles, reference links, workspace and scene; it neither reads bodies in advance
nor sends the message. Check and send the draft yourself. The prompt asks the model to use
notes_get, report missing/unreadable notes and cite its sources. It does not change model permissions
or guarantee successful reads or correct conclusions.

References must belong to the current knowledge snapshot. Duplicates are removed; comparison
requires two different notes. Buttons are disabled while refreshing. A snapshot, scene, project
path, workspace or chat-session change during handoff stops insertion. Content is appended only
when the composer is ready, preserving existing text and attachments. Open a chat session in this
project first if prompted. Length protection and draft recovery limits match Git review drafts;
success confirms only that the references reached the current input.

## Run inspection and analysis drafts

Commands cannot start until the first run-list read succeeds. A failed read retains the last known
records with a stale-state message and blocks new starts until a successful read; known active runs
can still be stopped. Operation, catalog and run-list errors are displayed separately.
After a timed-out, disconnected or unconfirmed start, use **Refresh task list**, wait for success
and review the runs before starting another command. Automatic polling or reconciliation does not
clear this restriction. Refreshing does not cancel an earlier request, which may still complete on
the Host. The unconfirmed flag lasts only for the current controller lifetime; reopening the view
requires a fresh list read but does not retain that flag.

Command results follow the latest run by default. Expand **Command run history** and select a
record to pin its details and retained output; **Follow latest run** restores automatic following.
If cleanup or retention removes the selected record, the view reports it instead of silently
switching to another. Polling continues to update that run ID. Records from earlier Host sessions
contain summaries only, without command text or output.
Use **Download command run summary** to save the currently read records as plaintext JSON. It includes the project name, snapshot receipt time, history storage status and up to 40 metadata records, but excludes command text, invocation arguments and output. Project names, task names and directories may still be private, so review before sharing. The file is a record for safekeeping; it does not import into another device's run history or prove live status.

Choose **Analyze run in chat** to append the displayed run snapshot to this project's chat draft.
It includes run ID, directory, status, timestamps, exit code and available output, with truncation,
staleness or summary-only limitations. The frontend receipt time is not proof of live process state.
Handoff does not re-read logs or wait for completion. Running, stopping and unknown states are not
final outcomes; missing historical output is not evidence of an empty error stream.
Check and send the draft yourself. The action does not retry/stop commands, install tools or edit
files; its editable prompt does not change model permissions. Existing text and attachments are
preserved, and a project or session change before insertion cancels the handoff.

## Project work

The overview's task and automation totals include only entries explicitly linked to the current
project. Click a total or **Project work** to open the list, then select an item to open its task
or automation. Task links clear old search and date filters. Automation links display the selected
workflow, with **Show all automations** to return to the full list.

Use **New task for this project** or **New automation for this project** to open the existing
form with the clicked project's directory. The target remains editable. Opening a form does not
create or run work; fill in the content, schedule and execution mode, then submit. Starting another
project form reinitializes its fields, so finish current input first. Cancel does not save current changes.
Failed task creation retains your input for retry; cancellation is disabled while saving.
The selected execution mode and schedule still determine immediate task dispatch or scheduled runs.

Association uses the explicit target directory, or a recorded child workspace ID when a task has
no target path. Directory prefixes, names and relative paths are not used to guess ownership.
Unassigned and archived tasks remain in the global center; archived tasks are excluded from project
totals. Each list first displays 20 items; use its Show more button to reveal the remaining loaded items for this project. Failed reads show an unavailable count and retain the
same project's last successful items with a warning. Use the project header's **Refresh** to retry.
Switching projects clears previous data and ignores late responses.

### Save a task draft

Enter a title and choose **Save draft** to store the instructions, target, schedule and execution
mode in the current workspace. Use the task center's **Drafts** filter or its linked project to
find the task, then **Edit** to continue. You can save it again or choose **Delete draft**.
Drafts never run automatically. **Activate task** moves a manual task into the normal execution
flow; scheduled tasks calculate their next run from activation time. The task ID and draft history
are retained. A failed save or activation keeps your input; refresh and review the latest state before retrying.

Saving is explicit. Unsaved text is lost when cancelling, opening another project's form or closing
the app. Saved drafts remain in the workspace task file. Automation rules have a separate draft list.


## Project terminal

The view reads existing sessions before allowing a new terminal. If a list refresh fails, the last known sessions remain visible with an outdated-state warning; you can still stop a known running session. Operation errors and list errors are shown separately.

After a timed-out, disconnected or unconfirmed start, the start button stays disabled until **Refresh terminals** succeeds. A Host that reports open-intent support can then retry the same start request for the original directory; if the terminal already exists, the Host returns it instead of spawning a second shell. Older Hosts retain the review-then-new-start flow. Refreshing does not cancel a request still running on the Host. The pending intent lasts only for the current terminal view lifetime.

Open **Project terminal**, confirm **Directory for new terminals**, then choose **New terminal**. The shell starts in the current subproject directory, defaulting to the workspace root.
The project file sidebar loads up to 200 entries per page. Use **Load more files** to continue. If the directory changes between pages, refresh the file list. Use the system file manager for folders with more than 100,000 scanned entries or filenames the sidebar cannot represent losslessly.
Double-click a file to open it in the system default app. **Open in file manager** opens the current directory. The Host resolves each relative path within the current workspace and reports entries that moved or now point outside it.
Windows prefers PowerShell 7 at its standard installation path, then `pwsh.exe` in an absolute PATH directory, and finally system Windows PowerShell; neither loads user profiles. macOS/Linux use the host SHELL,
falling back to `/bin/sh` when the path is missing or not executable. A Unix PowerShell 7 login shell starts without a profile. Unrecognized shells receive no assumed `-i` option. The shell uses your host account permissions, files and network.

- Run up to two active terminals per project and eight per host. Use the session buttons to switch.
- Keyboard input, paste, ANSI output and viewport resizing are supported. The input queue is limited
  to 64 KiB; larger pastes are rejected.
- Navigating away keeps the shell running. Return to reconnect. Failed input is never resent
  automatically; inspect the result before typing again after a connection failure.
- **Stop terminal** and Host exit stop the shell and its managed processes. On Unix, processes that
  deliberately detach into a new session are outside terminal ownership.
- The Host retains the latest 256 KiB of output in memory, reads at most 32 KiB per request, and retains
  up to 16 sessions including exited sessions. Discarded output is reported. A retained tail cannot
  always reconstruct a full-screen program; ask the program to redraw when needed.
- The app does not persist terminal input/output. The shell or programs may maintain their own history.
- Terminal reading and control are desktop-only. Output does not automatically open links or write
  the system clipboard.

## Project commands

A selected directory with `deno.json` or `deno.jsonc` offers fixed `deno fmt --check`, `deno lint`, and `deno test` commands and appears in subproject discovery. Valid string tasks, objects with a `command`, and objects with only a nonempty `dependencies` array are listed. Previews show direct dependencies and the command body; selecting a task runs `deno task <name>`. Deno runs direct dependencies in parallel, and they may trigger further tasks, so review the related declarations first. If both config files exist, `deno.json` supplies the tasks. Parsing accepts JSONC comments and trailing commas, but not broader JSON5 syntax. Names outside the runner's safe character set are visible but cannot run. Commands use the Deno CLI from the configured project tool directory or effective PATH; Deno is not installed automatically.
The workspace root's Deno `workspace` path array also feeds bounded subproject discovery, including patterns such as `packages/*` and `packages/**`. Members need a supported project manifest or Deno config. An explicitly named member without a manifest, a path outside the workspace, a directory link, or a discovery limit marks the result incomplete. Discovery does not resolve Deno dependencies or run tasks.

A directory with a valid `pyproject.toml` and a regular `uv.lock`, a `[tool.uv]` table, or explicit membership in the workspace root's `[tool.uv.workspace]` `members` without a matching `exclude`, shows fixed uv lock, sync, unittest, pytest, and build commands. Member directories also recognize the root `uv.lock`; sync uses `uv sync --locked` when an applicable lockfile exists. Test commands use `uv run --no-sync`, so start sync explicitly first. uv manages its own project environment rather than inheriting the Python venv or Conda prefix selected in Project tools. A configured uv tool directory still takes priority. Lock, sync, and build may download dependencies or write project files; they run only when you start the corresponding command.

Directory discovery reads root `package.json` workspaces (an array or a `packages` object),
`pnpm-workspace.yaml` packages, `Cargo.toml` workspace members/exclude, and root `pyproject.toml`
`[tool.uv.workspace]` members/exclude. When a pnpm file
exists, it takes precedence over JS workspaces; a parse failure reports incomplete discovery
without falling back to the JS declaration. Supported paths are workspace-relative (optional
`./` prefix and trailing `/`) and support `*`, `?`, character classes and whole-segment `**`,
such as `packages/app-*` or `services/**/api`. Patterns and actual traversal are limited to
32 segments. Pattern matching is case-sensitive; literal paths follow filesystem lookup rules.

pnpm `!` entries exclude directories. An empty file, null root, missing packages or null packages uses `**`; an empty array or only
exclusions adds no declared directories. The root and ordinary scan remain available.
YAML comments, quoting, block lists and inline arrays are supported. Duplicate root keys,
multiple documents, root merge keys, aliases/tags inside packages and non-string entries are
rejected. Other values are skipped without alias expansion. YAML is limited to 16384 events,
64 levels of unrelated nesting and the existing 256 KiB manifest size.

All declaration expansion shares 2048 path steps/directory entries, with at most 128 patterns
per manifest. The merged list contains at most 64 directories including the root, prioritizing
declared directories. Exclusions affect that declaration only; ordinary scanning can still
find excluded independent projects. This is a directory list, not exact package-manager
membership. Intermediate directories reached by recursive patterns need no manifest.

An invalid or unsupported pattern skips its entire declaration and reports incomplete discovery;
the ordinary scan continues. Brace/extglob patterns such as `{api,web}` or `@(api|web)`, dependency
graphs, implicit Cargo path-dependency members and inherited configuration remain unsupported.
Links, outside paths, hidden folders and dependency/build folders are omitted. Reaching a budget,
a missing literal directory, or a literal declared directory without a supported manifest also
makes discovery incomplete.

Use **Command directory** to select the workspace root or a nested project such as `frontend/`,
`services/api/` or `src-tauri/`. The ordinary scan covers up to four directory levels and 2048 entries,
supplemented by supported root workspace declarations. The merged list has at most 64 project
directories, skipping hidden, dependency and build folders and directory links.
Incomplete scans are reported; open a deeper folder as a workspace when needed. This does not
resolve a monorepo dependency graph. The manager can inherit from a declared ancestor workspace
as described below; `.venv` remains local to the selected directory and other parent settings are not inherited. Switching directories keeps existing
tasks running. Output and history cover the whole workspace and identify each run's directory.

A pyproject.toml or requirements.txt in the selected directory adds `python -m unittest discover`, `python -m pytest`
and `python -m build`. Each entry shows the selected interpreter. Explicit Python environment
selection takes priority. In automatic mode, a standard command-folder `.venv` is preferred,
then the local `.conda` prefix, followed by project tool paths and host Python.
An incomplete automatic `.venv` or `.conda`, a missing layout marker, or an environment outside the project
disables Python commands until repaired. Explicitly selected standard environments may be outside
the project. The app does not silently fall back, create environments or install pytest/build.
Unix venv interpreter files may link to system Python. Automatic selection checks `.venv`
and `.conda` from the selected command folder up to the workspace root. Other Conda environments can be found on demand
from two user-level locations, and Poetry environments through an explicit project command;
an existing Conda prefix or a Poetry environment with a standard venv layout can also be selected explicitly.
Diagnostics do not verify installed dependencies. Runs record the actual tool path.

A valid `pyproject.toml` with `[tool.poetry]` or the Poetry build backend also offers fixed
`poetry env info --path`, `poetry env list --full-path`, `poetry check`, `poetry run python -m unittest discover`, `poetry run python -m pytest`, and
`poetry build` commands. These use Poetry's own environment selection. An explicitly selected
Python interpreter applies to ordinary `python -m` tasks, not to Poetry commands. The runner
does not install Poetry or query its external virtual environments automatically. Run `poetry env info --path`
to see the selected environment path, or `poetry env list --full-path` to list environments for this project;
both commands run only when you start them. Poetry may load installed plugins. Other commands may
create an environment, run project code, or write build artifacts. The development environment
report probes the configured or host Poetry CLI outside the project directory.
To use Poetry's selected environment for ordinary Python commands and new terminals, explicitly run
`poetry env info --path` in the current subproject, then choose **Use latest Poetry environment**
in Development environment. Review the drafted path and save it for Host validation. This reads
the latest query for the same directory only if it succeeded and its full output remains in the
current Host session and the task catalog still matches the run; a failed query or changed
configuration never falls back to an older path. Persisted run
summaries omit output, so run the query again after restarting the Host. The saved path must have
a valid standard venv or Conda prefix layout.

To choose a different Poetry environment, run `poetry env list --full-path` from Project commands
in the current subproject. Then use **Use latest Poetry environment list** in Development environment.
Only the latest successful, complete output for that same directory and unchanged task catalog is
shown. A failed query does not fall back to an older list. Select a path to fill the draft, then
save for Host validation. Restarting the Host discards the command output and requires a new query.

Mixed directories can expose JavaScript, Rust, Go and CMake commands together. A Cargo.toml
provides `cargo check`, `cargo test` and `cargo build`; a go.mod provides `go test ./...`,
`go build ./...` and `go vet ./...`. Each entry identifies its source manifest and uses the
installed tool. These commands may execute build scripts or tests, write outputs or download
dependencies. Manifest presence does not prove validity; tool errors appear in the output.

If the selected directory contains `GNUmakefile`, `makefile` or `Makefile`, the command list also offers the default `make` target. GNU Make's filename priority selects the source. The app reads up to 256 KiB for the task fingerprint but does not parse or preview rules. An unreadable, outside or oversized file disables only this task, leaving other project commands visible. The app invokes `make` only after you click Run, using the project tool directories or effective PATH. Windows needs a separately installed Make. Review the file first because the default target can build, test or perform other project actions.

A root `go.work` adds modules from common `use ./module`, `use "./module with spaces"`, and `use (...)` declarations,
including modules deeper than the ordinary four-level scan. Each valid in-workspace module gets
separate `go -C module test ./...`, `build ./...`, and `vet ./...` commands at the workspace root.
The root is not treated as one Go module. Paths must be literal relative directories with a
valid `go.mod`. Quoted paths support plain double quotes without escapes. External or linked
directories, escaped paths, and complex comments do not create commands; directory discovery
reports an incomplete result. Go 1.20 or newer supports `-C`.

A `pom.xml` adds `mvn validate`, `mvn test`, and `mvn package`. A `build.gradle`,
`build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts` adds `gradle tasks`,
`gradle test`, and `gradle build`. Conflicting Groovy and Kotlin files of the same kind
block discovery. On Windows, the current directory's `mvnw.cmd` or `gradlew.bat` takes
priority; on macOS/Linux, `mvnw` or `gradlew` takes priority. Only when no wrapper exists
does the runner use a configured tool directory or host Maven/Gradle. A linked, damaged,
or non-executable wrapper blocks the task instead of falling back. The fingerprint covers
root build and settings files, `gradle.properties`, wrapper scripts, and existing wrapper
properties, but not wrapper JARs, plugins, or dependencies. Review the wrapper and build
script: they can run project code, download tools or dependencies, and write files. A Gradle
project without a `test` or `build` task reports the tool's own error in the run output.

The selected directory's `.sln`, `.slnx`, `.csproj`, `.fsproj`, and `.vbproj` files are listed
as separate .NET targets. Each gets fixed `dotnet restore`, `dotnet build`, and `dotnet test`
commands; project files also get `dotnet publish`. The target path is passed as one argument,
so a directory with multiple projects is unambiguous. Discovery scans at most 2,048 directory
entries and 16 targets; each manifest is limited to 256 KiB. The task fingerprint includes the
target file and the nearest `global.json` between the selected directory and registered workspace
root. It does not read ancestor files outside the workspace, imported MSBuild files, NuGet
configuration, or dependencies. Review changes to other files and refresh as needed. Restore,
build, test, and publish may run
custom project targets, download packages, and write files. A Windows `.cmd`/`.bat` dotnet wrapper
rejects target names containing spaces or batch metacharacters; use the dotnet executable for
those names.
The environment view shows `sdk.version` from the nearest in-workspace `global.json` and its
location. When a .NET target or SDK file is present, it also runs a bounded `dotnet --version`
from the selected project directory and displays the SDK selected there or its failure state.
This does not evaluate build targets. The host dotnet probe still runs outside the project.
The view does not model `rollForward`, prerelease policy, or the installed SDK set, and does
not claim that a selected version satisfies the project's policy.

A `CMakeLists.txt` adds `cmake -S . -B build/zicode-studio`,
`cmake --build build/zicode-studio`, and `ctest --test-dir build/zicode-studio --output-on-failure`.
Configure before building or testing. CMake and CTest must already be installed, and CTest must
support `--test-dir`. Output stays in `build/zicode-studio` under the selected project. A file,
link, or reparse point at `build` or `build/zicode-studio` blocks these commands so the fixed
output location cannot resolve outside the project. Configuration executes project CMake code,
which can run programs, fetch dependencies, and write files; review it first. The task fingerprint
includes the root `CMakeLists.txt` but does not resolve included CMake files or dependencies.

When `CMakePresets.json` exists in the project root, configure, build, and test presets in that
file are also listed as `cmake --preset "name"`, `cmake --build --preset "name"`, and
`ctest --preset "name"`. Hidden presets and literal `false` conditions are omitted. CMake
evaluates other conditions, inheritance, included files, and user presets when a command runs.
The list does not discover presets defined only in included files or `CMakeUserPresets.json`.
Presets can write outside the project and run external programs; review project and user presets
before running them. The task fingerprint includes the root `CMakePresets.json` and an existing
`CMakeUserPresets.json`, but not included files. Review the preset and output location after
changing an included file. The fixed `build/zicode-studio` directory guard does not apply to presets.
On Windows, a CMake/CTest `.cmd` wrapper accepts only preset names made of letters, digits,
`_`, `:`, `-`, `.`, or `/`. Use an `.exe` tool or rename other presets so the batch shell cannot
reinterpret the argument.

Open **Project commands** in the project page to discover package.json scripts in the selected directory.
The runner uses packageManager when declared, otherwise local lockfiles or valid pnpm workspace configuration,
then a declared ancestor workspace before falling back to npm. Click **Run project command** on desktop to execute with the
installed manager. The app does not preinstall tools or dependencies, and declared
versions are not enforced. Review the script first; pre/post lifecycle hooks may also execute.
Commands are grouped by source file. Filter the current list by name, command text, source,
or tool; the count shows matches and total commands. Select **Pin** to save a frequent command
on this device for the current workspace and subproject directory. Groups with pinned commands
and pinned entries within each group move to the top. **Pinned commands only** narrows the list.
Expand **Transfer pinned commands** to download this directory's pinned identifiers as JSON, or select a file to preview its source project, directory and current matches. Confirmation merges the identifiers into the current project directory, subject to the 32-item limit. Missing commands remain pinned until discovered again. The plaintext file may reveal task names; keep it private. Import never runs commands or changes the project catalog.
Up to 32 commands per directory and 64 recently saved directory scopes are kept. Clearing local
app storage removes these choices. A command absent from the current catalog is hidden while its
saved ID remains available if it returns. Filtering and pinning affect only the view, not task
IDs, the Host fingerprint, or active runs. Switching workspace or subproject clears the filter
while retaining each directory's pins.

One command can run per workspace (including all its subdirectories), with four active commands per host. Commands continue
when navigating away. Return to **Stop project command** to terminate the task and its
descendants; host shutdown also cleans them up. Interactive input is unavailable.
Scripts run with your host account permissions, environment and network access;
this is not a filesystem sandbox.

The latest run shows stdout, stderr and exit code, retaining the last 64 KiB per stream.
Run summaries survive restarts in local storage: up to 40 per project and 500 in total,
scoped by project directory and workspace ID. Saved fields include task name, directory,
tool category, manifest fingerprint, status, timestamps and exit code. Command text, arguments,
actual tool paths and output remain in memory for this host session, with up to 40 runs retained.
A saved run without a final result shows **Task outcome unknown**; it may belong to another host
session and cannot be stopped here. Unavailable or incomplete storage is reported without blocking
commands; cached results may be stale. Changed manifests require refreshing before running.

On desktop, **Clear command history** asks for confirmation, then clears saved and completed
records for this project while retaining active tasks owned by this host. Failed clearing preserves
records. A task in another host may write its summary again when it finishes. Removing a project
does not clear this separate history; clear it in the project first when needed.
Remote clients can read status and output; start, stop and clear history on desktop.

## Project tool directories

After an environment check, you can explicitly download a JSON snapshot to compare tools across computers. It contains the platform, architecture, check time, tool status and versions, manifest requirements, and package manager selection. It omits the project ID, selected directory name, manifest filenames, and absolute executable paths. The file is plaintext and version declarations may still be private, so review it before sharing. Downloading does not refresh the environment, install tools, or run project commands.
Choose a previously downloaded report JSON to compare tool status, version, and source, plus counts of manifest categories and static requirements. The view also flags differences in directory scope, bundled Pi, and package manager selection. Manifest filenames are omitted, so declarations cannot be matched to individual files within one category; only the first 24 differences are shown, with a remaining count. Files are limited to about 1 MiB and read only in the current view; select the file again after switching projects, directories, or refreshing. Snapshots omit project identity and cannot prove they describe the same project or the imported machine's current state.

Deno projects show the Deno CLI among project tools. A single exact `deno` version in `.tool-versions` or a supported mise config is compared with the detected CLI version; dynamic aliases and multiple candidates still need terminal verification. This comparison does not prove how a version manager selected the CLI.

The development environment report reads `package.json` engines and the selected directory's
`.nvmrc` or `.node-version`. Numeric Node declarations are compared with the detected version
using npm semver rules. Matching files can coexist; differing declarations are shown as a
conflict. Dynamic aliases such as `node` and `lts/*` require a version manager and must be
checked in a system terminal. Diagnostics do not switch Node versions or run project scripts.
The report also probes installed CMake and CTest versions without running the project's CMake code;
it does not compare them against a declared CMake minimum. Root `CMakePresets.json` and
`CMakeUserPresets.json` are reported as present when found; user preset contents are not shown.
Java, Maven, and Gradle version probes use configured or host tools, never the project's wrapper.
The report also probes the configured or host dotnet CLI and lists solution and project files
in the selected directory without evaluating MSBuild targets.

In the desktop **Development environment** view, enter up to eight existing absolute tool directories,
one per line, in search order. New project commands, new terminals and environment probes search them
before the host defaults. Settings stay on this computer, scoped to the project; they do not change
system PATH, install tools or write machine paths into the repository. Only add trusted tool locations;
version diagnostics execute the selected tools.

Save an empty tool list to remove extra tool paths; switch Python back to automatic separately. Refresh the command list after saving. Existing commands
and terminals retain their startup environment. Missing saved directories fail explicitly; repair or
clear them here. Existing processes can still be stopped. Conflicts keep your draft and require a reload;
unconfirmed saves are never retried automatically.

Python offers **Automatic selection** and **Use an existing Python environment**. Automatic mode
prefers `.venv`, then `.conda` in the selected command folder, then tool directories and the host
interpreter. An explicit venv or Conda environment overrides automatic discovery throughout this project.

A standard venv directory contains `pyvenv.cfg`, with `Scripts/python.exe` on Windows or
`bin/python` on macOS/Linux. A Conda prefix contains `conda-meta/history`, with `python.exe`
at its root on Windows or `bin/python` on macOS/Linux. Enter the absolute directory, rather
than an interpreter file. Mixed markers are rejected. Saving checks the directory, interpreter
and tool paths without creating an environment or installing packages. A successful save
refreshes diagnostics and queries the explicitly selected interpreter's version.

**Find local Conda environments** reads this computer's `~/.conda/environments.txt`,
`~/.conda/envs`, and the Host's `CONDA_PREFIX` and `CONDA_ENVS_PATH` without running Conda or Python. It lists only prefixes that still
have a standard Conda layout and interpreter, showing the source for each one. Select an
environment to fill the draft, then save to validate and apply it. The view reports when
all sources are absent, a source cannot be read, no usable environment is found, or a
source limit is reached; you can still enter an absolute prefix manually.
The registry and user directory each inspect at most 256 entries. Up to 16 configured
directories are scanned, with a combined limit of 256 entries.

New commands and terminals put the selected environment paths first. A venv sets `VIRTUAL_ENV`;
a Conda prefix sets `CONDA_PREFIX`. On Windows, existing Conda directories are added in this
order: prefix, Library/mingw-w64/bin, Library/usr/bin, Library/bin, Scripts, bin. Inherited
Python/Conda activation variables are cleared. The app does not run `conda activate` or
activate.d, or load variables stored by `conda env config vars`. Environments that need
activation hooks must be activated by the user in a terminal. Existing processes retain their
startup environment; the terminal label does not track later manual activation. Automatic
mode uses the selected startup directory's `.venv` or `.conda` for new terminals, preferring
`.venv`. A damaged or out-of-project local environment blocks terminal startup instead of
falling back to host Python. The terminal records the environment selected at startup; changing
directories in the shell does not change it. Pi and Git panels keep their own runtime
configuration. Only local `.conda` is discovered automatically. Other Conda/Poetry environments
are not enumerated, and installed dependencies are not verified.

The project overview includes a Git workspace panel with the branch, staged and unstaged
changes, conflicts, and untracked entries. Refresh Git independently or refresh the project.
Changes are scoped to the project folder; the list shows up to 200 entries, with untracked
directories grouped as one entry. Submodule contents are excluded. Ahead/behind counts use
local upstream refs without fetching. Read failures show recovery guidance instead of a clean
working tree. Select **Stage file** on an eligible file and confirm to add its current working
tree content to the index. Git may run configured clean filters. The panel then reloads status.
Select **Unstage file** on an entry with staged changes to reset that file's index state while
keeping working tree content. This removes all staged changes for that file, including partially
staged content. Aggregated untracked directories, paths that cannot be represented exactly, and
entries beyond the displayed list have no corresponding action. If status changed, refresh and
confirm again. If the result is uncertain, refresh before retrying. Commit, working tree restore,
and push are not provided here.

Choose **View unstaged diff** for working tree versus index, or **View staged diff** for index
versus HEAD. Select the same comparison again to refresh; **Close diff** collapses it. The readonly
text supports selection, copy and keyboard scrolling. Untracked files are excluded. Previews are
limited to 2000 lines and 256 KiB; output over 2 MiB asks you to use a Git client. A truncated
preview is not a complete review. Switching projects, refreshing status, staging or unstaging a file closes the old diff.

Expand **Recent commits** to read up to 50 commits per page reachable from HEAD that affect the registered
project folder, in Git's default date order. Expand an entry for its full object ID, author, author
date and selectable commit message. **Refresh commit history** or the project refresh reads again;
switching projects collapses it. An unborn branch, no matching commits and read failure have separate states.
**Older commits** and **Newer commits** keep the HEAD captured by the first read. Refresh to see later
commits and return to the first page. Older hosts without pagination cursors still show recent history;
use your Git client for older records. Author dates use your local
time zone and are not committer dates. Other branches, reflogs and rename-following are excluded;
merge history uses Git's default simplification. Up to 51 records are read to detect older history,
with 50 shown. Author and message previews are limited to 200 and 16384 characters with truncation labels.
Output over 2 MiB or a timeout fails the read. Shallow and partial clones may have incomplete local
history; missing objects must not be treated as an empty history. No signature verification, external
diff drivers, automatic AI handoff or repository writes are performed.

Expand a history entry and choose **View commit changes** for its project-scoped patch; only one
patch is open at a time. Ordinary commits compare with their parent; merge commits compare only
with the first parent, whose full ID is shown. True root commits compare with an empty tree.
Parents are read from the raw commit object so a missing parent at a shallow boundary fails instead
of being shown as a root commit. Renames appear as deletion/addition; binary contents and submodule
changes are not expanded. Previews are capped at 2000 lines and 256 KiB; raw objects or diff output
over 2 MiB fail the read. Truncation is explicit and does not constitute a complete review.
Closing the entry or patch, refreshing history or switching projects discards old replies.
Use **Retry** after fixing missing objects in your Git client. This view does not check out, stage,
restore or apply patches.

After a nonempty diff loads, choose **Prepare review in chat**. The displayed patch, commit ID,
parent, parent count and truncation flag are appended to the current project session's composer,
preserving existing text and attachments. Check the draft and send it yourself. This action does
not read additional files, complete a truncated patch, create a session or send a model request.
The editable prompt asks for evidence and uncertainty without commands or file changes; it does
not change model tool permissions. A scene, project, instance or session change during handoff
stops insertion. An unavailable composer produces an error. The combined draft respects the input's
maximum length and a 1048576 UTF-16 unit cap; overflow leaves the existing text unchanged.
Success means the text reached the current composer. Restart recovery still depends on existing
draft storage, and the action does not validate the selected model's context limit.

Before committing, you can also choose **Prepare review in chat** after a nonempty staged or
unstaged preview loads. Staged changes compare index against HEAD; unstaged changes compare the
working tree against index. Untracked files are excluded. The draft carries the comparison type,
frontend receipt time and truncation flag. This time is not a commit date or proof of an atomic
repository snapshot. Select the comparison again to refresh if files, index or HEAD have changed.
Handoff uses the displayed preview without re-reading, staging files or combining comparisons.
Commit-history reviews continue to carry their immutable object and parent IDs. Failed, loading
or empty previews have no handoff button; a project, comparison or reader change hides old content.

Projects group a goal, tasks expose execution state, and automations trigger recurring work. Together they turn an isolated chat into a sustainable workflow.

> Current default state: **Tasks**, **Automation**, and **Projects** are
> enabled and ready to use. The project workspace aggregates the current
> project's overview, context, knowledge connections, search, and activity;
> project instructions written under "Project context" are injected into the
> project's conversations as shared project-level context.

## When to create a project

Create a project when work spans multiple sessions, stages, or deliverables. A project brings its conversations, task progress, artifacts, and recent activity together.

## Managing projects (a project is a workspace)

- Click **Manage projects** at the top of the Projects app (or the workspace
  switcher in the top bar) to see every project (workspace) and switch
  between them; **Open folder as workspace** creates a new project by
  selecting a folder.
- **Project context** edits the current project's instructions (injected
  into that project's conversations) and budget; Knowledge connections,
  Project search, and Recent activity surface content bound to the current
  project.
  Unsaved context is kept for up to 32 recently visited project scopes in this
  window. Editing also attempts to write an encrypted local recovery copy. After
  closing or restarting the app, use **Local project context recovery** to preview,
  restore or discard a copy. Keep the window open while a recovery write is pending.
  Copies from separate windows remain separate and never overwrite the saved profile
  automatically. Restoring merges fields with the latest saved version; choose a value
  for each conflicting field before saving. Recovery copies stay in this device
  profile, not in a backup or device sync. Discard old copies you no longer need.
  At most 128 copies are stored. Unreadable copies are counted, and identifiable damaged copies
  can be removed after confirmation. When the limit is reached, new copies are not written until
  you discard old ones.
  Readable copies can also be downloaded as JSON for review before cleanup. The file includes the
  project name, capture time, draft and saved base, but not the browser's internal scope or copy ID.
  The downloaded file is plaintext; keep it private. Downloading does not save the draft to the project.
  To import it, open **Local project context recovery** in the destination project and choose the JSON file. The app checks its size and format, shows the source and destination, and adds an encrypted recovery copy after confirmation. Import does not change the editor or saved profile. Use **Restore recovery copy** to review the merge before saving.
  Before confirming import, review the file's project instructions, default scene and budget. Recovery copies show the same three fields in their preview before restoration.
  You can also download the current saved project context when there is no unsaved draft. Importing that file uses the destination project's loaded saved version as the comparison base and first creates a recovery copy. Restoring then applies the file's fields, with per-field choices if the destination changed afterward. Download and import do not directly write the project profile. The file is plaintext; keep it private.
  If you switch projects after confirming, the import still targets the project shown at confirmation. Return to that project and refresh its recovery list to see the result.
- Deleting a project moves it to the recycle bin: choose delete from a
  workspace's row in the switcher, and the project's ZiCode app data (the
  `.zicode` folder) moves into `%LOCALAPPDATA%\zicode\trash\`, then the
  workspace is un-registered from the list. A **Recycle bin** section at the
  bottom of the switcher restores a deleted project back to its original
  folder in one click. Your own project files (source, documents, etc.) are
  never deleted. The global shared workspace and the Agent Inbox workspace
  are protected and cannot be deleted.

## Search across project content

Open **More → Projects → Project search** and enter a query to search conversations, notes, files,
and artifacts in the current project together. The visible **Project search** label remains after typing.
On phones, each result stacks its type, title, and path or excerpt vertically so narrow columns do not
hide useful context. Results always remain scoped to the active project.

## Inspect project storage

After a second successful scan, the page compares logical directory sizes and file counts with the
previous successful scan, sorted by the magnitude of size changes. Only two complete observations
produce a numeric change. Linked, partial, unreadable, or unobserved directories remain unknown;
a missing record is not treated as deletion. Failed scans do not replace the comparison baseline.
Comparisons stay in the current page's memory, reset when projects or subprojects change, and do not
survive a restart. Reduced logical size does not measure freed disk space.

In the desktop app, open **More → Projects → Project storage** to scan common generated
directories in the current workspace or selected subproject. Results are sorted by
observed logical size and show incomplete scans and hard links that may reduce actual
space reclaimed. The view also shows available space on the selected directory's volume
at scan time; this is not an estimate of space reclaimed by removing an entry.
Guidance distinguishes build output, installed dependencies, Python
environments, and caches; a directory name alone does not mean it is safe to remove.
The scan also recognizes common Python check caches, coverage reports, SvelteKit/Nuxt
output, and .NET `obj` directories.
You can open a directory to inspect it. This view does not delete files.

## Task states

| State | Meaning | Actions |
|---|---|---|
| Scheduled | A recurring template waiting for its next trigger | Edit, pause schedule, delete |
| Pending | Created or approved, waiting to be dispatched | Approve and run, cancel |
| Running | The agent is executing | Pause, cancel |
| Paused | State is preserved | Resume, cancel |
| Failed | Execution hit an error | Inspect, retry |
| Completed | A result was produced | Open artifacts, run again |

Pause, resume, cancel, and retry operate on the real background task, not just its visual label.
A scheduled template never runs by itself; when due, the task app spawns a
fresh “Pending” instance.

On phones, Task Center arranges running, needs-input, failed, and completed summaries in a 2×2 grid.
Task actions use equal-width buttons, and the history heading has a full touch target. Long project names,
timestamps, and other values wrap instead of hiding important information behind an ellipsis.

## Creating and managing tasks in the task center

The task center is not just an inbox for background work: you can create and
manage tasks directly, without going through a conversation or the inbox first.

- **New task**: fill in the title, instructions, and target project; choose a
  trigger — manual, every N minutes, or daily at HH:MM; choose an
  **execution mode** — run automatically (full access, executes when due) or
  confirm before every run (default permission, waits for your approval in the
  task center) — and set the retry limit.
- **Manual tasks** appear in the list after creation; they either run
  automatically or wait for your **Approve and run** click, depending on the
  approval setting.
- **Scheduled tasks** are shown as “Scheduled” template cards with their
  schedule (for example “Daily at 09:00”) and next run time. When due, the task
  app spawns a fresh instance automatically and runs it (auto-dispatch depends
  on the approval setting). You can edit the title, instructions, target,
  trigger and time, pause the schedule, or delete the template.
- **Edit tasks**: every one-off and scheduled task card has an **Edit** entry;
  saving applies immediately and scheduled tasks recompute their next run.
- **Group by workspace**: the list header toggle groups tasks by their target
  project, with the project path and count in each group header (a default
  group holds tasks without a project).
- **Pin**: every task card can be pinned so it stays at the top of every list.
- **Search**: the search box above the list filters tasks by title or
  description in real time, stacking with the status filters.
- **Continue**: tasks with a bound child session show a primary **Continue**
  button that opens that task's conversation so you can keep working.
- **Run again**: completed/cancelled one-off tasks can be rerun with the same
  settings (a fresh manual task is dispatched); automation-sourced tasks rerun
  their owning workflow.
- **Elapsed time**: running tasks show "N m running" next to the status.
- **Archive**: completed/cancelled tasks can be archived (hidden but kept); an
  **Archived** filter lists them, and archived tasks can be restored.
- **Scheduled filter**: the left navigation shows only scheduled templates, so
  you can manage them together.

## Saving tasks from multiple windows

Task lists are stored per workspace. If another window or background operation changes the list,
the app rejects an outdated save. Refresh, review the latest tasks, and retry. A failed task creation
keeps its form open. If another process is saving, wait briefly and refresh again. If this persists,
preserve the task file and investigate running processes before removing any lock.

Automation rules use their own revision and file lock; see Automation rules below.

## Automation rules

Automations suit recurring summaries, stable prompts, and repeated research. Define the trigger, scene and model policy, output location, and failure behavior before enabling a rule.

In **More → Automation**, enter a name, target project, and task instructions; choose a manual, hourly,
or daily schedule; then set the per-run cost, retry limit, and execution mode. The new-workflow form
also has a **Start from a template** grid: built-in templates (daily tech brief, weekly work report,
daily study plan, code review sweep, news digest, nightly memory consolidation) prefill the name,
prompt and schedule in one click, and you can adjust them or reset with **Use custom**. The nightly
memory template runs at 23:30 and asks the agent to review the day's sessions and project records,
deduplicate, and consolidate memory — complementing the memory panel in Settings and `/memory` in
chat. The search box above the list filters workflows by title or prompt in real time. **Create
automation** adds the new rule to the list immediately. On phones, these fields use a 16px input
font and touch targets at least 40px high to avoid focus zoom and missed taps. Every field retains
a visible label after entry, and tapping that label focuses the associated control.
Existing workflow cards can be **Duplicated** into a new workflow with the
same configuration (title gets a "(copy)" suffix, history is cleared, next run
is recomputed) — handy for deriving variants from an existing rule.

### When automation runs on its own

- Workflows with **Run automatically (full access)** dispatch automatically to
  the target project when due; no manual Approve click is needed in the task
  center. File writes, deletions, scripts, and network actions will not ask
  for confirmation one by one, so keep this for trusted, recoverable tasks.
- Workflows with **Confirm before every run (default permission)** stop in
  "needs approval" state when due and only start after you approve them in the
  task center; writes outside the workspace, deletions, scripts, and network
  access still ask for confirmation before executing.
- While the desktop Host runs, it checks rules in every registered workspace regardless
  of the active view or selected workspace. A rule's target project may differ from
  its storage workspace. If multiple desktop or background processes run, only one
  holds the automation execution lease. Tasks requiring approval still wait in the
  Task center.
- The desktop Automation center shows rule, due, and task status counts and file
  errors across registered workspaces. This is a read only snapshot: a due count does
  not mean those rules have run. LAN browsers do not show this inventory yet.
- You can start or stop a separate background process from the desktop Automation
  center. Once started, it can keep checking schedules after desktop windows close.
  If you stop it and close every desktop process, scheduled work stops. You can also
  enable **Start background automation when I sign in** for the next sign in. It is
  off by default and does not start the process in the current session; use **Start
  background worker** for that.
- Tasks dispatched to the target project are marked completed automatically
  when the project agent finishes, with a notification that includes the
  result summary; failures notify too, and can be retried from the Task
  center.

> Automation never bypasses scene isolation, plugin permissions, or model budgets.

### Saving automation drafts

**Save automation draft** keeps unfinished form content, including empty task instructions.
Drafts are never scheduled. Refresh, restore or delete them from the draft list; saved content remains locally available in the same workspace after restarting the app.
Saving a draft while editing an existing automation creates an independent copy and leaves the live workflow unchanged.
After restoring, choose **Create automation** to create a new workflow. Creating it does not delete the saved draft.
Switching workspaces clears the form; unsaved edits are not retained. A draft's target project may differ from its storage workspace.

Saving live automation rules checks the file revision and uses an exclusive lock and atomic replacement. If another window changed the rules, keep your form content and refresh before editing again. A damaged or oversized rule file is not treated as an empty list. Run-history updates retry a small number of revision conflicts. Live rules are limited to 200 entries and 8 MiB per workspace.
Editing an existing rule updates form fields while preserving the latest run history, last-run time, and approval state from storage. The next-run time changes only when the enabled state or schedule changes.
A new-workflow form keeps one ID for its current creation. If a save response is lost, submitting the retained form again first compares any saved rule with that ID. Matching content confirms the earlier save; different content requires a refresh.

On a conflict, preserve any inputs you need, refresh the list, then restore the latest draft and merge your changes.
Invalid or oversized files are not replaced with an empty list. Storage is limited to 200 drafts and 8 MiB per workspace.


### Subproject environment diagnostics

Use **Environment directory** in **Development environment** to inspect a discovered subproject's manifests and Python selection. The report identifies its directory. Switching directories hides the old report immediately; late responses do not replace the current selection. Tool paths and the explicit Python environment remain workspace-wide settings.

Discovery shares the command runner's ordinary scan and declaration expansion described above. It skips hidden, dependency, build and linked directories, and reports limits, access errors or unsupported declarations. **Refresh project directories** rescans folders; **Check environment again** refreshes the chosen report. Environment checks and the command runner share the current subproject directory. Switching views, refreshing, or returning to a project keeps this window-session selection and does not alter existing commands or terminals.

The Host validates the relative directory again for each request. Missing, linked, or out-of-workspace directories produce an error. If an older Host does not confirm the requested subdirectory, its root report is not displayed as a subproject result: update the Host or select the root. This checks individual manifests; it does not resolve a full monorepo dependency graph or all inherited parent configuration, and starts no project tasks.


### Current subproject context

The environment, command and terminal views display **Current subproject**. Selecting a directory carries it across these views; terminal selection applies only to subsequently opened terminals. Selections are isolated by scene, workspace, and project path, and kept only in the current window: up to 64 recently used non-root selections. Closing the window resets them to the root; no repository files or cross-device state are written. Terminals keep their own startup working directory.

Changing directories or refreshing a catalog immediately hides old commands. A subdirectory catalog is displayed only when the Host confirms its directory; older Hosts can still use root catalogs but need updating for subdirectories. Starting commands waits for the first run-status read and is disabled after a status refresh failure. If a selected directory disappears, it remains selected with an error until you choose another; commands are not silently redirected to the root.


### Subproject terminal startup directory

**Directory for new terminals** shares the current subproject selection; use **Refresh project directories** to discover folders again. Before opening, the Host checks the directory is still inside the registered workspace and rejects parent traversal, absolute paths, directory links and Windows reparse points. Changing the selection sends no cd command to existing shells and does not move or close their sessions.

Session buttons and details show the startup directory. This label does not track later cd commands. Older Hosts show **Not reported by this host** when the directory field is absent. Subdirectory startup uses a distinct operation: an older Host prompts you to update or select the root, without silently retrying at the root. A timed-out or unconfirmed request may already have created a terminal; refresh the list before retrying. On supporting Hosts, retries use the original intent ID and return an existing retained session if the first request succeeded. An intent whose session has been evicted is rejected during the Host's bounded recent-intent retention window.

Listing, input, stopping and limits remain scoped to the original workspace: two active terminals per workspace and eight per Host. New terminals inherit workspace tool paths and explicit Python selection; automatic mode uses the startup directory's .venv or .conda when present. Interactive terminals remain desktop-only.


### Subproject package manager sources

Commands and environment diagnostics share a selector and display the manager, configuration
directory, source and any version declaration:

1. The current package's explicit `packageManager` wins (npm/pnpm/yarn/bun, at most 200 bytes).
2. Otherwise local Bun, pnpm, Yarn or npm lockfiles and a valid `pnpm-workspace.yaml` select the
   manager. Evidence for different managers is an error; multiple lockfiles for the same manager are allowed.
3. Without local evidence, look upward inside the registered workspace, at most 32 levels.
   Inherit only from the nearest JS/pnpm workspace declaration that includes the current package
   without excluding it. pnpm declarations take precedence over JS workspaces. If that nearest
   declaration does not include the package, stop inheritance and use the current package's default npm.
4. Without a matching declaration, default to npm. Invalid/unsupported declarations or inaccessible
   configuration are reported instead of silently skipped. Repair and refresh, or set the current
   package's packageManager explicitly.

Environment diagnostics compare the inherited version declaration against the existing tool
report. This does not install tools, activate Corepack or enforce a tool version. Scripts still
run from the selected package directory. Changes to the effective manager, version declaration,
configuration directory or source change the task fingerprint and require a catalog refresh.
This inherits manager selection only, not engines, dependencies, environment variables or all
package-manager settings.
