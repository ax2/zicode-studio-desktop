//! Trusted desktop export. Native picker paths never cross into a plugin/HTTP API.
use super::*;
const PROFILE: &str = "resource.export.file.draft1";
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Context {
    pub window: String,
    pub workspace: String,
    pub route: String,
}
struct Grant {
    context: Context,
    source: Access,
    proof: String,
    destination: export_files::Destination,
    preview: Value,
    expires: Instant,
    saved: bool,
}
#[derive(Default)]
pub(super) struct Grants(HashMap<String, Grant>);
impl Grants {
    pub(super) fn invalidate_runtime(&mut self, id: &str) {
        self.0.retain(|_, g| g.source.owner.runtime_id != id);
    }
    fn prepare(
        &mut self,
        context: Context,
        source: Access,
        proof: String,
        destination: export_files::Destination,
        metadata: Value,
    ) -> Result<Value, ApiError> {
        self.0.retain(|_, g| g.expires > Instant::now());
        if self.0.len() >= 16 {
            return Err(rejected("resource_export_busy"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let preview = json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"destination":destination.path.to_string_lossy(),"mimeType":metadata["mimeType"],"byteLength":metadata["byteLength"],"contentVersion":source.content_version,"source":source});
        self.0.insert(
            id.clone(),
            Grant {
                context,
                source,
                proof,
                destination,
                preview: preview.clone(),
                expires: Instant::now() + Duration::from_secs(60),
                saved: false,
            },
        );
        Ok(
            json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"expiresInSeconds":60,"requiresConfirmation":true,"saved":false,"operation":"create_new_file","preview":preview}),
        )
    }
    fn get(&self, context: &Context, source: &Access, id: &str) -> Result<&Grant, ApiError> {
        self.0
            .get(id)
            .filter(|g| {
                g.context == *context
                    && g.source.owner == source.owner
                    && g.source.resource_id == source.resource_id
                    && g.source.content_version == source.content_version
                    && g.expires > Instant::now()
            })
            .ok_or_else(|| rejected("resource_export_grant_invalid"))
    }
}
fn source(value: Value) -> Result<Access, ApiError> {
    let access: Access =
        serde_json::from_value(value).map_err(|_| rejected("resource_metadata_invalid"))?;
    validate(&access)?;
    Ok(access)
}
fn authority(state: &HostState, context: &Context, source: &Access) -> Result<String, ApiError> {
    let proof = authority::identity_access(state, source, None, None)?;
    let matches = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .iter()
        .any(|s| {
            s.target.instance_id == source.owner.runtime_id
                && s.target.session_id == source.owner.session_id
                && s.target.workspace_id == context.workspace
        });
    if !matches {
        return Err(rejected("resource_export_window_changed"));
    }
    Ok(proof)
}
fn text(error: ApiError) -> String {
    error.1 .0["error"]["code"]
        .as_str()
        .unwrap_or("resource_export_unavailable")
        .into()
}
impl HostServer {
    pub(crate) fn resource_export_metadata(
        &self,
        context: &Context,
        value: Value,
    ) -> Result<Value, String> {
        (|| {
            let access = source(value)?;
            let proof = authority(&self.state, context, &access)?;
            self.state
                .plugin_resources
                .lock()
                .map_err(|_| rejected("resource_store_unavailable"))?
                .export_metadata(&access, &proof)
        })()
        .map_err(text)
    }
    pub(crate) fn prepare_resource_export(
        &self,
        context: Context,
        value: Value,
        path: PathBuf,
    ) -> Result<Value, String> {
        (|| {
            let access = source(value)?;
            let proof = authority(&self.state, &context, &access)?;
            let destination = export_files::Destination::prepare(path)?;
            let mut store = self
                .state
                .plugin_resources
                .lock()
                .map_err(|_| rejected("resource_store_unavailable"))?;
            let metadata = store.export_metadata(&access, &proof)?;
            store
                .exports
                .prepare(context, access, proof, destination, metadata)
        })()
        .map_err(text)
    }
    pub(crate) fn cancel_resource_export(
        &self,
        context: Context,
        value: Value,
        id: String,
    ) -> Result<(), String> {
        (|| {
            let access = source(value)?;
            let mut store = self
                .state
                .plugin_resources
                .lock()
                .map_err(|_| rejected("resource_store_unavailable"))?;
            if store.exports.0.contains_key(&id) {
                store.exports.get(&context, &access, &id)?;
                store.exports.0.remove(&id);
            }
            Ok(())
        })()
        .map_err(text)
    }
    pub(crate) fn commit_resource_export(
        &self,
        context: Context,
        value: Value,
        id: String,
        confirmed: bool,
    ) -> Result<Value, String> {
        (|| {
            if !confirmed { return Err(rejected("resource_confirmation_required")); }
            let access = source(value)?;
            let proof = authority(&self.state, &context, &access)?;
            let (destination, preview, chunks) = {
                let mut store = self.state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
                let grant = store.exports.get(&context, &access, &id)?;
                if grant.proof != proof { return Err(rejected("resource_authorization_changed")); }
                if grant.saved { return Err(rejected("resource_export_already_saved")); }
                let destination = grant.destination.clone();
                let preview = grant.preview.clone();
                let chunks = store.save_chunks(&access, &proof)?;
                (destination, preview, chunks)
            };
            let staged = export_files::Staged::new(&destination, &chunks, preview["byteLength"].as_u64().unwrap() as usize, &access.content_version)?;
            let current = authority(&self.state, &context, &access)?;
            let mut store = self.state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
            store.check(&access, &current)?;
            let grant = store.exports.get(&context, &access, &id)?;
            if grant.proof != current || grant.saved { return Err(rejected("resource_authorization_changed")); }
            staged.publish()?;
            let grant = store.exports.0.get_mut(&id).unwrap();
            grant.saved = true;
            grant.expires = Instant::now() + Duration::from_secs(900);
            Ok(json!({"schemaVersion":1,"profile":PROFILE,"saved":true,"status":"saved","receipt":preview}))
        })().map_err(text)
    }
    pub(crate) fn verify_resource_export(
        &self,
        context: Context,
        value: Value,
        id: String,
    ) -> Result<Value, String> {
        (|| {
            let access = source(value)?;
            let (destination, preview) = {
                let store = self.state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
                let grant = store.exports.get(&context, &access, &id)?;
                if !grant.saved { return Err(rejected("resource_export_not_verified")); }
                (grant.destination.clone(), grant.preview.clone())
            };
            destination.verify(preview["byteLength"].as_u64().unwrap() as usize, &access.content_version)?;
            Ok(json!({"schemaVersion":1,"profile":PROFILE,"saved":true,"status":"verified","receipt":preview}))
        })().map_err(text)
    }
}

#[cfg(test)]
mod tests;
