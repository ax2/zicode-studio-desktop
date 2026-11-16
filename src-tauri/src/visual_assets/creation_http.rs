//! OpenAI Images-compatible transport. No redirects, URL downloads or automatic retry.
use super::{creation_types::Plan, Result};
use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub(super) struct Output {
    pub bytes: Vec<u8>,
    pub usage: Value,
}
pub(super) async fn create(
    plan: &Plan,
    request_id: Uuid,
    images: Vec<Vec<u8>>,
    key: Option<String>,
    cancel: CancellationToken,
) -> Result<Output> {
    let request = async {
        if plan.settings.requires_key && key.as_ref().is_none_or(|value| value.trim().is_empty()) {
            return Err("visual_assets_creation_credential_required".into());
        }
        if images.len() != plan.references.len() {
            return Err("visual_assets_creation_input_invalid".into());
        }
        if let Some(generation) = &plan.input.generation {
            generation.validate(&plan.settings, &plan.input)?;
        }
        let endpoint = plan.endpoint()?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(180));
        // Local image services must stay on loopback even when a system proxy is set.
        let client = if endpoint
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "[::1]" | "localhost"))
        {
            client.no_proxy()
        } else {
            client
        }
        .build()?;
        let mut parameters = plan.parameters();
        parameters.insert("model".into(), json!(plan.settings.model));
        parameters.insert("prompt".into(), json!(plan.prompt));
        parameters.insert("n".into(), json!(1));
        let text_only = plan
            .input
            .generation
            .as_ref()
            .is_some_and(|value| value.mode == super::creation_types::generation::Mode::Text);
        if text_only != images.is_empty() {
            return Err("visual_assets_creation_input_invalid".into());
        }
        let mut form = reqwest::multipart::Form::new();
        for (name, value) in &parameters {
            form = form.text(
                name.clone(),
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string()),
            );
        }
        for (index, bytes) in images.into_iter().enumerate() {
            if bytes.len() > 24 * 1024 * 1024
                || super::creation_types::hash(&bytes) != plan.references[index].sha256
            {
                return Err("visual_assets_creation_source_changed".into());
            }
            let (mime, extension) = match image::guess_format(&bytes)? {
                image::ImageFormat::Png => ("image/png", "png"),
                image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
                image::ImageFormat::WebP => ("image/webp", "webp"),
                _ => return Err("visual_assets_creation_input_invalid".into()),
            };
            form = form.part(
                "image[]",
                reqwest::multipart::Part::bytes(bytes)
                    .file_name(format!("reference-{index}.{extension}"))
                    .mime_str(mime)?,
            );
        }
        let request = if text_only {
            client.post(endpoint).json(&parameters)
        } else {
            client.post(endpoint).multipart(form)
        };
        let mut request = request.header("x-client-request-id", request_id.to_string());
        if plan.settings.requires_key {
            request = request.bearer_auth(key.unwrap_or_default());
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(Ok(chunk)) = stream.next().await {
                if body.len() + chunk.len() > 16 * 1024 {
                    break;
                }
                body.extend_from_slice(&chunk);
            }
            return Err(super::creation_errors::classify(status, &body).into());
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if body.len() + chunk.len() > 34 * 1024 * 1024 {
                return Err("visual_assets_creation_result_too_large".into());
            }
            body.extend_from_slice(&chunk);
        }
        let output = decode(&body)?;
        plan.result_extension(&output.bytes)?;
        Ok(output)
    };
    tokio::select! { biased;
        _ = cancel.cancelled() => Err("visual_assets_creation_cancelled".into()),
        result = request => result,
    }
}

fn decode(body: &[u8]) -> Result<Output> {
    let value: Value = serde_json::from_slice(body)?;
    let data = value["data"]
        .as_array()
        .filter(|data| data.len() == 1)
        .ok_or("visual_assets_creation_result_invalid")?;
    let encoded = data[0]["b64_json"]
        .as_str()
        .filter(|encoded| encoded.len() <= 32 * 1024 * 1024)
        .ok_or("visual_assets_creation_result_invalid")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)?;
    if bytes.len() > 24 * 1024 * 1024
        || !matches!(
            image::guess_format(&bytes)?,
            image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP
        )
    {
        return Err("visual_assets_creation_result_invalid".into());
    }
    // Preserve only numeric accounting fields. No arbitrary server text or URLs.
    let usage = json!({
        "inputTokens": value["usage"]["input_tokens"].as_u64(),
        "outputTokens": value["usage"]["output_tokens"].as_u64(),
        "totalTokens": value["usage"]["total_tokens"].as_u64(),
        "textInputTokens": value["usage"]["input_tokens_details"]["text_tokens"].as_u64(),
        "imageInputTokens": value["usage"]["input_tokens_details"]["image_tokens"].as_u64(),
        "textOutputTokens": value["usage"]["output_tokens_details"]["text_tokens"].as_u64(),
        "imageOutputTokens": value["usage"]["output_tokens_details"]["image_tokens"].as_u64(),
        "cost": null
    });
    Ok(Output { bytes, usage })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_and_invalid_usage_details_are_unknown_not_zero() {
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(include_bytes!("../../icons/32x32.png"));
        for reported in [
            Value::Null,
            json!({"input_tokens": 10, "input_tokens_details": {
                "text_tokens": "3", "image_tokens": -7
            }, "output_tokens_details": {"text_tokens": 0.5, "image_tokens": false}}),
        ] {
            let body = json!({"data": [{"b64_json": encoded}], "usage": reported});
            let output = decode(&serde_json::to_vec(&body).unwrap()).unwrap();
            for key in [
                "textInputTokens",
                "imageInputTokens",
                "textOutputTokens",
                "imageOutputTokens",
                "cost",
            ] {
                assert!(output.usage[key].is_null(), "{key}");
            }
            super::super::creation_types::validate_usage(&output.usage).unwrap();
        }
        // Existing archives without details still validate; arbitrary nested data does not.
        super::super::creation_types::validate_usage(&json!({"inputTokens": 10, "cost": null}))
            .unwrap();
        for value in [
            json!({"textInputTokens": "3"}),
            json!({"imageInputTokens": -1}),
            json!({"input_tokens_details": {"secret": "text"}}),
        ] {
            assert!(super::super::creation_types::validate_usage(&value).is_err());
        }
    }
}
