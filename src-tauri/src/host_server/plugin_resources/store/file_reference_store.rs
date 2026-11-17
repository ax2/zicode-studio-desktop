use super::*;
use crate::plugin_worker::resource_input::Descriptor;
use file_reference::{FileBinding, OriginalFile};

impl Record {
    pub(super) fn descriptor(&self, access: &Access) -> Descriptor {
        Descriptor {
            resource_id: access.resource_id.clone(),
            content_version: self.version.clone(),
            mime_type: self.mime.clone(),
            byte_length: self.expected,
        }
    }

    pub(super) fn is_file_reference(&self) -> bool {
        matches!(self.original, Some(FileBinding::AwaitingRead(_)))
    }
}

impl Store {
    pub(in crate::host_server::plugin_resources) fn attach_original_file(
        &mut self,
        result: &mut Value,
        file: OriginalFile,
    ) {
        let Some(id) = result["resourceId"].as_str() else {
            return;
        };
        let Some(record) = self.records.get_mut(id) else {
            return;
        };
        let name = file.display_name();
        if !name.is_empty() && record.expected <= file_reference::MAX_BYTES {
            result["originalFile"] = json!({"name":name,"byteLength":record.expected});
            record.original = Some(FileBinding::Source {
                file: Arc::new(file),
                verified: false,
            });
        }
    }

    pub(in crate::host_server::plugin_resources) fn mark_original_files_verified<'a>(
        &mut self,
        accesses: impl Iterator<Item = &'a Access>,
    ) {
        for access in accesses.filter(|access| file_reference::is_source(&access.owner)) {
            if let Some(FileBinding::Source { verified, .. }) = self
                .records
                .get_mut(&access.resource_id)
                .and_then(|record| record.original.as_mut())
            {
                *verified = true;
            }
        }
    }

    pub(in crate::host_server::plugin_resources) fn file_reference_to_read(
        &mut self,
        access: &Access,
        proof: &str,
    ) -> Result<Option<(Arc<OriginalFile>, Descriptor)>, ApiError> {
        let record = self.record(access, proof)?;
        Ok(match &record.original {
            Some(FileBinding::AwaitingRead(file)) => {
                Some((file.clone(), record.descriptor(access)))
            }
            _ => None,
        })
    }
}
