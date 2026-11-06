//! Native-only text export of an exact Host-captured result. No HTTP paths.
use super::*;
use super::super::plugin_resources::{export::Context, export_files::{Destination, Staged}};
const PROFILE: &str = "result.export.text.draft1";
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source { scope: Scope, result_id: String }
struct Grant { context: Context, source: Source, proof: String, version: String, length: usize,
    destination: Destination, preview: Value, expires: Instant, saved: bool }
#[derive(Default)]
pub(super) struct Grants(HashMap<String, Grant>);
impl Grants {
    pub(super) fn invalidate_workspace(&mut self, workspace: &str) { self.0.retain(|_, grant| grant.context.workspace != workspace); }
    fn get(&self, context: &Context, source: &Source, id: &str) -> Result<&Grant, ApiError> {
        self.0.get(id).filter(|g| g.context == *context && g.source == *source && g.expires > Instant::now())
            .ok_or_else(|| rejected("result_export_grant_invalid"))
    }
    fn prepare(&mut self, context: Context, source: Source, record: &store::Record, destination: Destination) -> Result<Value, ApiError> {
        self.0.retain(|_, g| g.expires > Instant::now());
        if self.0.len() >= 16 { return Err(rejected("result_export_busy")); }
        let id = uuid::Uuid::new_v4().to_string(); let version = sha256_hex(record.text.as_bytes());
        let preview = json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"destination":destination.path.to_string_lossy(),"resultId":record.id,"mimeType":"text/plain","byteLength":record.text.len(),"contentVersion":version});
        self.0.insert(id.clone(), Grant { context, source, proof: record.proof.clone(), version,
            length:record.text.len(), destination, preview:preview.clone(), expires:Instant::now()+Duration::from_secs(60), saved:false });
        Ok(json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"expiresInSeconds":60,"requiresConfirmation":true,"saved":false,"operation":"create_new_file","preview":preview}))
    }
}
fn source(context: &Context, value: Value) -> Result<Source, ApiError> {
    let source: Source = serde_json::from_value(value).map_err(|_| rejected("result_export_source_invalid"))?;
    if source.scope.workspace_id != context.workspace || uuid::Uuid::parse_str(&source.result_id).is_err() { return Err(rejected("result_export_source_invalid")); }
    Ok(source)
}
fn validate_record(record: &store::Record, current: &str) -> Result<(), ApiError> {
    if record.proof != current || record.mime_type != "text/plain" { return Err(rejected("result_source_changed")); }
    Ok(())
}
fn record(state: &HostState, source: &Source) -> Result<store::Record, ApiError> {
    let registry = state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?;
    let current = proof(&registry, &source.scope)?;
    let record = state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?.record(&source.scope, &source.result_id)?;
    validate_record(&record,&current.0)?;
    Ok(record)
}
fn text(error: ApiError) -> String { error.1.0["error"]["code"].as_str().unwrap_or("result_export_unavailable").into() }
impl HostServer {
    pub(crate) fn result_text_export_metadata(&self, context: &Context, value: Value) -> Result<Value, String> {
        (|| { let source = source(context,value)?; let record = record(&self.state,&source)?;
            Ok(json!({"mimeType":"text/plain","extension":"txt","byteLength":record.text.len(),"contentVersion":sha256_hex(record.text.as_bytes())})) })().map_err(text)
    }
    pub(crate) fn prepare_result_text_export(&self, context: Context, value: Value, path: PathBuf) -> Result<Value, String> {
        (|| { let source = source(&context,value)?; let record = record(&self.state,&source)?; let destination = Destination::prepare(path)?;
            self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?.exports.prepare(context,source,&record,destination) })().map_err(text)
    }
    pub(crate) fn cancel_result_text_export(&self, context: Context, value: Value, id: String) -> Result<(), String> {
        (|| { let source = source(&context,value)?; let mut store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
            if store.exports.0.contains_key(&id) { store.exports.get(&context,&source,&id)?; store.exports.0.remove(&id); } Ok(()) })().map_err(text)
    }
    pub(crate) fn commit_result_text_export(&self, context: Context, value: Value, id: String, confirmed: bool) -> Result<Value, String> {
        (|| {
            if !confirmed { return Err(rejected("result_confirmation_required")); }
            let source = source(&context,value)?; let record = record(&self.state,&source)?;
            let gate = self.state.workspace_write_gates.gate(&context.workspace).map_err(|_| rejected("result_store_unavailable"))?;
            let closed = gate.lock().map_err(|_| rejected("result_store_unavailable"))?;
            if *closed { return Err(rejected("result_workspace_closed")); }
            let (destination, version) = {
                let store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
                let grant = store.exports.get(&context,&source,&id)?;
                if grant.saved { return Err(rejected("result_export_already_saved")); }
                if grant.proof != record.proof || grant.length != record.text.len() || grant.version != sha256_hex(record.text.as_bytes()) { return Err(rejected("result_source_changed")); }
                (grant.destination.clone(), grant.version.clone())
            };
            let chunks: Vec<Arc<[u8]>> = vec![Arc::from(record.text.as_bytes())];
            let staged = Staged::new(&destination,&chunks,record.text.len(),&version)?;
            // Hold the registry and result store through publication so a disable,
            // result expiry, foreign grant or second commit cannot race the write.
            let registry = self.state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?;
            if proof(&registry,&source.scope)?.0 != record.proof { return Err(rejected("result_source_changed")); }
            let mut store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
            let current = store.record(&source.scope,&source.result_id)?;
            let grant = store.exports.get(&context,&source,&id)?;
            if grant.saved || current.proof != grant.proof || sha256_hex(current.text.as_bytes()) != grant.version { return Err(rejected("result_source_changed")); }
            staged.publish()?;
            let grant = store.exports.0.get_mut(&id).unwrap(); grant.saved = true; grant.expires = Instant::now()+Duration::from_secs(900);
            Ok(json!({"schemaVersion":1,"profile":PROFILE,"saved":true,"status":"saved","receipt":grant.preview}))
        })().map_err(text)
    }
    pub(crate) fn verify_result_text_export(&self, context: Context, value: Value, id: String) -> Result<Value, String> {
        (|| { let source = source(&context,value)?; let store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
            let grant = store.exports.get(&context,&source,&id)?; if !grant.saved { return Err(rejected("result_export_not_verified")); }
            grant.destination.verify(grant.length,&grant.version)?;
            Ok(json!({"schemaVersion":1,"profile":PROFILE,"saved":true,"status":"verified","receipt":grant.preview})) })().map_err(text)
    }
}
#[cfg(test)]
mod tests;
