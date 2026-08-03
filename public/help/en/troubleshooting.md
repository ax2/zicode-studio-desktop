# Troubleshooting

Start by checking the active scene, task state, and friendly error card. ZiCode aims to provide an actionable next step instead of exposing only a technical exception.

## QVeris models do not appear

1. Open Settings → Configuration and confirm the scene being edited.
2. Check the QVeris Model Gateway URL and API-key status.
3. Save, then refresh the model list.
4. If the gateway is unreachable, check the private network and service health.

## A request fails or appears unresponsive

- Inspect the friendly error card and retry the original request.
- Open model settings and confirm the selected model still exists.
- Open Tasks to see whether execution is running, paused, failed, or cancelled.
- Try a new session to distinguish session state from global configuration.

## A plugin cannot run

- Confirm that the plugin is enabled and required capabilities are granted.
- Signed plugins must provide a WASI module; JavaScript workers are for local developer packages.
- Inspect package-size, signature, and timeout errors.

## Notes site build fails

Open the publishing log, verify the Astro project files, and check access to the dependency registry. A successful build must produce `dist/index.html`.

## Still blocked

Record the scene name, steps, error time, and non-sensitive logs. Never paste complete API keys, cookies, tokens, or account credentials.
