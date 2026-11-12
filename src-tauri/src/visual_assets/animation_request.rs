use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnimationIntent {
    pub(super) library_id: String,
    pub(super) source: AnimationSource,
    pub(super) recipe: Value,
    #[serde(default, skip_serializing_if = "AnimationFormat::is_godot")]
    pub(super) format: AnimationFormat,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum AnimationFormat {
    #[default]
    Godot,
    PngSequence,
}

impl AnimationFormat {
    fn is_godot(&self) -> bool {
        *self == Self::Godot
    }

    #[cfg(windows)]
    pub(super) fn folder_prefix(self) -> &'static str {
        match self {
            Self::Godot => "godot-animation",
            Self::PngSequence => "png-animation",
        }
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum AnimationSource {
    Atlas { asset_id: i64, revision: i64 },
    Sequence,
}

#[cfg(windows)]
impl AnimationIntent {
    pub(super) fn check_godot_installation(&self) -> super::Result<()> {
        if !self.format.is_godot() {
            return Err("Godot installation requires a Godot animation".into());
        }
        Ok(())
    }

    pub(crate) fn recipe_bytes(&self) -> super::Result<Vec<u8>> {
        use super::animation::{self, sequence};

        uuid::Uuid::parse_str(&self.library_id)?;
        let bytes = serde_json::to_vec(&self.recipe)?;
        if bytes.len() as u64 > animation::MAX_RECIPE_BYTES {
            return Err("animation recipe exceeds 64 KiB".into());
        }
        match self.source {
            AnimationSource::Atlas { asset_id, revision } => {
                if asset_id <= 0 || revision <= 0 {
                    return Err("invalid atlas revision".into());
                }
                animation::validate_atlas_recipe(&bytes)?;
            }
            AnimationSource::Sequence => {
                sequence::Selection::parse(&bytes)?;
            }
        }
        Ok(bytes)
    }
}

#[cfg(windows)]
impl AnimationSource {
    pub(super) fn worker(self) -> (&'static str, std::time::Duration) {
        use super::animation::{self, sequence};
        use std::time::Duration;

        match self {
            Self::Atlas { .. } => (animation::WORKER, Duration::from_secs(30)),
            Self::Sequence => (sequence::WORKER, Duration::from_secs(60)),
        }
    }
}
