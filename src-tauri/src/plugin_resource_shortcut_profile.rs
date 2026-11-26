//! Trusted admission for the bounded portable shortcut-profile exporter.
use crate::{
    plugin_output_types::JSON,
    plugin_registry::PluginManifest,
    plugin_worker::resource_output::{Bundle, Profile},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(crate) const PROFILE: &str = "resource.wasi.shortcuts.profile.v1";
pub(crate) const PLUGIN: &str = "com.zicode.devtools.shortcut-profile";
pub(crate) const CAPABILITY: &str = "devtools.shortcuts.profile.merge";
pub(crate) const MAX_FILE: usize = 16 * 1024;
pub(crate) const MAX_OUTPUT: usize = 48 * 1024;
const MAX_BINDINGS: usize = 32;
const VERSION: &str = "=1.0.0-preview.1";
const INPUT: &str = "resource.wasi.input.draft2";
const TYPES: [&str; 2] = ["application/octet-stream", "text/plain"];
const INVALID: &str = "invalid_output";

type Bindings = BTreeMap<String, String>;

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn matches_capability(plugin: &str, capability: Option<&str>) -> bool {
    plugin == PLUGIN && capability == Some(CAPABILITY)
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    let Some(version) = manifest.required_profiles.get(PROFILE) else {
        return Ok(());
    };
    let invalid = || "Invalid shortcut profile export declaration".to_owned();
    let [cap] = manifest.contributes["capabilities"]
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(invalid)?
    else {
        return Err(invalid());
    };
    let types = cap["resourceInputMimeTypes"]
        .as_array()
        .ok_or_else(invalid)?;
    let permissions = &manifest.permissions;
    if manifest.id != PLUGIN
        || manifest.schema_version != 2
        || version.as_str() != Some(VERSION)
        || permissions.required.len() != 1
        || permissions.required[0].name != "resource.read"
        || !permissions.optional.is_empty()
        || manifest.runtime["wasi"].as_str().is_none()
        || manifest.runtime["resourceInputProfile"] != INPUT
        || manifest.runtime["resourceOutputProfile"]
            != crate::plugin_worker::resource_output::PROFILE
        || [
            "resource.input.types.v1",
            "resource.output.types.v1",
            "output.schema.v1",
            "tool.directory.v1",
        ]
        .iter()
        .any(|name| manifest.required_profiles.get(*name).is_none())
        || ["activities", "views", "commands", "piTools"]
            .iter()
            .any(|key| {
                manifest.contributes[*key]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
            })
        || cap["id"] != CAPABILITY
        || cap["executionProfile"] != PROFILE
        || cap["resourceInputMin"] != 2
        || cap["resourceInputMax"] != 2
        || cap
            .get("resourceInputProfile")
            .is_some_and(|value| value != INPUT)
        || types.len() != TYPES.len()
        || TYPES
            .iter()
            .any(|mime| !types.iter().any(|value| value == *mime))
        || !cap["inputSchema"].is_object()
        || !cap["outputSchema"].is_object()
        || !cap["directory"].is_object()
        || cap["maxResultBytes"]
            .as_u64()
            .is_none_or(|bytes| !(1..=8192).contains(&bytes))
    {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) fn validate_inputs<'a>(
    plugin: &str,
    capability: Option<&str>,
    inputs: impl IntoIterator<Item = (&'a str, usize)>,
) -> Result<(), &'static str> {
    let inputs = inputs.into_iter().collect::<Vec<_>>();
    if !matches_capability(plugin, capability) || inputs.len() != 2 {
        return Err("resource_profile_unsupported");
    }
    for (mime, size) in inputs {
        if size > MAX_FILE {
            return Err("resource_input_too_large");
        }
        if !TYPES.contains(&mime) {
            return Err("resource_input_type_unsupported");
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    #[serde(default)]
    mode: Mode,
    #[serde(default = "second_position")]
    incoming_position: usize,
}

pub(crate) fn validate_parameters(input: &Value) -> Result<(), &'static str> {
    let params: Params = serde_json::from_value(input.clone()).map_err(|_| "invalid_parameters")?;
    if !(1..=2).contains(&params.incoming_position) {
        return Err("invalid_parameters");
    }
    Ok(())
}

fn second_position() -> usize {
    2
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    #[default]
    Merge,
    Replace,
}

impl Mode {
    fn name(&self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Replace => "replace",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Export {
    version: u32,
    bindings: Vec<Binding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    command: String,
    sequence: String,
}

fn normalize(sequence: &str) -> Option<String> {
    let keys = sequence.split_whitespace().collect::<Vec<_>>();
    (sequence.len() <= 64
        && keys.len() <= 4
        && keys
            .iter()
            .all(|key| key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic()))
    .then(|| keys.join(" ").to_ascii_uppercase())
}

fn valid_command(id: &str) -> bool {
    matches!(
        id,
        "search" | "recorder:start" | "recorder:pause" | "recorder:stop"
    ) || (id.len() <= 512
        && id.starts_with("open:")
        && id.len() > 5
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b":/._-".contains(&b)))
}

fn parse(bytes: &[u8], max_bindings: usize, canonical: bool) -> Option<Bindings> {
    let file: Export = serde_json::from_slice(bytes).ok()?;
    if file.version != 1 || file.bindings.len() > max_bindings {
        return None;
    }
    if canonical
        && !file
            .bindings
            .windows(2)
            .all(|pair| pair[0].command < pair[1].command)
    {
        return None;
    }
    let mut result = Bindings::new();
    for binding in file.bindings {
        let sequence = normalize(&binding.sequence)?;
        if !valid_command(&binding.command)
            || (binding.command == "search" && sequence != "K")
            || (canonical && sequence != binding.sequence)
            || result.insert(binding.command, sequence).is_some()
        {
            return None;
        }
    }
    Some(result)
}

fn conflict_pairs(bindings: &Bindings) -> usize {
    let mut sequences = vec!["K"];
    sequences.extend(
        bindings
            .iter()
            .filter(|(id, keys)| id.as_str() != "search" && !keys.is_empty())
            .map(|(_, keys)| keys.as_str()),
    );
    let prefix = |first: &str, second: &str| {
        second
            .strip_prefix(first)
            .is_some_and(|tail| tail.starts_with(' '))
    };
    sequences
        .iter()
        .enumerate()
        .map(|(index, left)| {
            sequences[index + 1..]
                .iter()
                .filter(|right| left == *right || prefix(left, right) || prefix(right, left))
                .count()
        })
        .sum()
}

pub(crate) fn validate_output(
    bundle: &Bundle,
    sources: &[&[u8]],
    input: &Value,
) -> Result<(), &'static str> {
    let [first, second] = sources else {
        return Err(INVALID);
    };
    if bundle.profile != Profile::ShortcutProfile1
        || !bundle.binary
        || first.len() > MAX_FILE
        || second.len() > MAX_FILE
    {
        return Err(INVALID);
    }
    if bundle.result["ok"] == false {
        return if bundle.resources.is_empty()
            && bundle.result["data"].is_null()
            && matches!(
                bundle.result["error"]["code"].as_str(),
                Some(
                    "INVALID_REQUEST"
                        | "INVALID_RESOURCE"
                        | "FILE_LIMIT"
                        | "BINDING_LIMIT"
                        | "INVALID_BASE"
                        | "INVALID_INCOMING"
                        | "OUTPUT_FAILED"
                )
            ) {
            Ok(())
        } else {
            Err(INVALID)
        };
    }
    let params: Params = serde_json::from_value(input.clone()).map_err(|_| INVALID)?;
    let (base, incoming) = match params.incoming_position {
        1 => (*second, *first),
        2 => (*first, *second),
        _ => return Err(INVALID),
    };
    let base = parse(base, MAX_BINDINGS, false).ok_or(INVALID)?;
    let incoming = parse(incoming, MAX_BINDINGS, false).ok_or(INVALID)?;
    let imported = incoming.len();
    let mut result = match params.mode {
        Mode::Merge => base.clone(),
        Mode::Replace => Bindings::new(),
    };
    result.extend(incoming);
    let changes = base
        .iter()
        .filter(|(id, keys)| result.get(*id) != Some(*keys))
        .count()
        + result.keys().filter(|id| !base.contains_key(*id)).count();
    let conflicts = conflict_pairs(&result);
    let report = &bundle.result["data"];
    if bundle.result["ok"] != true
        || !bundle.result["error"].is_null()
        || report["mode"] != params.mode.name()
        || report["baseCount"] != json!(base.len())
        || report["incomingCount"] != json!(imported)
        || report["resultCount"] != json!(result.len())
        || report["changedCount"] != json!(changes)
        || report["conflictPairs"] != json!(conflicts)
    {
        return Err(INVALID);
    }
    if conflicts != 0 {
        return if bundle.resources.is_empty() && report["outputBytes"] == 0 {
            Ok(())
        } else {
            Err(INVALID)
        };
    }
    let [blob] = bundle.resources.as_slice() else {
        return Err(INVALID);
    };
    if blob.mime_type != JSON
        || blob.bytes.is_empty()
        || blob.bytes.len() > MAX_OUTPUT
        || report["outputBytes"] != json!(blob.bytes.len())
        || parse(&blob.bytes, 2 * MAX_BINDINGS, true).as_ref() != Some(&result)
    {
        return Err(INVALID);
    }
    Ok(())
}

#[cfg(test)]
#[path = "plugin_resource_shortcut_profile_tests.rs"]
mod tests;
