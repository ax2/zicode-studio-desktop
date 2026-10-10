use super::{ProjectManifest, Requirement, RequirementAssessment};
use pep440_rs::{Version, VersionSpecifiers};
use std::str::FromStr;

fn requirement(constraint: &str, kind: &'static str) -> Requirement {
    Requirement {
        tool: "python".into(),
        constraint: constraint.chars().take(200).collect(),
        truncated: constraint.chars().count() > 200,
        kind: Some(kind),
        assessment: None,
    }
}

pub(crate) fn parse(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let value: toml::Value = toml::from_str(text).map_err(|_| "invalid")?;
    let project = value.get("project");
    if project.is_some_and(|v| !v.is_table()) {
        return Err("invalid");
    }
    let declared = project.and_then(|v| v.get("requires-python"));
    let dynamic = match project.and_then(|v| v.get("dynamic")) {
        Some(value) => {
            let items = value.as_array().ok_or("invalid")?;
            if items.iter().any(|v| !v.is_str()) {
                return Err("invalid");
            }
            items.iter().any(|v| v.as_str() == Some("requires-python"))
        }
        None => false,
    };
    if dynamic && declared.is_some() {
        return Err("invalid");
    }
    if let Some(declared) = declared {
        return Ok(vec![requirement(
            declared.as_str().ok_or("invalid")?,
            "pep440",
        )]);
    }
    if dynamic {
        return Ok(vec![requirement("requires-python", "dynamic")]);
    }
    // Do not silently interpret Poetry's caret/union grammar as PEP 440.
    let poetry = value
        .get("tool")
        .and_then(|v| v.get("poetry"))
        .and_then(|v| v.get("dependencies"))
        .and_then(|v| v.get("python"));
    if let Some(poetry) = poetry {
        return Ok(vec![requirement(
            poetry.as_str().unwrap_or("tool.poetry.dependencies.python"),
            "poetry",
        )]);
    }
    Ok(vec![])
}

pub(crate) fn assess(manifests: &mut [ProjectManifest], status: &str, observed: Option<&str>) {
    for manifest in manifests {
        for requirement in &mut manifest.requirements {
            if requirement.tool == "python" {
                requirement.assessment = Some(compare(requirement, status, observed));
            }
        }
    }
}

fn compare(
    requirement: &Requirement,
    tool_status: &str,
    observed: Option<&str>,
) -> RequirementAssessment {
    let result = |status, version| RequirementAssessment {
        status,
        version,
        observed_version: observed.map(str::to_owned),
    };
    if requirement.truncated {
        return result("truncated", None);
    }
    if requirement.kind != Some("pep440") {
        return result("unsupported", None);
    }
    let Ok(specifiers) = VersionSpecifiers::from_str(&requirement.constraint) else {
        return result("invalid", None);
    };
    if tool_status == "missing" {
        return result("missing", None);
    }
    if tool_status != "ready" {
        return result("unavailable", None);
    }
    let Some(raw) = observed
        .filter(|v| v.len() < 200)
        .and_then(|v| v.strip_prefix("Python "))
    else {
        return result("unknown-version", None);
    };
    if raw.chars().any(char::is_whitespace) || !raw.starts_with(|c: char| c.is_ascii_digit()) {
        return result("unknown-version", None);
    }
    let Ok(version) = Version::from_str(raw) else {
        return result("unknown-version", None);
    };
    if version.epoch() != 0 || version.release().len() != 3 {
        return result("unknown-version", None);
    }
    // This is an already-installed interpreter, not candidate selection: PEP 440
    // permits installed prereleases. Specifier-specific pre/post exclusions still apply.
    result(
        if specifiers.contains(&version) {
            "satisfied"
        } else {
            "mismatch"
        },
        Some(version.to_string()),
    )
}

#[cfg(test)]
#[path = "python_requirements_tests.rs"]
mod tests;
