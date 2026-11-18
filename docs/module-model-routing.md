# Module model selection

Tracked in [#79](https://github.com/ax2/zicode-studio-desktop/issues/79), v0.6.5.

## Browser

Configure providers and several model IDs in the existing model-channel settings. Open Browser, read the current page, then use **Browser model** in the page assistant. **Follow Pi** is the default; selecting another available provider/model changes only the browser. In tools-only mode, **Load Pi models** explicitly opens the existing Pi conversation before loading metadata. Opening Browser alone does not start Pi or send page contents.

The destination is visible before **Send page and ask** or **Send page and summarize**. Only these explicit buttons send the reviewed captured text (and optional attachments selected by the user). The result is inert text with model identity and reported token usage. Existing Chat draft/summary/compare actions remain available. Independent browser requests use Pi's live ModelRegistry/authentication and never change Chat's current model or append to its history. They do not run the agent loop or expose tools to website text.

Per Pi agent root, `module-models.json` contains only model references:

```json
{"schemaVersion":1,"browser":null}
```

An override is `{"schemaVersion":1,"browser":{"provider":"openai-studio","modelId":"gpt-6-luna"}}`. This is an example reference, not an installed credential or a claim about provider capabilities. Save through `save_module_model` with the current `expectedRevision`; the store uses an exclusive lock, synced temporary file and replacement. Corrupt/oversized/linked files are rejected without resetting them. No API keys, provider headers or endpoint credentials are persisted in this file or returned to the browser.

Available model choices use Pi's actual API/provider definitions, including OpenAI Responses. A missing/disabled explicit choice fails rather than selecting another model. Requests bind the route revision and provider/model/API/base-URL fingerprint, allow one in-flight browser call per agent root, expire at 30 seconds, request at most 1,024 output tokens, and disable automatic retries. Prompt/result limits are 256/128 KiB respectively. Cancellation, source/conversation changes and panel disposal cannot redirect an in-flight call to another session. Model-channel/auth changes cancel matching in-flight module work. Responses remain untrusted data.

## Visual assets

Open **Image model settings** in image generation or outfit creation. The original manual endpoint/model/capability form, including manually configured local services, stays available. Use **Save and use this model** to retain named configurations, **Load saved models** to list them, then **Active image model** to switch. Reading, saving and switching do not generate an image. Image submission keeps its existing reviewed-plan/confirmation flow and capability checks; a model name never grants generation/edit support.

Up to 32 named configurations are stored per workspace/scene in the existing machine-local `image-creation.sqlite`: `image_model_profile` holds metadata and `image_model_selection` records the active ID. `image_settings` remains the active settings source. The first distinct named replacement retains the previously configured valid image model. Existing jobs/images and their original plans remain unchanged. Manual saving clears only the named selection, preserving the saved list. Removing a named entry requires confirmation and retains active settings, existing jobs, images and endpoint credentials.

Image credentials remain in the existing image-endpoint credential vault; models at the same image API endpoint share that endpoint's credential. Chat/Pi credentials are separate. Saving a named entry with a newly typed key is explicit. Selecting another saved entry clears the unsaved typed key instead of forwarding it. Local service support is retained without additional optimization or compatibility claims. Visual assets retain their configured image endpoint instead of inheriting an unrelated text-only Pi model.

## Verification and deployment

[Windows automated receipt](iterations/evidence/2026-11-18-module-model-routing.json) records actual locked Pi 1.5.2 JSONL requests to local Chat Completions/Responses services, cancellation, process restart and unchanged Chat state/history. Rust tests send an actual Images-compatible HTTP request to the selected saved endpoint and verify the PNG response. JavaScript component tests cover the frontend paths, unavailable/stale model rejection and no implicit model calls.

Tests use only generated synthetic credentials and loopback services; no paid provider or user profile is read. The main session owns daily/named-test credential deployment, optional controlled real-provider calls, builds/installation and consolidated native UI acceptance. The separate named-test-profile change in PR #81 keeps ordinary isolation credential-disabled. This module does not relax that policy, alter the Agent core, run scheduled work or modify frozen v0.6.4 deliveries.
