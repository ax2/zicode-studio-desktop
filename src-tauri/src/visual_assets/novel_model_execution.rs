//! Only bounded, complete text becomes a reviewable suggestion. Nothing is approved here.
use crate::model_tools::{self, ModelEndpoint};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

pub(super) async fn execute(
    endpoint: ModelEndpoint,
    key: Option<String>,
    prompt: String,
    cancellation: CancellationToken,
) -> Option<Value> {
    let started = Instant::now();
    let response = model_tools::complete_limited_cancellable(
        &endpoint,
        key.as_deref(),
        prompt,
        Duration::from_secs(120),
        2048,
        cancellation,
    )
    .await
    .ok()?;
    Some(outcome(
        &response,
        started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    ))
}

fn bounded_id(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
}

fn outcome(response: &Value, elapsed_ms: u64) -> Value {
    let choice = &response["choices"][0];
    let text = choice["message"]["content"]
        .as_str()
        .map(str::trim)
        .filter(|text| {
            !text.is_empty() && !text.contains('\0') && text.chars().take(4001).count() <= 4000
        });
    let complete = choice["finish_reason"] == "stop"
        && (choice["message"]["tool_calls"].is_null()
            || choice["message"]["tool_calls"]
                .as_array()
                .is_some_and(Vec::is_empty))
        && choice["message"]["function_call"].is_null()
        && (choice["message"]["refusal"].is_null()
            || choice["message"]["refusal"]
                .as_str()
                .is_some_and(str::is_empty));
    let usable = complete && text.is_some();
    let usage = &response["usage"];
    let usage = match (
        usage["prompt_tokens"].as_u64(),
        usage["completion_tokens"].as_u64(),
        usage["total_tokens"].as_u64(),
    ) {
        (Some(input), Some(output), Some(total)) if input.checked_add(output) == Some(total) => {
            json!({"promptTokens":input,"completionTokens":output,"totalTokens":total})
        }
        _ => Value::Null,
    };
    json!({"state":if usable { "ready" } else { "rejected" },
        "text":if usable { text } else { None },
        "error":if usable { None } else { Some("visual_assets_model_response_unusable") },
        "providerResponseId":bounded_id(&response["id"]), "usage":usage,"elapsedMs":elapsed_ms,
        "cost":null})
}

#[cfg(test)]
#[path = "novel_model_execution_tests.rs"]
mod tests;
