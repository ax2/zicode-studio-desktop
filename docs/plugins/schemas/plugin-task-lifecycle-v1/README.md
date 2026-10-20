# Plugin task lifecycle preview schemas

These draft JSON Schemas define the View-facing bodies for `plugin.task.lifecycle.v1@1.0.0-preview.1`:

| File | Route or type |
| --- | --- |
| `submit.request.schema.json` | `POST /v2/plugin-tasks/submit` |
| `snapshot.request.schema.json` | `POST /v2/plugin-tasks/snapshot` |
| `events.request.schema.json` | `POST /v2/plugin-tasks/events` |
| `events.response.schema.json` | bounded event page and cursor state |
| `confirm.request.schema.json` | `POST /v2/plugin-tasks/confirm` |
| `cancel.request.schema.json` | `POST /v2/plugin-tasks/cancel` |
| `task.response.schema.json` | successful submit, snapshot and confirmation response |
| `cancel.response.schema.json` | cancellation acknowledgement |
| `error.response.schema.json` | stable error envelope |
| `common.schema.json` | shared task, step, event, terminal and error definitions |

Owner identity and desktop authentication are deliberately absent from these View-facing schemas. A trusted Studio parent bridge injects verified identity into the internal Host request; the View never receives the desktop token or supplies workspace, plugin, runtime, permission, grant, result, path or resource references. The generic submit `input` is validated against a separate operation-specific schema before Host creates a task.

JSON Schema expresses field shape and local bounds only. Host conformance must additionally enforce owner isolation, idempotency equality, legal state transitions, ordered event persistence, cursor relationships, cancellation finality, confirmation binding, redaction and restart recovery. These schemas are draft material: the Host runtime does not implement or advertise them yet, and a provider manifest must not claim compatibility until Studio publishes a supported profile version.
