//! Only stable, bounded error codes cross the provider boundary; never server text.
pub(super) fn rejected(code: &str) -> bool {
    matches!(
        code,
        "visual_assets_creation_provider_rejected"
            | "visual_assets_creation_quota_exhausted"
            | "visual_assets_creation_rate_limited"
            | "visual_assets_creation_auth_failed"
    )
}

pub(super) fn classify(status: u16, body: &[u8]) -> &'static str {
    let value: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let quota = [
        value["error"]["code"].as_str(),
        value["error"]["type"].as_str(),
    ]
    .into_iter()
    .flatten()
    .any(|code| {
        matches!(
            code,
            "insufficient_quota" | "billing_hard_limit_reached" | "billing_not_active"
        )
    });
    match status {
        400 | 402 | 403 | 429 if quota => "visual_assets_creation_quota_exhausted",
        401 | 403 => "visual_assets_creation_auth_failed",
        429 => "visual_assets_creation_rate_limited",
        400 | 402 | 404 | 422 => "visual_assets_creation_provider_rejected",
        _ => "visual_assets_creation_provider_unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quota_rate_limits_and_uncertain_results_are_distinct() {
        assert_eq!(
            classify(
                429,
                br#"{"error":{"code":"insufficient_quota","message":"private provider message"}}"#
            ),
            "visual_assets_creation_quota_exhausted"
        );
        assert_eq!(
            classify(429, br#"{"error":{"code":"rate_limit_exceeded"}}"#),
            "visual_assets_creation_rate_limited"
        );
        assert_eq!(
            classify(429, b"not JSON"),
            "visual_assets_creation_rate_limited"
        );
        assert_eq!(classify(401, b""), "visual_assets_creation_auth_failed");
        assert!(!rejected(classify(
            500,
            br#"{"error":{"code":"insufficient_quota"}}"#
        )));
    }
}
