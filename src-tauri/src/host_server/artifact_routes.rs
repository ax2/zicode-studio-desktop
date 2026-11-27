//! Artifacts HTTP endpoints installed by the shared Host router.
use super::{
    artifacts_api_error, artifacts_unavailable, plugin_api_error, HostState,
    MAX_BACKUP_HTTP_BODY_BYTES,
};
use crate::artifact_store::{ArtifactDocument, ArtifactDraft};
use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<HostState>> {
    Router::new()
        .route("/v2/artifacts", get(list_artifacts))
        .route("/v2/artifacts/item", get(get_artifact))
        .route("/v2/artifacts/create", post(create_artifact))
        .route("/v2/artifacts/delete", post(delete_artifact))
        .route(
            "/v2/artifacts/import-all",
            post(import_artifacts_all).layer(DefaultBodyLimit::max(MAX_BACKUP_HTTP_BODY_BYTES)),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactsQuery {
    workspace_id: String,
    scene_id: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    plugin_id: Option<String>,
    #[serde(default)]
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactQuery {
    workspace_id: String,
    scene_id: String,
    artifact_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArtifactRequest {
    workspace_id: String,
    scene_id: String,
    plugin_id: String,
    kind: String,
    title: String,
    #[serde(default)]
    summary: String,
    mime_type: String,
    #[serde(default)]
    provenance: Value,
    #[serde(default)]
    content: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportArtifactsAllRequest {
    workspace_id: String,
    scene_id: String,
    #[serde(default)]
    artifacts: Vec<ArtifactDocument>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteArtifactRequest {
    workspace_id: String,
    scene_id: String,
    artifact_id: String,
    expected_version: String,
}

async fn list_artifacts(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ArtifactsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &query.scene_id, None)?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&query.workspace_id)
        .map_err(artifacts_api_error)?;
    let snapshot = scoped
        .list(
            &query.scene_id,
            query.kind.as_deref(),
            query.plugin_id.as_deref(),
            query.query.as_deref(),
        )
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "snapshot": snapshot,
    })))
}

async fn get_artifact(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ArtifactQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &query.scene_id, None)?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&query.workspace_id)
        .map_err(artifacts_api_error)?;
    let artifact = scoped
        .get(&query.scene_id, &query.artifact_id)
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({ "artifact": artifact })))
}

async fn create_artifact(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CreateArtifactRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &request.scene_id, Some(&request.plugin_id))?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&request.workspace_id)
        .map_err(artifacts_api_error)?;
    let artifact = scoped
        .create(ArtifactDraft {
            workspace_id: request.workspace_id,
            scene_id: request.scene_id,
            plugin_id: request.plugin_id,
            kind: request.kind,
            title: request.title,
            summary: request.summary,
            mime_type: request.mime_type,
            provenance: request.provenance,
            content: request.content,
        })
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({ "artifact": artifact })))
}

/// Restore a workspace-level artifact bundle produced by the bulk export.
async fn import_artifacts_all(
    State(state): State<Arc<HostState>>,
    Json(request): Json<ImportArtifactsAllRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &request.scene_id, None)?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&request.workspace_id)
        .map_err(artifacts_api_error)?;
    let imported = scoped
        .import_all(&request.workspace_id, request.artifacts)
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({ "imported": imported })))
}

async fn delete_artifact(
    State(state): State<Arc<HostState>>,
    Json(request): Json<DeleteArtifactRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &request.scene_id, None)?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&request.workspace_id)
        .map_err(artifacts_api_error)?;
    scoped
        .delete(
            &request.scene_id,
            &request.artifact_id,
            &request.expected_version,
        )
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({
        "deleted": true,
        "artifactId": request.artifact_id,
    })))
}

fn ensure_artifacts_authorized(
    state: &HostState,
    scene_id: &str,
    source_plugin_id: Option<&str>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let artifacts = registry
        .execution_plugin(scene_id, "com.zicode.artifacts")
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::FORBIDDEN,
                "plugin_not_enabled",
                "Artifacts is not enabled in this scene",
            )
        })?;
    if !artifacts
        .permission_grants
        .get("storage.plugin")
        .copied()
        .unwrap_or(false)
    {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "Artifacts storage permission is not granted",
        ));
    }
    if let Some(plugin_id) = source_plugin_id {
        let source_enabled = registry
            .execution_plugin(scene_id, plugin_id)
            .is_some_and(|plugin| plugin.enabled);
        if !source_enabled {
            return Err(plugin_api_error(
                StatusCode::FORBIDDEN,
                "source_plugin_not_enabled",
                "The source plugin is not enabled in this scene",
            ));
        }
    }
    Ok(())
}
