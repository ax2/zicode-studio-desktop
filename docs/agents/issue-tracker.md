# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `ax2/zicode-studio-desktop`. Use the `gh` CLI for all operations.

This clone also has a read-only `upstream` remote at `shixin-guo/picot`. `gh` may select that remote by default even though `origin` points here. Pass `-R ax2/zicode-studio-desktop` to every `gh issue`, `gh pr`, and `gh run` command. Before a write, verify the selected repository with `gh repo view ax2/zicode-studio-desktop --json nameWithOwner`. For `gh api`, use a full `repos/ax2/zicode-studio-desktop/...` path.

## Conventions

- **Create an issue**: `gh issue create -R ax2/zicode-studio-desktop --title "..." --body-file <file>`. Use a body file for multi-line text.
- **Read an issue**: `gh issue view <number> -R ax2/zicode-studio-desktop --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list -R ax2/zicode-studio-desktop --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R ax2/zicode-studio-desktop --body-file <file>`
- **Apply / remove labels**: `gh issue edit <number> -R ax2/zicode-studio-desktop --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R ax2/zicode-studio-desktop --comment "..."`

Read `git remote -v` for context, but do not assume `gh` will choose `origin` in a multi-remote clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> -R ax2/zicode-studio-desktop --comments` and `gh pr diff <number> -R ax2/zicode-studio-desktop` for the diff.
- **List external PRs for triage**: `gh pr list -R ax2/zicode-studio-desktop --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment -R ax2/zicode-studio-desktop`, `gh pr edit -R ax2/zicode-studio-desktop --add-label`/`--remove-label`, `gh pr close -R ax2/zicode-studio-desktop`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42 -R ax2/zicode-studio-desktop` and fall back to `gh issue view 42 -R ax2/zicode-studio-desktop`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R ax2/zicode-studio-desktop --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create -R ax2/zicode-studio-desktop --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/ax2/zicode-studio-desktop/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/ax2/zicode-studio-desktop/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list -R ax2/zicode-studio-desktop --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> -R ax2/zicode-studio-desktop --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> -R ax2/zicode-studio-desktop --body-file <file>`, then `gh issue close <n> -R ax2/zicode-studio-desktop`, then append a context pointer (gist + link) to the map's Decisions-so-far.
