use crate::visual_assets::{
    backup_commands, catalog,
    commands::LIBRARY,
    preview::{Owner, Previews},
    tags::vision::{self, Draft},
};
use crate::host_server::ResourceExportContext;
use base64::Engine;
use rusqlite::{params, Connection};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageInput {
    library_id: String,
    asset_id: i64,
    digest: String,
    preview_sha: String,
    previous: Option<String>,
}

impl ImageInput {
    fn with_catalog<T>(
        &self,
        op: impl FnOnce(&mut Connection, &Path) -> Result<T, String>,
    ) -> Result<T, String> {
        backup_commands::store()?;
        let root = crate::app_paths::data_root()?.join("visual-assets");
        let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
        let mut db = catalog::open(&root).map_err(|_| "visual_assets_library_unavailable")?;
        let valid=db.prepare("SELECT 1 FROM library,revision WHERE library.id=?1 AND revision.asset=?2 AND revision.version=1 AND revision.digest=?3")
            .and_then(|mut s|s.exists(params![self.library_id,self.asset_id,self.digest])).map_err(|_|"visual_assets_library_changed")?;
        if !valid {
            return Err("visual_assets_library_changed".into());
        }
        op(&mut db, &root)
    }

    pub fn preview(&self, owner: &ResourceExportContext) -> Result<(String, String), String> {
        self.with_catalog(|db, root| {
            let owner = Owner {
                window: owner.window.clone(),
                workspace: owner.workspace.clone(),
                route: owner.route.clone(),
            };
            let mut previews = Previews::default();
            let ticket = previews.issue(db, owner.clone(), &self.library_id, self.asset_id, 1)?;
            let png = previews.read(db, root, &owner, &ticket.handle)?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&png)
                .map_err(|_| "visual_assets_preview_unavailable")?;
            if format!("{:x}", Sha256::digest(bytes)) != self.preview_sha {
                return Err("visual_assets_library_changed".into());
            }
            let name = db
                .query_row("SELECT name FROM asset WHERE id=?1", [self.asset_id], |r| {
                    r.get(0)
                })
                .map_err(|_| "visual_assets_library_changed")?;
            Ok((png, name))
        })
    }

    pub fn save(
        &self,
        provider: &str,
        model: &str,
        origin: &str,
        labels: &[String],
    ) -> Result<(), String> {
        self.with_catalog(|db, _| {
            let tx = db.transaction().map_err(|_| "visual_assets_busy")?;
            vision::draft(
                &tx,
                Draft {
                    asset: self.asset_id,
                    digest: &self.digest,
                    preview_sha: &self.preview_sha,
                    provider,
                    model,
                    origin,
                    labels,
                },
                self.previous.as_deref(),
            )
            .map_err(|_| "visual_assets_tags_changed")?;
            tx.commit()
                .map_err(|_| "visual_assets_tag_save_failed".into())
        })
    }
}
