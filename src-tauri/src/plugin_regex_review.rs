//! Negotiated match review profile. Budgets stay shared with regex replacement.
use serde_json::Value;

pub(crate) const PROFILE: &str = "resource.wasi.regex.review.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const MAX_RESULT_BYTES: usize = 256 * 1024;

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_capability(capability: &Value, requirements: &Value) -> Result<(), String> {
    if requirements
        .get("resource.input.types.v1")
        .and_then(Value::as_str)
        != Some("=1.0.0-preview.1")
        || capability.get("resourceInputMimeTypes") != Some(&serde_json::json!(["text/plain"]))
        || !capability
            .get("maxResultBytes")
            .and_then(Value::as_u64)
            .is_some_and(|limit| (1..=MAX_RESULT_BYTES as u64).contains(&limit))
    {
        return Err(
            "Regex review requires exact text input negotiation and a result budget up to 256KiB"
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn validate_outputs(
    result: &Value,
    outputs: &[(&str, usize)],
) -> Result<(), &'static str> {
    if serde_json::to_vec(result)
        .map_err(|_| "invalid_output")?
        .len()
        > MAX_RESULT_BYTES
    {
        return Err("result_too_large");
    }
    if result.get("ok") == Some(&Value::Bool(false)) {
        return if outputs.is_empty() {
            Ok(())
        } else {
            Err("invalid_output")
        };
    }
    if result.get("ok") != Some(&Value::Bool(true))
        || outputs.len() > 2
        || outputs.iter().any(|(mime, size)| {
            *mime != "text/plain" || *size > super::plugin_resource_regex::TEXT_BYTES
        })
    {
        return Err("invalid_output");
    }
    let labels = result
        .get("resourceLabels")
        .and_then(Value::as_array)
        .ok_or("invalid_output")?;
    if labels.len() != outputs.len()
        || labels.iter().any(|label| {
            label.as_str().is_none_or(|text| {
                text.is_empty() || text.len() > 128 || text.chars().any(char::is_control)
            })
        })
    {
        return Err("invalid_output");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn review_output_policy_admits_complete_values_and_rejects_partial_or_mislabelled_outputs() {
        let value = json!({"ok":true,"resourceLabels":["Matched text","Captured text"]});
        assert!(
            validate_outputs(&value, &[("text/plain", 2097152), ("text/plain", 2097152)]).is_ok()
        );
        assert!(validate_outputs(&value, &[("text/plain", 0), ("text/plain", 0)]).is_ok());
        assert!(validate_outputs(&json!({"ok":true,"resourceLabels":[]}), &[]).is_ok());
        assert!(
            validate_outputs(&json!({"ok":false,"error":{"code":"INVALID_INPUT"}}), &[]).is_ok()
        );
        for outputs in [
            vec![("text/plain", 2097153), ("text/plain", 0)],
            vec![("text/html", 1), ("text/plain", 1)],
            vec![("text/plain", 1); 3],
            vec![("text/plain", 1)],
        ] {
            assert!(validate_outputs(&value, &outputs).is_err());
        }
        assert!(validate_outputs(&json!({"ok":false}), &[("text/plain", 1)]).is_err());
        for labels in [
            json!([12, 13]),
            json!(["", "Capture"]),
            json!(["bad\nlabel", "Capture"]),
            json!(["x".repeat(129), "Capture"]),
        ] {
            assert!(validate_outputs(
                &json!({"ok":true,"resourceLabels":labels}),
                &[("text/plain", 1); 2]
            )
            .is_err());
        }
        assert_eq!(
            validate_outputs(
                &json!({"ok":true,"resourceLabels":[],"extra":"x".repeat(MAX_RESULT_BYTES)}),
                &[]
            ),
            Err("result_too_large")
        );
    }
}
