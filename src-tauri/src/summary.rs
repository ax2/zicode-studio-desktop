//! Summarize extracted article text through the configured OpenAI-compatible
//! model gateway, so captured web content can be turned into a quick
//! structured digest before saving it as a note.

use serde::{Deserialize, Serialize};

const MAX_TEXT_CHARS: usize = 100_000;
const MAX_TITLE_CHARS: usize = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeRequest {
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeResult {
    pub provider: String,
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
    endpoint: &crate::model_tools::ModelEndpoint,
    api_key: Option<&str>,
    title: Option<&str>,
) -> Result<SummarizeResult, String> {
    validate(&request.text, title)?;
    let model = &endpoint.choice.model;
    let prompt = build_prompt(&request.text);
    let payload = crate::model_tools::complete(
        endpoint,
        api_key,
        prompt,
        std::time::Duration::from_secs(90),
    )?;
    let summary =
        extract_text(&payload).ok_or_else(|| "Model returned an empty summary".to_string())?;
    let char_count = summary.chars().count();
    Ok(SummarizeResult {
        provider: endpoint.choice.provider.clone(),
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
