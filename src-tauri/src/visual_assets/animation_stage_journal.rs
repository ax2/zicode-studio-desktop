use super::{
    super::{animation_stage, reference_source, Result},
    Store,
};
use rusqlite::params;
use std::path::Path;
use uuid::Uuid;

impl Store {
    pub(super) fn register_animation_stage(
        &self,
        job_id: &str,
        nonce: Uuid,
        identity: &reference_source::Identity,
    ) -> Result<()> {
        if self.connect()?.execute(
            "INSERT INTO animation_stage(job_id,nonce,directory_identity)
             SELECT id,?2,?3 FROM job WHERE id=?1 AND operation='animation' AND state='running'",
            params![job_id, nonce.to_string(), serde_json::to_string(identity)?],
        )? != 1
        {
            return Err("animation job is no longer active".into());
        }
        Ok(())
    }

    pub(super) fn recover_animation_stages(&self, job_id: Option<&str>) -> Result<()> {
        let db = self.connect()?;
        let mut query = db.prepare(
            "SELECT job.id,job.destination,animation_stage.nonce,animation_stage.directory_identity
             FROM animation_stage JOIN job ON job.id=animation_stage.job_id
             WHERE job.operation='animation' AND job.state IN ('completed','interrupted','cancelled','failed')
               AND (?1 IS NULL OR job.id=?1)
             ORDER BY animation_stage.attempts,job.ordinal LIMIT 16",
        )?;
        let rows = query.query_map([job_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let records = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(query);
        for (id, destination, nonce, identity) in records {
            let removed: Result<()> = (|| {
                let parent = Path::new(&destination)
                    .parent()
                    .ok_or("missing animation staging parent")?;
                animation_stage::remove(
                    parent,
                    Uuid::parse_str(&nonce)?,
                    &serde_json::from_str(&identity)?,
                )
            })();
            let update = if removed.is_ok() {
                "DELETE FROM animation_stage WHERE job_id=?1"
            } else {
                "UPDATE animation_stage SET attempts=attempts+1 WHERE job_id=?1"
            };
            db.execute(update, [&id])?;
        }
        Ok(())
    }
}
