# Quick start

ZiCode Studio Desktop is a local, multi-scene agent workspace. Every session is bound to a scene, workspace, and isolated runtime.

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

Open **Settings → Configuration**. The page identifies the scene being edited. API keys, model channels, and `models.json` belong only to that scene.

## Start from a template

New sessions show **Start from a template** on the welcome screen (tech blog
post, translate, organize notes, review code, brainstorm, analyze data) —
clicking one pre-fills the composer so you can add details and send. Add your
own templates under **Settings → General → Conversation templates**, and
export/import them as JSON to move them between devices. See
[Conversation templates](templates.md).

Continue with [Scenes and isolation](scenes.md) or [Models and API keys](models.md).
