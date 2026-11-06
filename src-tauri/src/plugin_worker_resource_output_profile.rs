//! Explicit output wire profiles. A newer frame never enlarges a legacy request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Profile {
    Draft1,
    ImageMetadata2,
}
impl Profile {
    pub(crate) const METADATA_SAVE: &'static str = "resource.save.image-metadata.v1";
    pub(crate) fn save_name(self) -> &'static str { match self { Self::Draft1=>"resource.save.draft1",Self::ImageMetadata2=>Self::METADATA_SAVE } }
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
            Self::Draft1 => super::PROFILE,
            Self::ImageMetadata2 => Self::METADATA_NAME,
        }
    }
    pub(crate) fn schema(self) -> u32 {
        match self {
            Self::Draft1 => 1,
            Self::ImageMetadata2 => 2,
        }
    }
    pub(crate) fn magic(self) -> &'static [u8; 8] {
        match self {
            Self::Draft1 => super::MAGIC,
            Self::ImageMetadata2 => b"ZIWO\0\0\0\x02",
        }
    }
    pub(crate) fn namespace(self) -> &'static str {
        match self {
            Self::Draft1 => "zicode_resource_output_draft1",
            Self::ImageMetadata2 => "zicode_resource_output_draft2",
        }
    }
    pub(crate) fn max_bytes(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_BYTES,
            Self::ImageMetadata2 => 130 * 1024 * 1024,
        }
    }
    pub(crate) fn max_file(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_BYTES,
            Self::ImageMetadata2 => 128 * 1024 * 1024,
        }
    }
    pub(crate) fn max_records(self) -> usize {
        match self {
            Self::Draft1 => 4,
            Self::ImageMetadata2 => 2,
        }
    }
    pub(crate) fn max_frame(self) -> usize {
        match self {
            Self::Draft1 => super::MAX_FRAME,
            Self::ImageMetadata2 => 12 + super::MAX_HEADER + self.max_bytes(),
        }
    }
    pub(crate) fn permits_mime(self, mime: &str) -> bool {
        match self {
            Self::Draft1 => super::MIMES.contains(&mime),
            Self::ImageMetadata2 => matches!(mime, "image/png" | "image/jpeg" | "image/webp"),
        }
    }
}
