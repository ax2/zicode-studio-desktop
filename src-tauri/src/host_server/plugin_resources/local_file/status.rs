//! Volatile metadata receipts, never a resource access or execution authority.
use super::*;

const MAX_RECEIPTS: usize = 128;
struct Receipt {
    owner: Owner,
    outcome: &'static str,
    content_read: Option<bool>,
    expires: Instant,
}

#[derive(Default)]
pub(super) struct Receipts(HashMap<String, Receipt>);

impl Receipts {
    fn prune(&mut self) {
        self.0.retain(|_, value| value.expires > Instant::now());
    }

    pub(super) fn record(
        &mut self,
        id: String,
        owner: Owner,
        outcome: &'static str,
        content_read: Option<bool>,
    ) {
        self.prune();
        if self.0.len() >= MAX_RECEIPTS {
            if let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, value)| value.expires)
                .map(|(id, _)| id.clone())
            {
                self.0.remove(&oldest);
            }
        }
        self.0.insert(
            id,
            Receipt {
                owner,
                outcome,
                content_read,
                expires: Instant::now() + TTL,
            },
        );
    }
}

impl Grants {
    pub(super) fn finish(&mut self, id: &str) {
        if let Some(active) = self.1.remove(id) {
            let outcome = active.control.outcome();
            self.2.record(
                id.into(),
                active.owner,
                outcome,
                if outcome == "published" {
                    Some(true)
                } else {
                    None
                },
            );
        }
    }

    fn status(&mut self, request: &FileGrant) -> Result<Value, ApiError> {
        self.prune();
        self.2.prune();
        if let Some(pending) = self
            .0
            .get(&request.grant_id)
            .filter(|g| g.owner == request.owner)
        {
            return Ok(
                json!({"schemaVersion":1,"phase":"prepared","executionFinished":false,
                "cancellationRequested":false,"contentRead":false,
                "expiresInSeconds":pending.expires.saturating_duration_since(Instant::now()).as_secs()}),
            );
        }
        if let Some(active) = self
            .1
            .get(&request.grant_id)
            .filter(|g| g.owner == request.owner)
        {
            return Ok(
                json!({"schemaVersion":1,"phase":"reading","executionFinished":false,
                "cancellationRequested":active.control.cancellation_requested(),"contentRead":null}),
            );
        }
        if let Some(receipt) = self
            .2
             .0
            .get(&request.grant_id)
            .filter(|g| g.owner == request.owner)
        {
            return Ok(
                json!({"schemaVersion":1,"phase":"ended","executionFinished":true,
                "outcome":receipt.outcome,"contentRead":receipt.content_read}),
            );
        }
        // Missing/expired/evicted/restarted is unknown, not proof of completion.
        Err(rejected("resource_file_grant_unavailable"))
    }
}

pub(in crate::host_server) async fn get(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<FileGrant>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    schema(request.schema_version)?;
    let result = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .file_imports
        .status(&request)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests;
