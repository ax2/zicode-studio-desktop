# Translation

Translate text between languages using the model configured for the current scene; the result can be copied or downloaded.

## How to use

1. Set the source language to auto-detect or a specific language.
2. Enter the text to translate.
3. Choose the target language (use ⇄ to swap source and target).
4. Choose a configured channel and model under **Model service**, then click **Translate**. The result identifies the provider and model and can be copied or downloaded.

## Notes

- Add a channel in **Settings → Configuration → Model channels**, select OpenAI Chat Completions and enter its model IDs.
- API keys are sent by default. For a local service requiring no key, disable **Send API key as a bearer token**. Translation then neither reads nor sends a key.
- Only compatible custom channels saved in the current scene are listed. Custom headers, OAuth, unsaved built-in catalog models and other protocols are not supported here yet.
- After changing configuration, refresh the model list and choose again. No service is selected automatically or used as a fallback.
- Text is sent only on Translate or Ctrl/Cmd+Enter. Loopback services connect directly; remote services use system proxy settings. Local models still need to be installed and served separately.
- If the text is too long or the service is unavailable, the error explains the
  reason and you can retry.
