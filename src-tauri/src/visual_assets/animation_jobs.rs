use super::{
    super::{animation_export, animation_install, animation_request::AnimationIntent, Result},
    AnimationSubmission, Job, Store,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use std::{fs, path::Path, sync::Mutex};

impl Store {
    pub(crate) fn begin_animation(&self, parent: &Path, intent: &AnimationIntent) -> Result<Job> {
        intent.recipe_bytes()?;
        let parent = fs::canonicalize(parent)?;
        if !parent.is_dir() {
            return Err("animation destination must be a directory".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let destination = parent.join(format!("{}-{id}", intent.format.folder_prefix()));
        self.insert(
            id,
            destination,
            "animation",
            false,
            Some(AnimationSubmission {
                intent,
                install_previous: None,
                retry: None,
            }),
        )
    }

    pub(crate) fn begin_animation_install(
        &self,
        plan: &animation_install::Plan,
        intent: &AnimationIntent,
    ) -> Result<Job> {
        intent.check_godot_installation()?;
        intent.recipe_bytes()?;
        self.insert(
            uuid::Uuid::new_v4().to_string(),
            plan.destination.clone(),
            "animation",
            false,
            Some(AnimationSubmission {
                intent,
                install_previous: Some(plan.previous.as_deref()),
                retry: None,
            }),
        )
    }

    pub(crate) fn run_animation(
        &self,
        job: &Job,
        library: &Path,
        library_lock: &Mutex<()>,
        observe: &impl Fn(&str),
    ) -> Result<()> {
        let mut published = false;
        let outcome = (|| {
            self.checkpoint(&job.id, "animation-preparing")?;
            let library = fs::canonicalize(library)?;
            if job.destination.starts_with(&library) {
                return Err("animation export must be outside the library".into());
            }
            let db = self.connect()?;
            let intent: String = db.query_row(
                "SELECT intent FROM animation_intent WHERE job_id=?1",
                [&job.id],
                |row| row.get(0),
            )?;
            let install: Option<Option<String>> = db
                .query_row(
                    "SELECT previous_version FROM animation_install WHERE job_id=?1",
                    [&job.id],
                    |row| row.get(0),
                )
                .optional()?;
            let reusable_digest: Option<String> = db
                .query_row(
                    "SELECT reusable_digest FROM animation_retry WHERE job_id=?1 AND reusable_digest IS NOT NULL",
                    [&job.id],
                    |row| row.get(0),
                )
                .optional()?;
            drop(db);
            let intent: AnimationIntent = serde_json::from_str(&intent)?;
            let recipe = intent.recipe_bytes()?;
            let worker = intent.source.worker();
            let checkpoint = |phase: &str| -> Result<()> {
                self.checkpoint(&job.id, phase)?;
                observe(phase);
                Ok(())
            };
            let ready = |digest: &str| -> Result<()> {
                self.prepare_animation(&job.id, digest)?;
                observe("animation-ready");
                Ok(())
            };
            let create_stage = |parent| {
                let stage = animation_export::Stage::create_tracked(parent, |nonce, identity| {
                    self.register_animation_stage(&job.id, nonce, identity)
                })?;
                checkpoint("animation-stage-created")?;
                Ok(stage)
            };
            let prepare = |stage: &Path| {
                let _guard = library_lock.lock().map_err(|_| "library unavailable")?;
                animation_export::stage_intent(stage, &library, &intent, &recipe, &|| {
                    self.checkpoint(&job.id, "animation-preparing")
                })
            };
            if let Some(previous) = install {
                intent.check_godot_installation()?;
                let reused = if let (Some(previous), Some(digest)) = (&previous, &reusable_digest) {
                    checkpoint("animation-reusing-version")?;
                    animation_install::resume(
                        &job.destination,
                        previous,
                        digest,
                        &ready,
                        create_stage,
                    )?
                } else {
                    false
                };
                if !reused {
                    animation_install::install(
                        &job.destination,
                        previous.as_deref(),
                        worker,
                        &checkpoint,
                        &ready,
                        prepare,
                        create_stage,
                    )?;
                }
            } else {
                animation_export::export_staged(
                    &job.destination,
                    worker,
                    intent.format,
                    &checkpoint,
                    &ready,
                    prepare,
                    create_stage,
                )?;
            }
            published = true;
            observe("animation-published");
            Ok(())
        })();
        let result = self.finish(job, outcome, published);
        let _ = self.recover_animation_stages(Some(&job.id));
        result
    }

    fn prepare_animation(&self, id: &str, digest: &str) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE job SET state='publishing',phase='animation-ready'
             WHERE id=?1 AND state='running' AND operation='animation'",
            [id],
        )? != 1
            || tx.execute(
                "UPDATE animation_intent SET manifest_digest=?2 WHERE job_id=?1",
                params![id, digest],
            )? != 1
        {
            return Err("animation is no longer active".into());
        }
        tx.commit()?;
        Ok(())
    }
}
