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
    if !path.is_file() && !crate::desktop_profile::is_isolated() {
        return Ok(());
    }
    let mut profiles = read_custom_profiles(&path)?;
    profiles.retain(|profile| profile.id != scene_id);
    write_custom_profiles(&path, &profiles)
}

fn profiles_path() -> Result<PathBuf, String> {
    let path = crate::app_paths::system_root()?.join("scene-profiles.json");
    if !path.is_file() {
        // One-time migration from the previous app data location.
        if let Some(root) = dirs::data_local_dir() {
            let legacy = root.join("zicode").join("scene-profiles.json");
            if legacy.is_file() {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                    let _ = fs::copy(&legacy, &path);
                }
            }
        }
    }
    Ok(path)
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
            description: "Engineering workflows for coding, debugging, repository changes, and reproducible verification.".into(),
            system_prompt: concat!(
                "You are operating in the Programming scene. ",
                "Treat repository instructions and the user's existing work as constraints. ",
                "Inspect the relevant code and establish the likely cause before editing. ",
                "Make the smallest coherent change, preserve unrelated work, and verify it with focused tests or checks. ",
                "Clearly distinguish observed facts from inference, report the files changed, and disclose any unverified risk. ",
                "Ask for clarification only when a missing choice would materially change the implementation."
            ).into(),
            allowed_tools: None,
            builtin: true,
        },
        SceneProfile {
            id: "finance".into(),
            name: "Finance".into(),
            description: "Evidence-led financial research, strategy testing, screening, and isolated paper trading.".into(),
            system_prompt: concat!(
                "You are operating in the Finance scene. ",
                "Separate sourced facts, calculations, assumptions, scenarios, and uncertainty. ",
                "For every material figure, state its currency, unit, period, and as-of date when known; show formulas for derived values. ",
                "Never invent prices, filings, economic data, or source attribution, and make stale or missing data explicit. ",
                "Compare meaningful base, upside, and downside cases when forecasting. ",
                "Use supplied local data when it has clear provenance and as-of time; do not require an external data account for research, screening, backtests, or paper trading. ",
                "When using the optional QVeris external source, Discover then Inspect, disclose the current billing rule, and call only after the user confirms the expected cost. ",
                "After a QVeris Call, use qveris_usage when final charge outcome or credit reconciliation matters. ",
                "Use the deterministic finance_backtest tool for strategy results instead of estimating a backtest in prose. ",
                "Normalize provider price rows with finance_normalize_ohlcv using explicit fields from the supplied data or current provider schema before backtesting. ",
                "Use finance_screen for explainable factor rankings and report missing-data coverage. ",
                "Persist sourced results with finance_market_data so downstream analysis retains as-of time, currency, provider, and available execution provenance. ",
                "Paper accounts and orders are simulations only; require an explicit sourced price snapshot and never imply that a real broker order was placed. ",
                "Pending limit orders reserve simulated resources; process or cancel them only through finance_paper_limit_order and report every status transition. ",
                "Do not present analysis as personalized financial, tax, or legal advice and do not recommend executing a transaction. ",
                "The repository tool policy is read-only; only the dedicated paper-trading tools may persist their isolated simulated ledger."
            ).into(),
            allowed_tools: Some(vec![
                "read".into(),
                "grep".into(),
                "find".into(),
                "ls".into(),
                "qveris_status".into(),
                "qveris_discover".into(),
                "qveris_inspect".into(),
                "qveris_call".into(),
                "qveris_usage".into(),
                "finance_backtest".into(),
                "finance_normalize_ohlcv".into(),
                "finance_screen".into(),
                "finance_market_data".into(),
                "finance_paper_account".into(),
                "finance_paper_order".into(),
                "finance_paper_limit_order".into(),
            ]),
            builtin: true,
        },
        SceneProfile {
            id: "creation".into(),
            name: "Creation".into(),
            description: "Structured writing, ideation, visual direction, and iterative content production.".into(),
            system_prompt: concat!(
                "You are operating in the Creation scene. ",
                "Infer the audience, format, objective, and voice from the request and preserve the meaning of supplied source material. ",
                "Move quickly from abstract ideas to a concrete draft or production-ready direction. ",
                "Maintain internal consistency across terminology, tone, characters, and visual language. ",
                "Offer alternatives only when they help a real decision, and explain creative choices that materially affect the result. ",
                "When revising, preserve effective elements and identify what changed."
            ).into(),
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
            vec![
                "read",
                "grep",
                "find",
                "ls",
                "qveris_status",
                "qveris_discover",
                "qveris_inspect",
                "qveris_call",
                "qveris_usage",
                "finance_backtest",
                "finance_normalize_ohlcv",
                "finance_screen",
                "finance_market_data",
                "finance_paper_account",
                "finance_paper_order",
                "finance_paper_limit_order"
            ]
        );
        assert!(finance.system_prompt.contains("currency"));
        assert!(finance.system_prompt.contains("as-of date"));
        assert!(profiles
            .iter()
            .find(|profile| profile.id == "programming")
            .unwrap()
            .system_prompt
            .contains("focused tests"));
        assert!(profiles
            .iter()
            .find(|profile| profile.id == "creation")
            .unwrap()
            .system_prompt
            .contains("concrete draft"));
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
