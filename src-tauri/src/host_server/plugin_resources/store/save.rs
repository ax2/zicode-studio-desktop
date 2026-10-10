use super::*;

#[derive(Clone)]
pub(in crate::host_server::plugin_resources) struct SaveGrant {
    pub source: Access,
    pub proof: String,
    pub destination: String,
    pub workspace: std::path::PathBuf,
    pub receipt: Value,
    pub extension: String,
    pub saved: bool,
    expires: Instant,
}

impl Store {
    pub(in crate::host_server::plugin_resources) fn prepare_save(&mut self, source: &Access, proof: &str,
        destination: String, workspace: std::path::PathBuf, workspace_id: &str, package_version: &str) -> Result<Value, ApiError> {
        self.check(source, proof)?;
        self.saves.retain(|_, grant| grant.expires > Instant::now());
        if self.saves.len() >= 16 { return Err(rejected("resource_save_busy")); }
        let record = &self.records[&source.resource_id];
        let extension = match record.mime.as_str() { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp", "text/plain" => "txt", _ => "bin" };
        let id = uuid::Uuid::new_v4().to_string();
        let receipt = json!({"schemaVersion":1,"profile":"resource.save.draft1","saveId":id,"workspaceId":workspace_id,
            "relativePath":format!(".zicode/outputs/{id}/result.{extension}"),"mimeType":record.mime,"byteLength":record.expected,
            "contentVersion":record.version,"preparedAt":chrono::Utc::now().to_rfc3339(),
            "source":{"pluginId":source.owner.plugin_id,"capabilityId":source.owner.capability_id,"resourceId":source.resource_id,"packageVersion":package_version}});
        self.saves.insert(id.clone(), SaveGrant { source: source.clone(), proof: proof.into(), destination, workspace,
            receipt: receipt.clone(), extension: extension.into(), saved: false, expires: Instant::now() + Duration::from_secs(60) });
        Ok(json!({"schemaVersion":1,"profile":"resource.save.draft1","grantId":id,"expiresInSeconds":60,
            "requiresConfirmation":true,"saved":false,"operation":"create_new_file","preview":receipt}))
    }
    pub(in crate::host_server::plugin_resources) fn save_grant(&mut self, source: &Access, id: &str, proof: &str, destination: &str) -> Result<SaveGrant, ApiError> {
        self.check(source, proof)?;
        let grant = self.saves.get(id).filter(|grant| grant.expires > Instant::now()
            && grant.source.owner == source.owner && grant.source.resource_id == source.resource_id && grant.source.content_version == source.content_version)
            .ok_or_else(|| rejected("resource_save_grant_invalid"))?;
        if grant.proof != proof || grant.destination != destination { return Err(rejected("resource_authorization_changed")); }
        Ok(grant.clone())
    }
    pub(in crate::host_server::plugin_resources) fn save_chunks(&mut self, source: &Access, proof: &str) -> Result<Vec<Arc<[u8]>>, ApiError> {
        self.check(source, proof)?; Ok(self.records[&source.resource_id].chunks.clone())
    }
    pub(in crate::host_server::plugin_resources) fn mark_saved(&mut self, id: &str) { self.saves.get_mut(id).unwrap().saved = true; }
}

#[cfg(test)]
#[path = "save_tests.rs"]
mod tests;
