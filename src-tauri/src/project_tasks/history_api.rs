use super::{history, Inner, Run, TaskRunner};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHistory {
    pub runs: Vec<Run>,
    pub history_status: &'static str,
}

impl TaskRunner {
    pub fn for_host(static_dir: &Path) -> Self {
        #[cfg(test)]
        let root = Ok::<_, String>(static_dir.parent().unwrap_or(static_dir).to_path_buf());
        #[cfg(not(test))]
        let root = {
            let _ = static_dir;
            crate::app_paths::data_root()
        };
        match root {
            Ok(root) => Self::with_history(&root.join("project-run-history.sqlite3")),
            Err(_) => Self(
                Arc::new(Mutex::new(Inner {
                    history: history::History::unavailable(),
                    ..Inner::default()
                })),
                Default::default(),
            ),
        }
    }

    pub fn with_history(path: &Path) -> Self {
        Self(
            Arc::new(Mutex::new(Inner {
                history: history::History::open(path),
                ..Inner::default()
            })),
            Default::default(),
        )
    }

    pub fn run_history(&self, root: &Path, workspace: &str) -> RunHistory {
        let scope = history::scope(root, workspace);
        let mut inner = self.0.lock().expect("task runner poisoned");
        let mut runs = inner.history.list(&scope);
        for (index, record) in inner
            .records
            .iter()
            .rev()
            .filter(|r| r.scope == scope)
            .enumerate()
        {
            runs.retain(|r| r.id != record.run.id);
            runs.push(record.snapshot(index == 0));
        }
        // Keep the current host's active task visible and stoppable even when another
        // host has written a newer entry to the shared store.
        runs.sort_by(|a, b| {
            (!b.historical && b.finished_at.is_none())
                .cmp(&(!a.historical && a.finished_at.is_none()))
                .then_with(|| b.started_at.cmp(&a.started_at))
                .then_with(|| b.id.cmp(&a.id))
        });
        runs.truncate(40);
        RunHistory {
            runs,
            history_status: inner.history.status(),
        }
    }

    pub fn clear_history(&self, root: &Path, workspace: &str) -> Result<(), String> {
        let scope = history::scope(root, workspace);
        let mut inner = self.0.lock().expect("task runner poisoned");
        let active: Vec<Run> = inner
            .records
            .iter()
            .filter(|r| r.scope == scope && r.run.finished_at.is_none())
            .map(|r| r.run.clone())
            .collect();
        inner.history.clear(&scope, &active)?;
        inner
            .records
            .retain(|r| r.scope != scope || r.run.finished_at.is_none());
        Ok(())
    }

    pub fn completion_tracker(&self) -> tokio_util::task::TaskTracker {
        self.1.clone()
    }
}
