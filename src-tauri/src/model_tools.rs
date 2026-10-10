//! Explicit, scene-scoped model choices for translation and article summaries.
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[cfg(test)]
mod tests;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub provider: String,
    pub model: String,
    pub name: String,
    pub endpoint: String,
    pub requires_key: bool,
}

pub struct ModelEndpoint {
    pub choice: ModelChoice,
    url: reqwest::Url,
}

fn document(root: &Path, scene: &str) -> Result<Value, String> {
    let digest = Sha256::digest(scene.as_bytes());
    let key: String = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let file = root.join("scenes").join(key).join("agent/models.json");
    let input = match std::fs::File::open(file) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(_) => return Err("model_config_unavailable".into()),
    };
    let mut bytes = Vec::new();
    input
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "model_config_unavailable")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("model_config_too_large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "model_config_invalid".into())
}

fn endpoint(provider: &str, config: &Value, model: &Value) -> Option<ModelEndpoint> {
    let api = model.get("api").or_else(|| config.get("api"))?.as_str()?;
    if api != "openai-completions" {
        return None;
    }
    // Header/env expansion belongs to Pi; do not silently reinterpret that contract.
    if config
        .get("headers")
        .is_some_and(|h| h.as_object().is_none_or(|v| !v.is_empty()))
        || model
            .get("headers")
            .is_some_and(|h| h.as_object().is_none_or(|v| !v.is_empty()))
    {
        return None;
    }
    let base = model
        .get("baseUrl")
        .or_else(|| config.get("baseUrl"))?
        .as_str()?;
    let mut url = reqwest::Url::parse(base.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let path = format!("{}/chat/completions", url.path().trim_end_matches('/'));
    url.set_path(&path);
    let id = model.get("id")?.as_str()?.trim();
    if id.is_empty() || provider.trim().is_empty() {
        return None;
    }
    Some(ModelEndpoint {
        choice: ModelChoice {
            provider: provider.to_string(),
            model: id.to_string(),
            name: model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string(),
            endpoint: url.origin().ascii_serialization(),
            requires_key: config.get("authHeader").and_then(Value::as_bool) != Some(false),
        },
        url,
    })
}

fn endpoints(doc: &Value) -> Vec<ModelEndpoint> {
    let mut result = Vec::new();
    if let Some(providers) = doc.get("providers").and_then(Value::as_object) {
        for (provider, config) in providers {
            if config.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            if let Some(models) = config.get("models").and_then(Value::as_array) {
                for model in models {
                    if let Some(value) = endpoint(provider, config, model) {
                        result.push(value);
                    }
                }
            }
        }
    }
    result
}

pub fn catalog(root: &Path, scene: &str) -> Result<Vec<ModelChoice>, String> {
    Ok(endpoints(&document(root, scene)?)
        .into_iter()
        .map(|e| e.choice)
        .collect())
}

pub fn resolve(
    root: &Path,
    scene: &str,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<ModelEndpoint, String> {
    let provider = provider
        .filter(|p| !p.trim().is_empty())
        .ok_or("model_selection_required")?;
    let model = model
        .filter(|m| !m.trim().is_empty())
        .ok_or("model_selection_required")?;
    let mut matches = endpoints(&document(root, scene)?)
        .into_iter()
        .filter(|e| e.choice.provider == provider && e.choice.model == model);
    let result = matches.next().ok_or("model_selection_unavailable")?;
    if matches.next().is_some() {
        return Err("model_selection_ambiguous".into());
    }
    Ok(result)
}

pub fn complete(
    endpoint: &ModelEndpoint,
    key: Option<&str>,
    prompt: String,
    timeout: Duration,
) -> Result<Value, String> {
    if endpoint.choice.requires_key && key.is_none_or(|key| key.trim().is_empty()) {
        return Err("model_credential_unavailable".into());
    }
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none());
    let host = endpoint
        .url
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
    {
        builder = builder.no_proxy();
    }
    let client = builder.build().map_err(|_| "model_client_unavailable")?;
    let mut request = client.post(endpoint.url.clone()).json(&json!({
        "model": endpoint.choice.model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2
    }));
    if endpoint.choice.requires_key {
        request = request.bearer_auth(key.unwrap_or_default());
    }
    let response = request.send().map_err(|_| "model_request_unavailable")?;
    if !response.status().is_success() {
        return Err(format!(
            "model_request_failed:{}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "model_response_invalid")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("model_response_too_large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "model_response_invalid".into())
}
