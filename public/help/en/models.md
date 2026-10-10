# Models and API keys

Model channels and credentials are scoped to the scene shown at the top of **Settings → Configuration**.

## Configure your model channels

Add a provider ID, protocol, Base URL and model IDs in **Custom model channels**. OpenAI-, Anthropic- and Google-compatible protocols are supported. Disable Bearer authentication for a local service that does not require a key.
The optional **Display name** appears in this scene's channel row and model list. The channel ID remains the stable identifier, so renaming the display label does not change existing model references. The name is limited to 100 readable characters; clearing it restores the default label.
Use **Model details JSON** for optional metadata keyed by model ID, for example `{"my-model":{"name":"Local model","contextWindow":128000,"maxTokens":8192,"cost":{"input":0,"output":0}}}`. Prices are USD per million tokens. Existing fields omitted here are retained; remove old metadata in the advanced `models.json` editor. Verify actual provider prices before saving.
Use **Copy channel** to prefill the URL, protocol, authentication mode, and model IDs. Copied models retain their configuration metadata. Enter a new channel ID and a separate key if needed. If the source changes while you edit, refresh and copy it again. A copy cannot overwrite an existing ID.
**Test connection** checks the selected channel on demand. When it has a model, the check sends one short model request, which may incur provider charges, and updates that model's health. OpenAI-compatible and QVeris channels with no models only read the catalog without saving it. A configuration change during the check invalidates the result.
With Bearer authentication disabled, the channel configuration drops its API key reference and the editor does not accept a new key. An existing system credential is retained until you remove it separately from the API keys list.
Use **Disable channel** or **Enable channel** on a channel row to change only that scene's `enabled` state. The models, URL, and system credential remain stored. A stale channel revision is rejected; refresh before retrying. Disabled channels are labeled **Disabled**, hidden from model selection, and cannot use their row's connection check or model discovery. The Pi bridge requests cancellation of current activity on a disabled selected channel. Advanced `models.json` can still edit `enabled`. Requests already sent to a provider cannot be withdrawn, and third-party extension calls need separate review.

New scenes do not receive an automatic QVeris channel. Reading settings, saving a channel and saving a key do not fetch a model catalog. Existing channels remain available to edit or remove.

For an OpenAI Chat Completions or Responses compatible channel, you may save an empty model list and then select **Discover models** on its row. The app requests `/models` from that channel's Base URL and opens the editor with candidate IDs; discovery does not write the configuration. Review the IDs and select **Save channel**. Existing hand-edited model parameters are preserved. Local services without authentication can be discovered without a key; authenticated channels require a configured key. The catalog may contain non-chat models, so review IDs before saving.

Discovery has timeout, response-size, and item limits. If the channel changes while a request is in flight, refresh and retry. Anthropic- and Google-compatible channels still require manual model IDs.

## API keys

Add or update provider credentials in the API keys section. The desktop host stores secret values in the operating-system credential vault; scene configuration keeps only non-sensitive references. Secrets are not rendered back into the interface or written to `models.json`, logs, or documentation.

## Insufficient quota

If chat reports insufficient model service quota, check the balance or quota for the selected channel. The message does not establish that a particular provider charged you. You can also choose a less expensive model or start a new conversation to reduce context.

## Optional QVeris catalog adapter

To use this adapter, explicitly add a channel with provider ID `qveris`, enter your gateway Base URL ending in `/v1`, and configure its key. This channel may initially have no model IDs.

Select **Refresh models** on that channel to request its catalog from the configured gateway. Chat models and their capability and pricing metadata are synchronized to the current scene. Embedding models are excluded from the chat selector.
When the gateway rejects a request, the UI shows only its HTTP status, not the upstream error body. Check the channel URL, key, and service account before retrying.
Model health checks also show only the status or a fixed error category. A 404 hides the model automatically only when it explicitly reports `model_not_found`; upstream error details are not displayed.

If the channel changes or is removed during the request, its response is rejected. Refresh settings and retry. Reading settings or requesting a catalog does not recreate a deleted channel.

Removing a channel also removes its associated credentials and may affect features using the same provider credential. After changing a provider ID, check existing conversations' model references and configure credentials again.

## Scene isolation

A key configured in Finance is not copied into Programming. Financial service credentials and model channels serve different purposes; saving a finance credential does not create a chat model channel.

## Advanced files

The advanced editors expose the scene's agent configuration and `models.json`. Refresh the relevant model lists after editing to view the current configuration.
