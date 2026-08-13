//! Translation assistant: turn text into another language through the configured
//! OpenAI-compatible model gateway.

use serde::{Deserialize, Serialize};

pub const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const MAX_TEXT_CHARS: usize = 50_000;
const MAX_LANG_CHARS: usize = 40;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub text: String,
    pub target_lang: String,
    #[serde(default)]
    pub source_lang: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub translated: String,
    pub model: String,
    pub target_lang: String,
    pub source_lang: Option<String>,
    pub char_count: usize,
}

pub fn build_prompt(text: &str, source_lang: Option<&str>, target_lang: &str) -> String {
    let source = source_lang
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" from {value}"))
        .unwrap_or_default();
    format!(
        "Translate the following text{source} into {target_lang}. \
         Preserve formatting, punctuation, and technical terms. \
         Return only the translation, with no commentary.\n\n{text}"
    )
}

pub fn extract_text(response: &serde_json::Value) -> Option<String> {
    response
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub fn validate(text: &str, target_lang: &str, source_lang: Option<&str>) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Text to translate is empty".to_string());
    }
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "Text exceeds the {MAX_TEXT_CHARS} character translation limit"
        ));
    }
    let target = target_lang.trim();
    if target.is_empty() {
        return Err("Target language is required".to_string());
    }
    if target.chars().count() > MAX_LANG_CHARS {
        return Err("Target language name is too long".to_string());
    }
    if let Some(source) = source_lang.map(str::trim) {
        if source.chars().count() > MAX_LANG_CHARS {
            return Err("Source language name is too long".to_string());
        }
    }
    Ok(())
}

pub fn translate(request: &TranslationRequest, api_key: &str) -> Result<TranslationResult, String> {
    validate(
        &request.text,
        &request.target_lang,
        request.source_lang.as_deref(),
    )?;
    let model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_MODEL);
    let prompt = build_prompt(
        &request.text,
        request.source_lang.as_deref(),
        &request.target_lang,
    );
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.2
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Cannot build model client: {error}"))?;
    let response = client
        .post("https://aigateway.qveris.ai/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Model gateway is unreachable: {error}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .map_err(|error| format!("Cannot read model response: {error}"))?;
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("model request failed");
        return Err(format!("Model gateway error ({status}): {message}"));
    }
    let translated =
        extract_text(&payload).ok_or_else(|| "Model returned an empty translation".to_string())?;
    let char_count = translated.chars().count();
    Ok(TranslationResult {
        translated,
        model: model.to_string(),
        target_lang: request.target_lang.trim().to_string(),
        source_lang: request
            .source_lang
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        char_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_translation_prompt() {
        let prompt = build_prompt("Hello", Some("English"), "中文");
        assert!(prompt.contains("from English"));
        assert!(prompt.contains("into 中文"));
        assert!(prompt.contains("Hello"));
    }

    #[test]
    fn extracts_translated_text() {
        let payload = serde_json::json!({
            "choices": [{ "message": { "content": "  你好  " } }]
        });
        assert_eq!(extract_text(&payload).as_deref(), Some("你好"));
        assert_eq!(extract_text(&serde_json::json!({})), None);
    }

    #[test]
    fn validates_input() {
        assert!(validate("", "中文", None).is_err());
        assert!(validate("Hello", "", None).is_err());
        assert!(validate("Hello", "中文", None).is_ok());
    }
}
