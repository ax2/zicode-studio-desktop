# Models and API keys

Model and credential configuration is scoped to the scene shown at the top of **Settings → Configuration**.

## API keys

Add or update provider credentials in the API keys section. The desktop host stores secret values in the operating-system credential vault; scene configuration keeps only non-sensitive references. Secrets are not rendered back into the interface or written to `models.json`, logs, or documentation.

## Model channels

Custom channels can point to OpenAI-, Anthropic-, or Google-compatible endpoints. Each channel declares its protocol, base URL, and model identifiers.

## QVeris model gateway

When a QVeris key is configured, the application can synchronize the model catalog through the QVeris model gateway. Use refresh after changing the key or gateway configuration.

Use **Edit** on the QVeris channel to change its Base URL. Its provider ID remains locked to
`qveris` so existing model references remain valid. Credentials and model catalogs are isolated by
scene; a key configured in Finance is not copied automatically into Programming.

## Advanced files

The advanced editors expose the scene's agent configuration and `models.json`. Changes apply without restarting the desktop application.
