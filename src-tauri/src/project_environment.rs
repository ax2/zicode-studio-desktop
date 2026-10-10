//! Machine-local, revisioned tool search paths; never mutate the Host environment.
mod conda_registry;
mod python;
mod python_process;
pub(crate) mod python_runtime;
mod store;
pub use conda_registry::discover_conda;
pub use python::PythonEnvironment;
#[cfg(test)]
mod tests;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
pub use store::Store;

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub revision: u64,
    pub directories: Vec<String>,
    #[serde(default)]
    pub python_environment: Option<String>,
}

#[derive(Default)]
pub struct Environment {
    pub settings: Settings,
    directories: Vec<PathBuf>,
    python: Option<PythonEnvironment>,
}

pub fn validate(directories: &[String]) -> Result<Vec<PathBuf>, String> {
    if directories.len() > 8 {
        return Err("project_environment_invalid".into());
    }
    let mut result = vec![];
    for value in directories {
        let path = Path::new(value);
        if value.is_empty()
            || value.len() > 4096
            || value.chars().any(char::is_control)
            || !path.is_absolute()
            || !path.is_dir()
        {
            return Err("project_environment_invalid".into());
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| "project_environment_invalid")?;
        let directory = crate::process_command::working_directory(&canonical);
        directory.to_str().ok_or("project_environment_invalid")?;
        if !result.contains(&directory) {
            result.push(directory);
        }
    }
    std::env::join_paths(&result).map_err(|_| "project_environment_invalid")?;
    Ok(result)
}

impl Environment {
    pub fn new(settings: Settings) -> Result<Self, String> {
        let directories = validate(&settings.directories)?;
        let python = settings
            .python_environment
            .as_deref()
            .map(PythonEnvironment::inspect)
            .transpose()?;
        Ok(Self {
            settings,
            directories,
            python,
        })
    }
    pub fn path(&self) -> Result<OsString, String> {
        self.path_with_python(true)
    }
    pub fn tool_path(&self) -> Result<OsString, String> {
        self.path_with_python(false)
    }
    fn path_with_python(&self, include_python: bool) -> Result<OsString, String> {
        let ambient_roots = python_process::ambient_roots();
        let mut paths: Vec<_> = if include_python {
            self.python
                .iter()
                .flat_map(|python| python.paths.iter().cloned())
                .collect()
        } else {
            vec![]
        };
        paths.extend(self.directories.iter().cloned());
        if let Some(path) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&path).filter(|entry| {
                entry.is_absolute()
                    && !python_process::is_ambient_path(entry, &ambient_roots)
                    && (include_python || !self.is_selected_python_path(entry))
            }));
        }
        std::env::join_paths(paths).map_err(|_| "project_environment_invalid".into())
    }
    fn is_selected_python_path(&self, path: &Path) -> bool {
        let normalized = path
            .canonicalize()
            .map(|canonical| crate::process_command::working_directory(&canonical))
            .unwrap_or_else(|_| path.to_path_buf());
        self.selected_python_paths().contains(&normalized)
    }
    pub fn selected_python_paths(&self) -> &[PathBuf] {
        self.python
            .as_ref()
            .map_or(&[], |python| python.paths.as_slice())
    }
    pub fn configure(&self, command: &mut std::process::Command) -> Result<(), String> {
        if !self.directories.is_empty()
            || self.python.is_some()
            || !python_process::ambient_roots().is_empty()
        {
            command.env("PATH", self.path()?);
        }
        if let Some(python) = &self.python {
            python_process::configure(command, &python.root, python.kind);
        } else {
            python_process::clear(command);
        }
        Ok(())
    }
    pub fn configure_python_manager(
        &self,
        command: &mut std::process::Command,
    ) -> Result<(), String> {
        // Poetry and uv resolve their own project environments; keep configured
        // tool directories but do not activate the separately selected Python.
        if !self.directories.is_empty()
            || self.python.is_some()
            || !python_process::ambient_roots().is_empty()
        {
            command.env("PATH", self.tool_path()?);
        }
        python_process::clear(command);
        Ok(())
    }
    pub fn python(&self) -> Option<&PythonEnvironment> {
        self.python.as_ref()
    }
    pub fn configure_terminal_in(
        &self,
        command: &mut portable_pty::CommandBuilder,
        directory: &Path,
        workspace_root: &Path,
    ) -> Result<Option<String>, String> {
        python_process::clear_terminal(command);
        let ambient_roots = python_process::ambient_roots();
        let local = if self.python.is_none() {
            python_runtime::project_environment(directory, workspace_root)?
        } else {
            None
        };
        let mut paths: Vec<_> = local
            .iter()
            .flat_map(|python| python.paths.iter().cloned())
            .chain(
                self.python
                    .iter()
                    .flat_map(|python| python.paths.iter().cloned()),
            )
            .chain(self.directories.iter().cloned())
            .collect();
        if let Some(path) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&path).filter(|path| {
                path.is_absolute() && !python_process::is_ambient_path(path, &ambient_roots)
            }));
        }
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|_| "project_environment_invalid")?,
        );
        if let Some(python) = &self.python {
            python_process::configure_terminal(command, &python.root, python.kind);
            return Ok(Some(python.root.to_string_lossy().into_owned()));
        }
        if let Some(python) = local {
            if let (Some(root), Some(kind)) = (python.environment, python.kind) {
                python_process::configure_terminal(command, &root, kind);
                return Ok(Some(root.to_string_lossy().into_owned()));
            }
        }
        Ok(None)
    }
    pub fn selected(&self, names: &[&str]) -> Option<PathBuf> {
        if names
            .iter()
            .any(|name| ["python", "python3"].contains(name))
        {
            if let Some(python) = &self.python {
                return Some(python.executable.clone());
            }
        }
        // Directory order takes priority over spelling alternatives (python/python3).
        for directory in self
            .python
            .iter()
            .flat_map(|p| &p.paths)
            .chain(self.directories.iter())
        {
            for name in names {
                let suffixes: &[&str] = if cfg!(windows) {
                    &[".exe", ".cmd", ".bat"]
                } else {
                    &[""]
                };
                for suffix in suffixes {
                    let candidate = directory.join(format!("{name}{suffix}"));
                    if !candidate.is_file() {
                        continue;
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if !candidate
                            .metadata()
                            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
                        {
                            continue;
                        }
                    }
                    // Keep invocation names for rustup and virtual-environment shims.
                    return Some(candidate);
                }
            }
        }
        None
    }
    pub fn selected_tool(&self, names: &[&str]) -> Option<PathBuf> {
        for directory in &self.directories {
            for name in names {
                let suffixes: &[&str] = if cfg!(windows) {
                    &[".exe", ".cmd", ".bat"]
                } else {
                    &[""]
                };
                for suffix in suffixes {
                    let candidate = directory.join(format!("{name}{suffix}"));
                    if !candidate.is_file() {
                        continue;
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if !candidate
                            .metadata()
                            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
                        {
                            continue;
                        }
                    }
                    return Some(candidate);
                }
            }
        }
        None
    }
    pub fn fingerprint(&self) -> String {
        serde_json::to_string(&(
            &self.settings,
            self.python
                .as_ref()
                .map(|python| (&python.root, &python.executable, &python.paths, python.kind)),
        ))
        .expect("serializable environment")
    }
}
