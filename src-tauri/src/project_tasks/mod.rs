//! Explicit project script execution; the host owns every process and its bounded output.
pub mod catalog;
mod cmake_presets;
mod cmake_tasks;
mod composer_tasks;
#[cfg(test)]
mod contract_tests;
mod deno_tasks;
pub(crate) mod directories;
#[cfg(test)]
mod directory_tests;
pub(crate) mod dotnet_tasks;
pub(crate) mod go_work;
mod history;
mod history_api;
pub(crate) mod java_tasks;
mod make_tasks;
#[cfg(test)]
mod multilanguage_tests;
pub(crate) mod package_manager;
mod pnpm_workspace;
mod poetry_tasks;
pub(crate) mod process_tree;
pub mod protocol;
mod python_tasks;
#[cfg(test)]
mod python_tests;
mod ruby_tasks;
#[cfg(test)]
mod tests;
mod uv_tasks;
pub(crate) mod workspace_declarations;
mod workspace_patterns;

use serde::Serialize;
use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::oneshot;

const OUTPUT_LIMIT: usize = 64 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub workspace_id: String,
    pub directory: String,
    pub name: String,
    pub manager: String,
    pub command: String,
    pub invocation: String,
    pub executable: String,
    pub status: String,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub fingerprint: String,
    pub historical: bool,
}

struct Record {
    scope: String,
    run: Run,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    cancel: Option<oneshot::Sender<()>>,
    tree: Arc<process_tree::ProcessTree>,
}

impl Record {
    fn snapshot(&self, include_output: bool) -> Run {
        let mut run = self.run.clone();
        if include_output {
            run.stdout = String::from_utf8_lossy(&self.stdout).into_owned();
            run.stderr = String::from_utf8_lossy(&self.stderr).into_owned();
        }
        run
    }
}

#[derive(Default)]
struct Inner {
    records: VecDeque<Record>,
    closed: bool,
    history: history::History,
}

