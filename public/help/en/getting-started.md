# Quick start

ZiCode Studio Desktop is a local-first personal developer platform connecting project development, AI collaboration, knowledge, automation, and delivery. Every session is bound to a scene, workspace, and isolated runtime.

## Open a project

Open an existing project folder as a workspace, then open **Projects**. In **Development environment**, check project declarations, tools, and version requirements. Select the relevant subproject directory for a multi-directory project.

Refresh **Project commands**, review the command and working directory, and start it explicitly. Discovery and environment checks do not install dependencies or execute project scripts. Review the run status, exit code, and retained output; use **Project terminal** for an interactive shell. Leaving a page does not stop its processes; exiting the desktop Host stops managed processes.

Command execution, stopping, and interactive terminals are desktop controls. Mobile and remote views do not expose these local controls. See [Projects, tasks, and automation](projects-tasks.md).

## Create a session

1. Select a workspace in the function area.
2. Open **Settings → General → New session scene** and choose the scene for the next session.
3. Select **New session** at the top of the function area.

> Changing the scene selection only affects new sessions. It does not modify the current running session.

## Send a message

- `Enter` sends a message, or steers the agent while it is working.
- `Alt+Enter` queues a follow-up.
- Type `//` to send ordinary text that begins with `/`.

## Configure models

Open **Settings → Configuration**. The page identifies the scene being edited. API keys, model channels, and `models.json` belong only to that scene. Add your chosen provider or local compatible service explicitly, then refresh its catalog or test the connection. Empty configuration does not select a provider automatically.

## Keep project knowledge

Create a notebook in **Notes** and record decisions or investigation results. Link related notes and sources. Project knowledge actions and run analysis can prepare a chat draft while preserving existing input; review it and send it yourself. Saved reports and other results are available in [Artifacts](artifacts.md).

## Create tasks and automation

Create a task, review its target project, approval requirement, and cost limit, then choose manual, interval, or daily scheduling. A saved draft does not run. Enabled scheduled templates create task instances when due; instances requiring approval wait for you to approve them. Review status and results before retrying or cancelling.

Automation templates fill in instructions and a schedule. Review the target, approval, and budget before saving and enabling the workflow. The desktop Host handles due work while it is running.

To continue work after closing the window, explicitly select **Start background worker** in Automation and check its running status. Enable **Start background automation when I sign in** if you want it to start at the next system login. Closing a window does not itself start a worker, and a running worker does not prove a task succeeded; check task results separately.

## Start from a template

New sessions show **Start from a template** on the welcome screen (tech blog
post, translate, organize notes, review code, brainstorm, analyze data) —
clicking one pre-fills the composer so you can add details and send. Add your
own templates under **Settings → General → Conversation templates**, and
export/import them as JSON to move them between devices. See
[Conversation templates](templates.md).

Continue with [Scenes and isolation](scenes.md) or [Models and API keys](models.md).
