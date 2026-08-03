# Projects, tasks, and automation

Projects group a goal, tasks expose execution state, and automations trigger recurring work. Together they turn an isolated chat into a sustainable workflow.

## When to create a project

Create a project when work spans multiple sessions, stages, or deliverables. A project brings its conversations, task progress, artifacts, and recent activity together.

## Search across project content

Open **More → Projects → Project search** and enter a query to search conversations, notes, files,
and artifacts in the current project together. The visible **Project search** label remains after typing.
On phones, each result stacks its type, title, and path or excerpt vertically so narrow columns do not
hide useful context. Results always remain scoped to the active project.

## Task states

| State | Meaning | Actions |
|---|---|---|
| Running | The agent is executing | Pause, cancel |
| Paused | State is preserved | Resume, cancel |
| Failed | Execution hit an error | Inspect, retry |
| Completed | A result was produced | Open artifacts, run again |

Pause, resume, cancel, and retry operate on the real background task, not just its visual label.

On phones, Task Center arranges running, needs-input, failed, and completed summaries in a 2×2 grid.
Task actions use equal-width buttons, and the history heading has a full touch target. Long project names,
timestamps, and other values wrap instead of hiding important information behind an ellipsis.

## Automation rules

Automations suit recurring summaries, stable prompts, and repeated research. Define the trigger, scene and model policy, output location, and failure behavior before enabling a rule.

In **More → Automation**, enter a name, target project, and task instructions; choose a manual, hourly,
or daily schedule; then set the per-run cost, retry limit, and approval requirement. **Create automation**
adds the new rule to the list immediately. On phones, these fields use a 16px input font and touch targets
at least 40px high to avoid focus zoom and missed taps. Every field retains a visible label after entry,
and tapping that label focuses the associated control.

> Automation never bypasses scene isolation, plugin permissions, or model budgets.
