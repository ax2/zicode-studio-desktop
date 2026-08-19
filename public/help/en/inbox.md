# Agent Inbox

Agent Inbox turns messages your bot receives on Feishu or WeCom into pending
tasks inside the desktop app. You approve a task, it dispatches to the project
agent, and the result comes back here.

In one line: **external message → pending task → you approve → agent runs →
result returns**.

## Why it exists

Requests from colleagues or groups do not get lost while you are away: messages
queue safely in the inbox until you are back at the desktop and approve them one
by one. Execution always happens in your local projects, never through an
external service.

## Start in three steps

1. **Connect a platform**: configure a Feishu or WeCom bot in
   **Settings → Agent Inbox** (steps below).
2. **Send a message**: message the bot from your account, for example
   "Summarize this week's project progress".
3. **Approve and review**: when the task arrives on the desktop, click
   **Approve and run** in the Agent Inbox panel or the Task app; the agent works
   in the target project, then **Open session** shows the result.

## Connect Feishu

1. Create an enterprise self-built app in the Feishu Open Platform, enable the
   bot capability, and copy the **App ID** (like `cli_xxx`) and **App Secret**.
2. In **Event subscriptions**, set the message-received event delivery to
   **long connection** (WebSocket) — no public callback URL is needed.
3. Publish the app to your company, then fill in the **Channel chat_id**; to
   restrict usage, add an **Allowed user open_id** (optional).
4. Save the Feishu configuration, then @ the bot in a group or chat with it.

## Connect WeCom

1. Create a WeCom group bot or app bot and copy the **Bot ID**.
2. Enter the Bot ID; fill **userid** for one-to-one chats or **chatid** for
   groups.
3. Save and start messaging the bot.

## Daily use

- **Approve**: new tasks appear in the Agent Inbox panel on the right of the
  conversation, or in the Task app's pending list; click **Approve and run** to
  dispatch to the project agent.
- **Track**: running tasks can be paused, cancelled, or retried in the Task app;
  failed tasks show the reason.
- **Results**: finished tasks return to the inbox; **Open session** jumps to the
  real conversation where the agent worked.
- **Manage**: all tasks live in the **Task** app; the conversation panel is the
  inbox and approval entry point.

## Safety

- Messages are stored only in an isolated local inbox session and never sent out.
- Dispatching requires your explicit approval on the desktop; external
  instructions never run silently.
- Bot secrets stay in the local credential store; the UI only shows prefixes.
