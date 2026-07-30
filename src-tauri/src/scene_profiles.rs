use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub builtin: bool,
}

pub fn resolve_scene_profile(scene_id: &str) -> Result<SceneProfile, String> {
    let profiles = list_scene_profiles()?;
    profiles
        .into_iter()
        .find(|profile| profile.id == scene_id)
        .or_else(|| {
            builtin_profiles()
                .into_iter()
                .find(|profile| profile.id == "programming")
        })
        .ok_or_else(|| "Built-in programming scene is unavailable".to_string())
}

#[tauri::command]
pub fn list_scene_profiles() -> Result<Vec<SceneProfile>, String> {
    let mut profiles = builtin_profiles();
    let path = profiles_path()?;
    if path.is_file() {
        let custom = read_custom_profiles(&path)?;
        for profile in custom {
            if let Some(position) = profiles
                .iter()
                .position(|existing| existing.id == profile.id)
            {
                profiles[position] = profile;
            } else {
                profiles.push(profile);
            }
        }
    }
    Ok(profiles)
}

#[tauri::command]
pub fn save_scene_profile(mut profile: SceneProfile) -> Result<SceneProfile, String> {
    validate_profile(&profile)?;
    if builtin_profiles()
        .iter()
        .any(|builtin| builtin.id == profile.id)
    {
        return Err("Built-in scene IDs cannot be overwritten".to_string());
    }
    profile.builtin = false;
    let path = profiles_path()?;
    let mut profiles = if path.is_file() {
        read_custom_profiles(&path)?
    } else {
        Vec::new()
    };
    if let Some(existing) = profiles
        .iter_mut()
        .find(|existing| existing.id == profile.id)
    {
        *existing = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    write_custom_profiles(&path, &profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_scene_profile(scene_id: String) -> Result<(), String> {
    if builtin_profiles()
        .iter()
        .any(|profile| profile.id == scene_id)
    {
        return Err("Built-in scenes cannot be deleted".to_string());
    }
    let path = profiles_path()?;
    if !path.is_file() {
        return Ok(());
    }
    let mut profiles = read_custom_profiles(&path)?;
    profiles.retain(|profile| profile.id != scene_id);
    write_custom_profiles(&path, &profiles)
}

fn profiles_path() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|root| root.join("zicode").join("scene-profiles.json"))
        .ok_or_else(|| "Cannot resolve local application data directory".to_string())
}

fn read_custom_profiles(path: &Path) -> Result<Vec<SceneProfile>, String> {
    let contents = fs::read(path)
        .map_err(|error| format!("Cannot read scene profiles {}: {error}", path.display()))?;
    let profiles = serde_json::from_slice::<Vec<SceneProfile>>(&contents)
        .map_err(|error| format!("Invalid scene profiles {}: {error}", path.display()))?;
    for profile in &profiles {
        validate_profile(profile)?;
    }
    Ok(profiles)
}

fn write_custom_profiles(path: &Path, profiles: &[SceneProfile]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Scene profile path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let encoded = serde_json::to_vec_pretty(profiles)
        .map_err(|error| format!("Cannot encode scene profiles: {error}"))?;
    fs::write(&temporary, encoded)
        .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot replace {}: {error}", path.display()))
}

fn validate_profile(profile: &SceneProfile) -> Result<(), String> {
    if !is_valid_id(&profile.id) {
        return Err("Scene ID must be 1-64 letters, digits, dots, underscores, or hyphens".into());
    }
    if profile.name.trim().is_empty() || profile.name.chars().count() > 80 {
        return Err("Scene name must be 1-80 characters".into());
    }
    if profile.description.chars().count() > 300 {
        return Err("Scene description must be at most 300 characters".into());
    }
    if profile.system_prompt.chars().count() > 20_000 {
        return Err("Scene system prompt must be at most 20,000 characters".into());
    }
    if let Some(tools) = &profile.allowed_tools {
        if tools.len() > 64 || tools.iter().any(|tool| !is_valid_id(tool)) {
            return Err("Scene tool allowlist contains an invalid tool name".into());
        }
    }
    Ok(())
}

fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
}

fn builtin_profiles() -> Vec<SceneProfile> {
    vec![
        SceneProfile {
            id: "programming".into(),
            name: "Programming".into(),
            description: "Code, debugging, repositories, and technical research.".into(),
            system_prompt: "You are operating in the Programming scene. Prioritize correctness, reproducible verification, and preserving the user's existing work.".into(),
            allowed_tools: None,
            builtin: true,
        },
        SceneProfile {
            id: "finance".into(),
            name: "Finance".into(),
            description: "Financial analysis with a read-only local tool policy.".into(),
            system_prompt: "You are operating in the Finance scene. Clearly separate sourced facts, calculations, assumptions, and uncertainty. Do not present analysis as personalized financial advice.".into(),
            allowed_tools: Some(vec!["read".into(), "grep".into(), "find".into(), "ls".into()]),
            builtin: true,
        },
        SceneProfile {
            id: "creation".into(),
            name: "Creation".into(),
            description: "Writing, ideation, visual direction, and content production.".into(),
            system_prompt: "You are operating in the Creation scene. Preserve the requested voice, iterate concretely, and make creative choices explicit when they materially affect the result.".into(),
            allowed_tools: None,
            builtin: true,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::{builtin_profiles, is_valid_id, validate_profile, SceneProfile};

    #[test]
    fn builtins_cover_the_required_scenes_and_finance_is_read_only() {
        let profiles = builtin_profiles();
        assert!(profiles.iter().any(|profile| profile.id == "programming"));
        assert!(profiles.iter().any(|profile| profile.id == "creation"));
        let finance = profiles
            .iter()
            .find(|profile| profile.id == "finance")
            .unwrap();
        assert_eq!(
            finance
                .allowed_tools
                .as_ref()
                .unwrap()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["read", "grep", "find", "ls"]
        );
    }

    #[test]
    fn validates_custom_profile_boundaries() {
        assert!(is_valid_id("research.custom-1"));
        assert!(!is_valid_id("../escape"));
        let invalid = SceneProfile {
            id: "../escape".into(),
            name: "Invalid".into(),
            description: String::new(),
            system_prompt: String::new(),
            allowed_tools: None,
            builtin: false,
        };
        assert!(validate_profile(&invalid).is_err());
    }
}
