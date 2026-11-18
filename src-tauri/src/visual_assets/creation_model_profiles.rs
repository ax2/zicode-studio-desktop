//! Named image model configurations. Secrets remain in the existing image endpoint vault.
use super::{Result, creation_store::Store, creation_types::Settings};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Profile {
    pub id: Uuid,
    pub name: String,
    pub settings: Settings,
}

pub(super) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS image_model_profile(workspace TEXT NOT NULL,scene TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),settings TEXT NOT NULL,PRIMARY KEY(workspace,scene,id));
        CREATE TABLE IF NOT EXISTS image_model_selection(workspace TEXT NOT NULL,scene TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(workspace,scene));")?;
    Ok(())
}

impl Store {
    pub fn model_profiles(&self) -> Result<Vec<Profile>> {
        let db = self.db()?;
        let mut statement = db.prepare("SELECT id,name,settings FROM image_model_profile WHERE workspace=?1 AND scene=?2 ORDER BY rowid LIMIT 33")?;
        let rows = statement
            .query_map(params![self.workspace, self.scene], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if rows.len() > 32 {
            return Err("visual_assets_model_profile_limit".into());
        }
        rows.into_iter()
            .map(|(id, name, settings)| {
                Ok(Profile {
                    id: Uuid::parse_str(&id)?,
                    name,
                    settings: serde_json::from_str(&settings)?,
                })
            })
            .collect()
    }
    pub fn selected_model_profile(&self) -> Result<Option<Uuid>> {
        let id: Option<String> = self
            .db()?
            .query_row(
                "SELECT id FROM image_model_selection WHERE workspace=?1 AND scene=?2",
                params![self.workspace, self.scene],
                |row| row.get(0),
            )
            .optional()?;
        id.map(|id| Uuid::parse_str(&id).map_err(Into::into))
            .transpose()
    }
    pub fn check_model_profile(&self, name: &str, settings: &Settings) -> Result<()> {
        settings.endpoint()?;
        if name.trim() != name
            || name.is_empty()
            || name.chars().count() > 80
            || name.chars().any(char::is_control)
        {
            return Err("visual_assets_model_profile_name_invalid".into());
        }
        let count: i64 = self.db()?.query_row(
            "SELECT count(*) FROM image_model_profile WHERE workspace=?1 AND scene=?2",
            params![self.workspace, self.scene],
            |row| row.get(0),
        )?;
        if count >= 32 {
            return Err("visual_assets_model_profile_limit".into());
        }
        Ok(())
    }
    pub fn save_model_profile(&self, name: &str, settings: &Settings) -> Result<Uuid> {
        settings.endpoint()?;
        if name.trim() != name
            || name.is_empty()
            || name.chars().count() > 80
            || name.chars().any(char::is_control)
        {
            return Err("visual_assets_model_profile_name_invalid".into());
        }
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let count: i64 = tx.query_row(
            "SELECT count(*) FROM image_model_profile WHERE workspace=?1 AND scene=?2",
            params![self.workspace, self.scene],
            |row| row.get(0),
        )?;
        if count >= 32 {
            return Err("visual_assets_model_profile_limit".into());
        }
        // The first named replacement retains the previously configured model.
        // Loading a list alone never mutates the current configuration.
        if count == 0 {
            let previous: Option<String> = tx
                .query_row(
                    "SELECT settings FROM image_settings WHERE workspace=?1 AND scene=?2",
                    params![self.workspace, self.scene],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(previous) = previous {
                if let Ok(previous) = serde_json::from_str::<Settings>(&previous) {
                    if &previous != settings && previous.endpoint().is_ok() {
                        tx.execute(
                            "INSERT INTO image_model_profile VALUES(?1,?2,?3,?4,?5)",
                            params![
                                self.workspace,
                                self.scene,
                                Uuid::new_v4().to_string(),
                                previous.model.chars().take(80).collect::<String>(),
                                serde_json::to_string(&previous)?
                            ],
                        )?;
                    }
                }
            }
        }
        let id = Uuid::new_v4();
        let encoded = serde_json::to_string(settings)?;
        tx.execute(
            "INSERT INTO image_model_profile VALUES(?1,?2,?3,?4,?5)",
            params![self.workspace, self.scene, id.to_string(), name, encoded],
        )?;
        tx.execute("INSERT INTO image_settings VALUES(?1,?2,?3) ON CONFLICT(workspace,scene) DO UPDATE SET settings=excluded.settings",params![self.workspace,self.scene,encoded])?;
        tx.execute("INSERT INTO image_model_selection VALUES(?1,?2,?3) ON CONFLICT(workspace,scene) DO UPDATE SET id=excluded.id",params![self.workspace,self.scene,id.to_string()])?;
        tx.commit()?;
        Ok(id)
    }
    pub fn select_model_profile(&self, id: Uuid) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let settings: Option<String> = tx.query_row("SELECT settings FROM image_model_profile WHERE workspace=?1 AND scene=?2 AND id=?3",params![self.workspace,self.scene,id.to_string()],|row|row.get(0)).optional()?;
        let settings = settings.ok_or("visual_assets_model_profile_unavailable")?;
        serde_json::from_str::<Settings>(&settings)?.endpoint()?;
        tx.execute("INSERT INTO image_settings VALUES(?1,?2,?3) ON CONFLICT(workspace,scene) DO UPDATE SET settings=excluded.settings",params![self.workspace,self.scene,settings])?;
        tx.execute("INSERT INTO image_model_selection VALUES(?1,?2,?3) ON CONFLICT(workspace,scene) DO UPDATE SET id=excluded.id",params![self.workspace,self.scene,id.to_string()])?;
        tx.commit()?;
        Ok(())
    }
    pub fn remove_model_profile(&self, id: Uuid) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "DELETE FROM image_model_profile WHERE workspace=?1 AND scene=?2 AND id=?3",
            params![self.workspace, self.scene, id.to_string()],
        )? != 1
        {
            return Err("visual_assets_model_profile_unavailable".into());
        }
        tx.execute(
            "DELETE FROM image_model_selection WHERE workspace=?1 AND scene=?2 AND id=?3",
            params![self.workspace, self.scene, id.to_string()],
        )?;
        // Existing jobs, images, active settings and shared endpoint credentials remain intact.
        tx.commit()?;
        Ok(())
    }
}
