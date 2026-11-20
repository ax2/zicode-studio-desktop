use super::{catalog, commands::LIBRARY, generation_outputs, Result};
use crate::host_server::ResourceExportContext;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    Preview { id: Uuid, filename: String },
    Approve { token: Uuid },
    Cancel { token: Uuid },
}

struct Ticket {
    owner: ResourceExportContext,
    library: String,
    source: generation_outputs::Source,
    sha256: String,
    until: Instant,
}

const TTL: Duration = Duration::from_secs(120);
static REVIEWS: LazyLock<Mutex<HashMap<Uuid, Ticket>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static REVIEW_WORKER: Mutex<()> = Mutex::new(());

fn take(token: Uuid, owner: &ResourceExportContext, library: &str) -> Result<Ticket> {
    let mut reviews = REVIEWS
        .lock()
        .map_err(|_| "visual_assets_comfy_review_expired")?;
    if !reviews.get(&token).is_some_and(|ticket| {
        &ticket.owner == owner && ticket.library == library && ticket.until > Instant::now()
    }) {
        return Err("visual_assets_comfy_review_expired".into());
    }
    reviews
        .remove(&token)
        .ok_or_else(|| "visual_assets_comfy_review_expired".into())
}

pub(super) fn handle(
    owner: &ResourceExportContext,
    library: &Path,
    library_id: &str,
    action: Action,
    recheck: impl Fn() -> std::result::Result<(), String>,
) -> Result<Value> {
    match action {
        Action::Preview { id, filename } => {
            let _slot = REVIEW_WORKER.try_lock().map_err(|_| "visual_assets_busy")?;
            let source = {
                let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                generation_outputs::Source::load(
                    &catalog::open(library)?,
                    library_id,
                    id,
                    &filename,
                )?
            };
            let bytes = source.download()?;
            let sha256 = generation_outputs::digest(&bytes);
            let base64 = {
                let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                recheck()?;
                let mut db = catalog::open(library)?;
                super::generation_attempts::check_library(&db, library_id)?;
                generation_outputs::thumbnail(&mut db, library, &bytes)?
            };
            recheck()?;
            let token = Uuid::new_v4();
            let result = json!({"token":token,"review":{"attemptId":id,"filename":filename,"sha256":sha256,"base64":base64}});
            let mut reviews = REVIEWS
                .lock()
                .map_err(|_| "visual_assets_comfy_review_expired")?;
            let now = Instant::now();
            reviews.retain(|_, ticket| ticket.until > now && ticket.owner.window != owner.window);
            if reviews.len() >= 16 {
                return Err("visual_assets_comfy_review_expired".into());
            }
            reviews.insert(
                token,
                Ticket {
                    owner: owner.clone(),
                    library: library_id.into(),
                    source,
                    sha256,
                    until: now + TTL,
                },
            );
            Ok(result)
        }
        Action::Approve { token } => {
            let _slot = REVIEW_WORKER.try_lock().map_err(|_| "visual_assets_busy")?;
            let ticket = take(token, owner, library_id)?;
            {
                let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                let db = catalog::open(library)?;
                super::generation_attempts::check_library(&db, library_id)?;
                if let Some(archived) = ticket.source.existing(&db, &ticket.sha256)? {
                    return Ok(json!({"archived":archived}));
                }
            }
            let bytes = ticket.source.download()?;
            let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
            recheck()?;
            let archived = ticket.source.archive(
                &mut catalog::open(library)?,
                library,
                library_id,
                &bytes,
                &ticket.sha256,
                &|_| {},
            )?;
            Ok(json!({"archived":archived}))
        }
        Action::Cancel { token } => {
            let _ = take(token, owner, library_id);
            Ok(json!({"cancelled":true}))
        }
    }
}
