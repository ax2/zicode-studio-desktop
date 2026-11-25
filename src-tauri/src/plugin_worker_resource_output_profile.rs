//! Explicit output wire profiles. A newer frame never enlarges a legacy request.
use crate::{plugin_output_types::JSON, plugin_resource_execution::{json_compare, json_transform, shortcut_profile}};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Profile {
    Draft1,
    JsonCompare1,
    ShortcutProfile1,
    ImageMetadata2,
}
impl Profile {
    pub(crate) const METADATA_SAVE: &'static str = "resource.save.image-metadata.v1";
    pub(crate) fn uses_shared_store_budget(self) -> bool {
        matches!(self, Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1)
    }
    pub(crate) fn save_name(self) -> &'static str { match self { Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1=>"resource.save.draft1",Self::ImageMetadata2=>Self::METADATA_SAVE } }
    pub(crate) fn saved_limit(name: &str, mime: &str) -> Option<u64> {
        match name {
            "resource.save.draft1" => Some(super::MAX_BYTES as u64),
            Self::METADATA_SAVE if Self::ImageMetadata2.permits_mime(mime) => Some(128*1024*1024),
            _ => None,
        }
    }
    pub(crate) const METADATA_NAME: &'static str = "resource.wasi.output.draft2";
    pub(crate) const METADATA_EXECUTION: &'static str = "resource.wasi.image.metadata.v1";
    pub(crate) fn negotiate(
        output: Option<&str>,
        execution: Option<&str>,
    ) -> Result<Option<Self>, String> {
        match (output, execution) {
            (Some(super::PROFILE), Some(json_compare::PROFILE | json_transform::PROFILE)) => Ok(Some(Self::JsonCompare1)),
            (_, Some(json_compare::PROFILE | json_transform::PROFILE)) => Err("JSON comparison requires binary output".into()),
            (Some(super::PROFILE), Some(shortcut_profile::PROFILE)) => Ok(Some(Self::ShortcutProfile1)),
            (_, Some(shortcut_profile::PROFILE)) => Err("Shortcut profile requires binary output".into()),
            (Some(Self::METADATA_NAME), Some(Self::METADATA_EXECUTION)) => {
                Ok(Some(Self::ImageMetadata2))
            }
            (_, Some(Self::METADATA_EXECUTION)) | (Some(Self::METADATA_NAME), _) => {
                Err("Metadata output profile negotiation is incomplete".into())
            }
            (None, _) => Ok(None),
            (Some(super::PROFILE), _) => Ok(Some(Self::Draft1)),
            _ => Err("Unsupported resource output profile".into()),
        }
    }
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1 => super::PROFILE,
            Self::ImageMetadata2 => Self::METADATA_NAME,
        }
    }
    pub(crate) fn schema(self) -> u32 {
        match self {
            Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1 => 1,
            Self::ImageMetadata2 => 2,
        }
    }
    pub(crate) fn magic(self) -> &'static [u8; 8] {
        match self {
            Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1 => super::MAGIC,
            Self::ImageMetadata2 => b"ZIWO\0\0\0\x02",
        }
    }
    pub(crate) fn namespace(self) -> &'static str {
        match self {
            Self::Draft1 | Self::JsonCompare1 | Self::ShortcutProfile1 => "zicode_resource_output_draft1",
            Self::ImageMetadata2 => "zicode_resource_output_draft2",
        }
    }
    pub(crate) fn max_bytes(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_BYTES,
            Self::JsonCompare1 => json_compare::MAX_OUTPUT,
            Self::ShortcutProfile1 => shortcut_profile::MAX_OUTPUT,
            Self::ImageMetadata2 => 130 * 1024 * 1024,
        }
    }
    pub(crate) fn max_file(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_BYTES,
            Self::JsonCompare1 => json_compare::MAX_OUTPUT,
            Self::ShortcutProfile1 => shortcut_profile::MAX_OUTPUT,
            Self::ImageMetadata2 => 128 * 1024 * 1024,
        }
    }
    pub(crate) fn max_records(self) -> usize {
        match self {
            Self::Draft1 => 4,
            Self::JsonCompare1 | Self::ShortcutProfile1 => 1,
            Self::ImageMetadata2 => 2,
        }
    }
    pub(crate) fn max_frame(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_FRAME,
            Self::JsonCompare1 | Self::ShortcutProfile1 => 12 + super::MAX_HEADER + self.max_bytes(),
            Self::ImageMetadata2 => 12 + super::MAX_HEADER + self.max_bytes(),
        }
    }
    pub(crate) fn permits_mime(self, mime: &str) -> bool {
        match self {
            Self::Draft1 => mime != JSON && super::MIMES.contains(&mime),
            Self::JsonCompare1 | Self::ShortcutProfile1 => mime == JSON,
            Self::ImageMetadata2 => matches!(mime, "image/png" | "image/jpeg" | "image/webp"),
        }
    }
}
