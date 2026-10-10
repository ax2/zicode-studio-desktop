use super::Requirement;

pub(super) fn parse(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| "invalid")?;
    let document = value.as_object().ok_or("invalid")?;
    let Some(require) = document.get("require") else {
        return Ok(vec![]);
    };
    let require = require.as_object().ok_or("invalid")?;
    let Some(php) = require.get("php") else {
        return Ok(vec![]);
    };
    let constraint = php.as_str().ok_or("invalid")?;
    if constraint.trim().is_empty() || constraint.chars().any(char::is_control) {
        return Err("invalid");
    }
    Ok(vec![Requirement {
        tool: "php".into(),
        constraint: constraint.chars().take(200).collect(),
        truncated: constraint.chars().count() > 200,
        kind: Some("composer-php"),
        assessment: None,
    }])
}