#[derive(Default)]
pub struct TaskRunner(Arc<Mutex<Inner>>, tokio_util::task::TaskTracker);

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl TaskRunner {
    #[cfg(test)]
    pub fn list(&self, workspace: &str) -> Vec<Run> {
        self.0
            .lock()
            .expect("task runner poisoned")
            .records
            .iter()
            .rev()
            .filter(|record| record.run.workspace_id == workspace)
            .enumerate()
            .map(|(index, record)| record.snapshot(index == 0))
            .collect()
    }

    #[cfg(test)]
    pub fn start(
        &self,
        root: &Path,
        workspace: &str,
        name: &str,
        fingerprint: &str,
    ) -> Result<Run, String> {
        self.start_in(root, workspace, "", name, fingerprint)
    }

    #[cfg(test)]
    pub fn start_in(
        &self,
        workspace_root: &Path,
        workspace: &str,
        directory: &str,
        name: &str,
        fingerprint: &str,
    ) -> Result<Run, String> {
        self.start_with_environment(
            workspace_root,
            workspace,
            directory,
            name,
            fingerprint,
            &Default::default(),
        )
    }

    pub fn start_with_environment(
        &self,
        workspace_root: &Path,
        workspace: &str,
        directory: &str,
        name: &str,
        fingerprint: &str,
        environment: &crate::project_environment::Environment,
    ) -> Result<Run, String> {
        let resolved = directories::resolve(workspace_root, directory)?;
        let root = resolved.as_path();
        let catalog = catalog::read_with_environment(root, workspace_root, environment)?;
        if catalog.fingerprint != fingerprint {
            return Err("task_catalog_changed".into());
        }
        let task = catalog
            .tasks
            .iter()
            .find(|task| {
                task.id == name
                    || (task.source == "package.json"
                        && task.name == name
                        && catalog::valid_name(name))
            })
            .ok_or("task_not_runnable")?;
        if !task.runnable {
            return Err(task
                .unavailable_reason
                .clone()
                .unwrap_or_else(|| "task_not_runnable".into()));
        }
        if task.source == "CMakeLists.txt" {
            cmake_tasks::validate_build_directory(root)?;
        }
        let python = if task.manager == "python" {
            Some(python_tasks::resolve_environment(
                root,
                workspace_root,
                environment,
            )?)
        } else {
            None
        };
        let executable = if let Some(interpreter) = &python {
            if task.interpreter.as_deref()
                != Some(interpreter.executable.to_string_lossy().as_ref())
            {
                return Err("task_catalog_changed".into());
            }
            interpreter.executable.clone()
        } else if task.manager == "mvn" || task.manager == "gradle" {
            java_tasks::executable(root, workspace_root, &task.manager, environment)?
        } else if task.manager == "poetry" || task.manager == "uv" {
            environment
                .selected_tool(&[&task.manager])
                .map(Ok)
                .unwrap_or_else(|| {
                    environment.tool_path().and_then(|path| {
                        catalog::executable_on_path_excluding(
                            workspace_root,
                            &task.manager,
                            environment.selected_python_paths(),
                            &path,
                        )
                    })
                })?
        } else {
            environment
                .selected(&[&task.manager])
                .map(Ok)
                .unwrap_or_else(|| {
                    environment.path().and_then(|path| {
                        catalog::executable_on_path(workspace_root, &task.manager, &path)
                    })
                })?
        };
        let mut command = catalog::task_command(&executable, task)?;
        if task.manager == "poetry" || task.manager == "uv" {
            environment.configure_python_manager(&mut command)?;
        } else {
            environment.configure(&mut command)?;
        }
        if task.manager == "uv" {
            command.env_remove("UV_PROJECT_ENVIRONMENT");
            command.env_remove("UV_WORKING_DIR");
        }
        if task.manager == "bundle" {
            ruby_tasks::configure(&mut command, root);
        }
        if task.manager == "composer" {
            composer_tasks::configure(&mut command, root);
        }
        if let Some(interpreter) = &python {
            python_tasks::configure(&mut command, interpreter)?;
        }
        command
            .current_dir(crate::process_command::working_directory(root))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        process_tree::prepare(&mut command);
        let mut inner = self.0.lock().expect("task runner poisoned");
        if inner.closed {
            return Err("task_runner_closed".into());
        }
        if inner
            .records
            .iter()
            .any(|record| record.run.workspace_id == workspace && record.run.finished_at.is_none())
        {
            return Err("task_project_busy".into());
        }
        if inner
            .records
            .iter()
            .filter(|record| record.run.finished_at.is_none())
            .count()
            >= 4
        {
            return Err("task_limit_reached".into());
        }
        let mut child = tokio::process::Command::from(command)
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| "task_spawn_failed")?;
        let tree = match process_tree::ProcessTree::attach(&child) {
            Ok(tree) => Arc::new(tree),
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (cancel, cancelled) = oneshot::channel();
        let run = Run {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace.into(),
            directory: directory.into(),
            name: task.name.clone(),
            manager: task.manager.clone(),
            command: task.command.clone(),
            invocation: format!("{} {}", task.manager, task.arguments.join(" ")),
            executable: executable.to_string_lossy().into_owned(),
            status: "running".into(),
            started_at: now(),
            finished_at: None,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
            fingerprint: catalog.fingerprint.clone(),
            historical: false,
        };
        let scope = history::scope(workspace_root, workspace);
        while inner.records.len() >= 40 {
            if let Some(index) = inner
                .records
                .iter()
                .position(|record| record.run.finished_at.is_some())
            {
                inner.records.remove(index);
            } else {
                break;
            }
        }
        inner.records.push_back(Record {
            scope: scope.clone(),
            run: run.clone(),
            stdout: vec![],
            stderr: vec![],
            cancel: Some(cancel),
            tree: tree.clone(),
        });
        inner.history.save(&scope, &run);
        let state = self.0.clone();
        let id = run.id.clone();
        self.1.spawn(async move {
            let out = tokio::spawn(capture(stdout, state.clone(), id.clone(), false));
            let err = tokio::spawn(capture(stderr, state.clone(), id.clone(), true));
            let (result, was_cancelled) = tokio::select! {
                result = child.wait() => (result, false),
                _ = cancelled => { tree.terminate(); (child.wait().await, true) },
            };
            tree.terminate();
            let mut output_incomplete = false;
            for mut reader in [out, err] {
                match tokio::time::timeout(std::time::Duration::from_secs(1), &mut reader).await {
                    Ok(Ok(true)) => {}
                    Ok(Ok(false) | Err(_)) => output_incomplete = true,
                    Err(_) => {
                        reader.abort();
                        let _ = reader.await;
                        output_incomplete = true;
                    }
                }
            }
            let mut inner = state.lock().expect("task runner poisoned");
            let completed =
                if let Some(record) = inner.records.iter_mut().find(|record| record.run.id == id) {
                    record.run.truncated |= output_incomplete;
                    let stopped = was_cancelled || record.run.status == "stopping";
                    record.run.status = if stopped {
                        "cancelled"
                    } else if result.as_ref().is_ok_and(|status| status.success()) {
                        "succeeded"
                    } else {
                        "failed"
                    }
                    .into();
                    record.run.exit_code = result.ok().and_then(|status| status.code());
                    record.run.finished_at = Some(now());
                    record.cancel = None;
                    Some((record.scope.clone(), record.run.clone()))
                } else {
                    None
                };
            if let Some((scope, run)) = completed {
                inner.history.save(&scope, &run);
            }
        });
        Ok(run)
    }

    pub fn stop(&self, workspace: &str, id: &str) -> Result<Run, String> {
        let mut inner = self.0.lock().expect("task runner poisoned");
        let record = inner
            .records
            .iter_mut()
            .find(|record| record.run.id == id && record.run.workspace_id == workspace)
            .ok_or("task_run_not_found")?;
        if let Some(cancel) = record.cancel.take() {
            record.run.status = "stopping".into();
            record.tree.terminate();
            let _ = cancel.send(());
        }
        Ok(record.snapshot(true))
    }

    pub fn stop_all(&self) {
        let mut inner = self.0.lock().expect("task runner poisoned");
        inner.closed = true;
        self.1.close();
        for record in &mut inner.records {
            if let Some(cancel) = record.cancel.take() {
                record.run.status = "stopping".into();
                record.tree.terminate();
                let _ = cancel.send(());
            }
        }
    }
}

impl Drop for TaskRunner {
    fn drop(&mut self) {
        self.stop_all();
    }
}

async fn capture<R: AsyncRead + Unpin>(
    reader: Option<R>,
    state: Arc<Mutex<Inner>>,
    id: String,
    stderr: bool,
) -> bool {
    let Some(mut reader) = reader else {
        return false;
    };
    let mut chunk = [0; 8192];
    loop {
        let length = match reader.read(&mut chunk).await {
            Ok(0) => return true,
            Ok(length) => length,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return false,
        };
        let mut inner = state.lock().expect("task runner poisoned");
        let Some(record) = inner.records.iter_mut().find(|record| record.run.id == id) else {
            return false;
        };
        let output = if stderr {
            &mut record.stderr
        } else {
            &mut record.stdout
        };
        output.extend_from_slice(&chunk[..length]);
        if output.len() > OUTPUT_LIMIT {
            output.drain(..output.len() - OUTPUT_LIMIT);
            record.run.truncated = true;
        }
    }
}
