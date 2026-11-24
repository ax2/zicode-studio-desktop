//! Native-only export of exact Host-captured results. No HTTP paths.
use super::super::plugin_resources::{
    export::Context,
    export_files::{Destination, Staged},
};
use super::*;
#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Format {
    #[default]
    Text,
    Png,
    Csv,
    Json,
}
impl Format {
    fn profile(self) -> &'static str {
        match self {
            Self::Text => "result.export.text.draft1",
            Self::Png => "result.export.png.v1",
            Self::Csv => "result.export.csv.v1",
            Self::Json => "result.export.json.v1",
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Text => "text/plain",
            Self::Png => "image/png",
            Self::Csv => "text/csv",
            Self::Json => "application/json",
        }
    }

    fn required_extension(self) -> Option<&'static str> {
        match self {
            Self::Text => None,
            Self::Png => Some("png"),
            Self::Csv => Some("csv"),
            Self::Json => Some("json"),
        }
    }

    fn bytes(self, record: &store::Record) -> Result<&[u8], ApiError> {
        match self {
            Self::Text => Ok(record.text.as_bytes()),
            Self::Png => record
                .qr_png
                .as_deref()
                .ok_or_else(|| rejected("result_export_format_unavailable")),
            Self::Csv => record
                .transform
                .csv
                .as_deref()
                .map(str::as_bytes)
                .ok_or_else(|| rejected("result_export_format_unavailable")),
            Self::Json => record
                .transform
                .json
                .as_deref()
                .map(str::as_bytes)
                .ok_or_else(|| rejected("result_export_format_unavailable")),
        }
    }
}
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    scope: Scope,
    result_id: String,
    #[serde(default)]
    format: Format,
}
struct Grant {
    context: Context,
    source: Source,
    proof: String,
    version: String,
    length: usize,
    destination: Destination,
    preview: Value,
    expires: Instant,
    saved: bool,
}
#[derive(Default)]
pub(super) struct Grants(HashMap<String, Grant>);
impl Grants {
    pub(super) fn invalidate_workspace(&mut self, workspace: &str) {
        self.0
            .retain(|_, grant| grant.context.workspace != workspace);
    }
    fn get(&self, context: &Context, source: &Source, id: &str) -> Result<&Grant, ApiError> {
        self.0
            .get(id)
            .filter(|g| g.context == *context && g.source == *source && g.expires > Instant::now())
            .ok_or_else(|| rejected("result_export_grant_invalid"))
    }
    fn prepare(
        &mut self,
        context: Context,
        source: Source,
        record: &store::Record,
        destination: Destination,
    ) -> Result<Value, ApiError> {
        self.0.retain(|_, g| g.expires > Instant::now());
        if self.0.len() >= 16 {
            return Err(rejected("result_export_busy"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let bytes = source.format.bytes(record)?;
        let profile = source.format.profile();
        let version = sha256_hex(bytes);
        let preview = json!({"schemaVersion":1,"profile":profile,"grantId":id,"destination":destination.path.to_string_lossy(),"resultId":record.id,"mimeType":source.format.mime_type(),"byteLength":bytes.len(),"contentVersion":version});
        self.0.insert(
            id.clone(),
            Grant {
                context,
                source,
                proof: record.proof.clone(),
                version,
                length: bytes.len(),
                destination,
                preview: preview.clone(),
                expires: Instant::now() + Duration::from_secs(60),
                saved: false,
            },
        );
        Ok(
            json!({"schemaVersion":1,"profile":profile,"grantId":id,"expiresInSeconds":60,"requiresConfirmation":true,"saved":false,"operation":"create_new_file","preview":preview}),
        )
    }
}
fn source(context: &Context, value: Value) -> Result<Source, ApiError> {
    let source: Source =
        serde_json::from_value(value).map_err(|_| rejected("result_export_source_invalid"))?;
    if source.scope.workspace_id != context.workspace
        || uuid::Uuid::parse_str(&source.result_id).is_err()
    {
        return Err(rejected("result_export_source_invalid"));
    }
    Ok(source)
}
fn validate_record(record: &store::Record, current: &str) -> Result<(), ApiError> {
    if record.proof != current || record.mime_type != "text/plain" {
        return Err(rejected("result_source_changed"));
    }
    Ok(())
}
fn record(state: &HostState, source: &Source) -> Result<store::Record, ApiError> {
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let current = proof(&registry, &source.scope)?;
    let record = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?
        .record(&source.scope, &source.result_id)?;
    validate_record(&record, &current.0)?;
    Ok(record)
}
fn text(error: ApiError) -> String {
    error.1.0["error"]["code"]
        .as_str()
        .unwrap_or("result_export_unavailable")
        .into()
}
impl HostServer {
    pub(crate) fn result_text_export_metadata(
        &self,
        context: &Context,
        value: Value,
    ) -> Result<Value, String> {
        (|| {
            let source = source(context, value)?;
            let record = record(&self.state, &source)?;
            let bytes = source.format.bytes(&record)?;
            let (name, extension) = if source.format == Format::Png {
                ("qr-code.png", Some("png"))
            } else if source.format == Format::Csv {
                ("data-transform.csv", Some("csv"))
            } else if source.format == Format::Json {
                ("data-transform.json", Some("json"))
            } else if source.scope.plugin_id == "com.zicode.devtools.checksum-manifest"
                && source.scope.capability_id == "devtools.checksum-manifest.generate"
            {
                ("SHA256SUMS", None)
            } else if source.scope.capability_id
                == crate::host_server::plugin_services::HTTP_GET_PROFILE
            {
                ("actuator-response.json", Some("json"))
            } else {
                ("result.txt", Some("txt"))
            };
            Ok(json!({
                "mimeType":source.format.mime_type(),"suggestedFileName":name,"extension":extension,
                "byteLength":bytes.len(),"contentVersion":sha256_hex(bytes)
            }))
        })()
        .map_err(text)
    }
    pub(crate) fn prepare_result_text_export(
        &self,
        context: Context,
        value: Value,
        path: PathBuf,
    ) -> Result<Value, String> {
        (|| {
            let source = source(&context, value)?;
            let record = record(&self.state, &source)?;
            if source.format.required_extension().is_some_and(|required| {
                !path.extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case(required))
            }) {
                return Err(rejected("result_export_path_invalid"));
            }
            let destination = Destination::prepare(path)?;
            self.state
                .plugin_results
                .lock()
                .map_err(|_| rejected("result_store_unavailable"))?
                .exports
                .prepare(context, source, &record, destination)
        })()
        .map_err(text)
    }
    pub(crate) fn cancel_result_text_export(
        &self,
        context: Context,
        value: Value,
        id: String,
    ) -> Result<(), String> {
        (|| {
            let source = source(&context, value)?;
            let mut store = self
                .state
                .plugin_results
                .lock()
                .map_err(|_| rejected("result_store_unavailable"))?;
            if store.exports.0.contains_key(&id) {
                store.exports.get(&context, &source, &id)?;
                store.exports.0.remove(&id);
            }
            Ok(())
        })()
        .map_err(text)
    }
    pub(crate) fn commit_result_text_export(
        &self,
        context: Context,
        value: Value,
        id: String,
        confirmed: bool,
    ) -> Result<Value, String> {
        (|| {
            if !confirmed { return Err(rejected("result_confirmation_required")); }
            let source = source(&context,value)?; let record = record(&self.state,&source)?;
            let gate = self.state.workspace_write_gates.gate(&context.workspace).map_err(|_| rejected("result_store_unavailable"))?;
            let closed = gate.lock().map_err(|_| rejected("result_store_unavailable"))?;
            if *closed { return Err(rejected("result_workspace_closed")); }
            let bytes = source.format.bytes(&record)?;
            let (destination, version) = {
                let store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
                let grant = store.exports.get(&context,&source,&id)?;
                if grant.saved { return Err(rejected("result_export_already_saved")); }
                if grant.proof != record.proof || grant.length != bytes.len() || grant.version != sha256_hex(bytes) { return Err(rejected("result_source_changed")); }
                (grant.destination.clone(), grant.version.clone())
            };
            let chunks = [Arc::from(bytes)];
            let staged = Staged::new(&destination,&chunks,bytes.len(),&version)?;
            // Hold the registry and result store through publication so a disable,
            // result expiry, foreign grant or second commit cannot race the write.
            let registry = self.state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?;
            if proof(&registry,&source.scope)?.0 != record.proof { return Err(rejected("result_source_changed")); }
            let mut store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
            let current = store.record(&source.scope,&source.result_id)?;
            let grant = store.exports.get(&context,&source,&id)?;
            if grant.saved || current.proof != grant.proof || sha256_hex(source.format.bytes(&current)?) != grant.version { return Err(rejected("result_source_changed")); }
            staged.publish()?;
            let grant = store.exports.0.get_mut(&id).unwrap(); grant.saved = true; grant.expires = Instant::now()+Duration::from_secs(900);
            Ok(json!({"schemaVersion":1,"profile":source.format.profile(),"saved":true,"status":"saved","receipt":grant.preview}))
        })().map_err(text)
    }
    pub(crate) fn verify_result_text_export(
        &self,
        context: Context,
        value: Value,
        id: String,
    ) -> Result<Value, String> {
        (|| { let source = source(&context,value)?; let store = self.state.plugin_results.lock().map_err(|_| rejected("result_store_unavailable"))?;
            let grant = store.exports.get(&context,&source,&id)?; if !grant.saved { return Err(rejected("result_export_not_verified")); }
            grant.destination.verify(grant.length,&grant.version)?;
            Ok(json!({"schemaVersion":1,"profile":source.format.profile(),"saved":true,"status":"verified","receipt":grant.preview})) })().map_err(text)
    }
}
#[cfg(test)]
mod tests;

#[cfg(test)]
mod qr_tests;
