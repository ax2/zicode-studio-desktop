use super::Requirement;

fn requirement(tool: &str, constraint: &str, kind: &'static str) -> Requirement {
    Requirement {
        tool: tool.into(),
        constraint: constraint.chars().take(200).collect(),
        truncated: constraint.chars().count() > 200,
        kind: Some(kind),
        assessment: None,
    }
}

pub(super) fn parse(name: &str, text: &str) -> Result<Vec<Requirement>, &'static str> {
    match name {
        "go.mod" | "go.work" => go_requirements(text),
        "rust-toolchain" => {
            let value = text.trim();
            if value.is_empty() || value.lines().count() != 1 {
                return Err("invalid");
            }
            Ok(vec![requirement("rustc", value, "toolchain")])
        }
        "Cargo.toml" | "rust-toolchain.toml" => {
            let value: toml::Value = toml::from_str(text).map_err(|_| "invalid")?;
            if name == "rust-toolchain.toml" {
                let table = value
                    .get("toolchain")
                    .and_then(toml::Value::as_table)
                    .ok_or("invalid")?;
                let channel = table.get("channel");
                return match channel {
                    Some(channel) => Ok(vec![requirement(
                        "rustc",
                        channel.as_str().ok_or("invalid")?,
                        "toolchain",
                    )]),
                    // Target-only toolchains do not declare a compiler version.
                    None => Ok(vec![]),
                };
            }
            if value.get("package").is_some_and(|v| !v.is_table()) {
                return Err("invalid");
            }
            let declared = value.get("package").and_then(|v| v.get("rust-version"));
            let workspace = value
                .get("workspace")
                .and_then(|v| v.get("package"))
                .and_then(|v| v.get("rust-version"));
            let Some(declared) = declared else {
                return Ok(vec![]);
            };
            if let Some(constraint) = declared.as_str() {
                return Ok(vec![requirement("rustc", constraint, "minimum")]);
            }
            if declared.get("workspace").and_then(toml::Value::as_bool) == Some(true) {
                return match workspace {
                    Some(inherited) => Ok(vec![requirement(
                        "rustc",
                        inherited.as_str().ok_or("invalid")?,
                        "minimum",
                    )]),
                    // Never read parents outside the registered project boundary.
                    None => Ok(vec![requirement("rustc", "workspace", "inherited")]),
                };
            }
            Err("invalid")
        }
        _ => Ok(vec![]),
    }
}

// Tokenize only enough Go module syntax to identify top-level version directives.
// Quoted strings and dependency blocks cannot introduce version requirements.
fn go_requirements(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let mut result = vec![];
    let mut in_block = false;
    let mut seen = std::collections::HashSet::new();
    for line in text.lines() {
        let mut words: Vec<String> = vec![];
        let mut current = String::new();
        let mut quoted = false;
        let mut escaped = false;
        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            if quoted {
                current.push(ch);
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    quoted = false;
                }
            } else if ch == '/' && chars.peek() == Some(&'/') {
                break;
            } else if ch == '"' {
                quoted = true;
                current.push(ch);
            } else if ch.is_whitespace() {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            } else {
                current.push(ch);
            }
        }
        if quoted {
            return Err("invalid");
        }
        if !current.is_empty() {
            words.push(current);
        }
        if words.is_empty() {
            continue;
        }
        if in_block {
            if words == [")"] {
                in_block = false;
            }
            continue;
        }
        let directive = words[0].as_str();
        if matches!(directive, "go" | "toolchain") {
            if words.len() != 2 || !seen.insert(words[0].clone()) {
                return Err("invalid");
            }
            let raw = &words[1];
            let value = if raw.starts_with('"') {
                serde_json::from_str::<String>(raw).map_err(|_| "invalid")?
            } else {
                raw.clone()
            };
            result.push(requirement(
                "go",
                &value,
                if directive == "go" {
                    "minimum"
                } else {
                    "recommended"
                },
            ));
        } else if words.last().is_some_and(|word| word == "(") {
            in_block = true;
        }
    }
    if in_block {
        return Err("invalid");
    }
    Ok(result)
}

#[cfg(test)]
#[path = "language_requirements_tests.rs"]
mod tests;
