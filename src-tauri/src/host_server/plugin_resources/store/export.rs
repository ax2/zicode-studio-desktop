use super::*;
impl Store {
    pub(in crate::host_server::plugin_resources) fn export_metadata(
        &mut self,
        access: &Access,
        proof: &str,
    ) -> Result<Value, ApiError> {
        self.check(access, proof)?;
        let record = &self.records[&access.resource_id];
        if record.parents.is_empty() {
            return Err(rejected("resource_export_requires_output"));
        }
        let extension = crate::plugin_output_types::extension(&record.mime)
            .ok_or_else(|| rejected("resource_metadata_invalid"))?;
        Ok(
            json!({"mimeType":record.mime,"byteLength":record.expected,"extension":extension,"contentVersion":record.version}),
        )
    }
}
