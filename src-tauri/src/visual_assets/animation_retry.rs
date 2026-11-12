use super::{
    super::{animation_install, animation_request::AnimationIntent, Result},
    AnimationSubmission, Job, Store,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Retry {
    pub(crate) id: String,
    pub(crate) destination: PathBuf,
    pub(crate) intent: AnimationIntent,
    pub(crate) install_previous: Option<Option<String>>,
    pub(crate) reusable_digest: Option<String>,
}

impl Retry {
    pub(crate) fn check_target(&self, parent: &Path) -> Result<()> {
        if self.destination.parent() != Some(parent) {
            return Err("select the original animation parent directory".into());
        }
        if let Some(previous) = &self.install_previous {
            let name = self
                .destination
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_prefix("zicode-animation-"))
                .ok_or("invalid saved Godot animation name")?;
            let plan = animation_install::plan(parent, name)?;
            if plan.destination != self.destination || &plan.previous != previous {
                return Err("the installed animation changed since the interrupted task".into());
            }
        } else {
            match fs::symlink_metadata(&self.destination) {
                Ok(_) => return Err("the export destination already exists".into()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }
}

impl Store {
    pub(crate) fn retry_animation(&self, id: &str) -> Result<Retry> {
        let current = self
            .latest_for_display()?
            .ok_or("animation task not found")?;
        if current.id != id || current.operation != "animation" || current.state != "interrupted" {
            return Err("animation task is no longer interrupted".into());
        }
        let (intent, is_install, previous, reusable_digest) = self.connect()?.query_row(
            "SELECT animation_intent.intent, animation_install.job_id IS NOT NULL,
              animation_install.previous_version,
              COALESCE(animation_intent.manifest_digest, animation_retry.reusable_digest)
             FROM animation_intent
             LEFT JOIN animation_install ON animation_install.job_id=animation_intent.job_id
             LEFT JOIN animation_retry ON animation_retry.job_id=animation_intent.job_id
             WHERE animation_intent.job_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )?;
        let intent: AnimationIntent = serde_json::from_str(&intent)?;
        intent.recipe_bytes()?;
        Ok(Retry {
            id: current.id,
            destination: current.destination,
            intent,
            install_previous: is_install.then_some(previous),
            reusable_digest,
        })
    }

    pub(crate) fn begin_animation_retry(&self, retry: &Retry) -> Result<Job> {
        self.insert(
            uuid::Uuid::new_v4().to_string(),
            retry.destination.clone(),
            "animation",
            false,
            Some(AnimationSubmission {
                intent: &retry.intent,
                install_previous: retry.install_previous.as_ref().map(Option::as_deref),
                retry: Some(retry),
            }),
        )
    }
}
