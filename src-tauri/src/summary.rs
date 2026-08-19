//! Summarize extracted article text through the configured OpenAI-compatible
//! model gateway, so captured web content can be turned into a quick
//! structured digest before saving it as a note.

use serde::{Deserialize, Serialize};

pub const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const MAX_TEXT_CHARS: usize = 100_000;
const MAX_TITLE_CHARS: usize = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeRequest {
    pub text: String,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeResult {
    pub summary: String,
    pub model: String,
    pub char_count: usize,
}

pub fn build_prompt(text: &str) -> String {
    format!(
        "Read the following web article and produce a concise structured digest in the same \
         language as the article. Use short sections: one-line summary, key points as bullets, \
         and any notable conclusions or data. Keep it factual; do not invent facts. \
         Return only the digest.\n\n{text}"
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

pub fn validate(text: &str, title: Option<&str>) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Article text is empty".to_string());
    }
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "Article text exceeds the {MAX_TEXT_CHARS} character summarization limit"
        ));
    }
    if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err("Article title is too long".to_string());
        }
    }
    Ok(())
}

pub fn summarize(
    request: &SummarizeRequest,
    api_key: &str,
    title: Option<&str>,
) -> Result<SummarizeResult, String> {
    validate(&request.text, title)?;
    let model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_MODEL);
    let prompt = build_prompt(&request.text);
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.2
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
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
        return Err(format!("Model gateway error: {status}"));
    }
    let summary =
        extract_text(&payload).ok_or_else(|| "Model returned an empty summary".to_string())?;
    let char_count = summary.chars().count();
    Ok(SummarizeResult {
        summary,
        model: model.to_string(),
        char_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_digest_prompt_that_includes_the_article() {
        let prompt = build_prompt("正文内容");
        assert!(prompt.contains("structured digest"));
        assert!(prompt.contains("正文内容"));
    }

    #[test]
    fn extracts_summary_from_chat_completion_payload() {
        let payload = serde_json::json!({
            "choices": [{ "message": { "content": " 摘要内容 " } }]
        });
        assert_eq!(extract_text(&payload).as_deref(), Some("摘要内容"));
    }

    #[test]
    fn rejects_empty_or_oversized_articles() {
        assert!(validate("  ", None).is_err());
        let huge = "x".repeat(MAX_TEXT_CHARS + 1);
        assert!(validate(&huge, None).is_err());
        assert!(validate("正常正文", Some("标题")).is_ok());
    }
}
