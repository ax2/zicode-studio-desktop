# Projects, tasks, and automation

Projects group a goal, tasks expose execution state, and automations trigger recurring work. Together they turn an isolated chat into a sustainable workflow.

> Current default state: **Tasks** and **Automation** are enabled and ready
> to use; the **Projects** plugin is disabled by default. Enable it in Plugin
> Manager first, after which it appears in the More menu. The project rules
> below apply once enabled.

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
  trigger — manual, every N minutes, or daily at HH:MM; optionally require
  approval before every run and set the retry limit.
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
- **Scheduled filter**: the left navigation shows only scheduled templates, so
  you can manage them together.

## Automation rules

Automations suit recurring summaries, stable prompts, and repeated research. Define the trigger, scene and model policy, output location, and failure behavior before enabling a rule.

In **More → Automation**, enter a name, target project, and task instructions; choose a manual, hourly,
or daily schedule; then set the per-run cost, retry limit, and approval requirement. **Create automation**
adds the new rule to the list immediately. On phones, these fields use a 16px input font and touch targets
at least 40px high to avoid focus zoom and missed taps. Every field retains a visible label after entry,
and tapping that label focuses the associated control.

### When automation runs on its own

- Workflows created without "Require approval before every run" dispatch
  automatically to the target project when due; no manual Approve click is
  needed in the task center. The creation form shows a matching hint.
- Workflows that require approval stop in "needs approval" state when due and
  only start after you approve them in the Agent Inbox runtime panel.
- The scheduler runs for the whole time the app is open, regardless of which
  view you are on. Nothing runs while the app is completely closed (an
  unattended background runner is planned for a later release).
- Tasks dispatched to the target project are marked completed automatically
  when the project agent finishes, with a notification that includes the
  result summary; failures notify too, and can be retried from the Task
  center.

> Automation never bypasses scene isolation, plugin permissions, or model budgets.
