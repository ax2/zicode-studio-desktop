//! Local note creation, with an optional citation for reviewed browser snapshots.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceCitation {
    url: String,
    captured_at: String,
    #[serde(default)]
    document_revision: Option<String>,
}
impl SourceCitation {
    fn into_source(self, content: &str) -> Result<NoteSource, NotesError> {
        chrono::DateTime::parse_from_rfc3339(&self.captured_at)
            .map_err(|_| NotesError::new("invalid_parameters", "Note source capture time is invalid"))?;
        // The caller supplies a citation, never a trusted content hash or a URL to fetch.
        Ok(NoteSource { url: self.url, captured_at: self.captured_at,
            content_hash: content_hash(content), document_revision: self.document_revision, author: None, published_at: None,
            site_name: None, image: None })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateNoteRequest {
    workspace_id: String,
    scene_id: String,
    notebook_id: String,
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    source: Option<SourceCitation>,
}

pub(super) async fn create_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CreateNoteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let source = request.source.map(|citation| citation.into_source(&request.content)).transpose().map_err(notes_api_error)?;
    let notes = state.notes.lock().map_err(|_| notes_unavailable())?;
    let scoped = notes
        .scoped(&request.workspace_id)
        .map_err(notes_api_error)?;
    let note = scoped
        .create_note(
            &request.notebook_id,
            &request.title,
            &request.content,
            request.tags,
            request.icon,
            source,
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "note": note })))
}

#[cfg(test)]
#[path = "notes_create_tests.rs"]
mod tests;
