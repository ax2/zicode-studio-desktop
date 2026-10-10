use super::Requirement;

pub(super) fn parse(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let mut lines = text.lines();
    let mut version = None;
    while let Some(line) = lines.next() {
        if line != "BUNDLED WITH" {
            continue;
        }
        if version.is_some() {
            return Err("invalid");
        }
        let declared = lines.next().ok_or("invalid")?.trim();
        if declared.is_empty() || declared.chars().any(char::is_whitespace) {
            return Err("invalid");
        }
        version = Some(declared);
    }
    Ok(version
        .into_iter()
        .map(|declared| Requirement {
            tool: "bundle".into(),
            constraint: declared.chars().take(200).collect(),
            truncated: declared.chars().count() > 200,
            kind: Some("bundler-lock"),
            assessment: None,
        })
        .collect())
}
