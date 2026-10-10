use std::path::{Path, PathBuf};

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Venv,
    Conda,
}

pub struct PythonEnvironment {
    pub root: PathBuf,
    pub paths: Vec<PathBuf>,
    pub executable: PathBuf,
    pub kind: Kind,
}

impl PythonEnvironment {
    pub fn inspect(value: &str) -> Result<Self, String> {
        const ERROR: &str = "project_python_environment_invalid";
        let path = Path::new(value);
        if value.is_empty()
            || value.len() > 4096
            || value.chars().any(char::is_control)
            || !path.is_absolute()
        {
            return Err(ERROR.into());
        }
        let canonical = path.canonicalize().map_err(|_| ERROR)?;
        if !canonical.is_dir() {
            return Err(ERROR.into());
        }
        let venv = present(&canonical.join("pyvenv.cfg"))?;
        let conda = present(&canonical.join("conda-meta"))?;
        if venv == conda {
            return Err(ERROR.into());
        }
        let kind = if conda { Kind::Conda } else { Kind::Venv };
        if conda {
            let metadata = canonical
                .join("conda-meta")
                .canonicalize()
                .map_err(|_| ERROR)?;
            if !metadata.is_dir() || !metadata.starts_with(&canonical) {
                return Err(ERROR.into());
            }
        }
        let config = canonical
            .join(if conda {
                "conda-meta/history"
            } else {
                "pyvenv.cfg"
            })
            .canonicalize()
            .map_err(|_| ERROR)?;
        if !config.starts_with(&canonical) || !config.is_file() {
            return Err(ERROR.into());
        }
        let executable = canonical.join(if cfg!(windows) {
            if conda {
                "python.exe"
            } else {
                "Scripts/python.exe"
            }
        } else {
            "bin/python"
        });
        if !executable.is_file() {
            return Err(ERROR.into());
        }
        let parent = executable
            .parent()
            .ok_or(ERROR)?
            .canonicalize()
            .map_err(|_| ERROR)?;
        if !parent.starts_with(&canonical) {
            return Err(ERROR.into());
        }
        if conda
            && !executable
                .canonicalize()
                .map_err(|_| ERROR)?
                .starts_with(&canonical)
        {
            return Err(ERROR.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if !executable
                .metadata()
                .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
            {
                return Err(ERROR.into());
            }
        }
        let root = crate::process_command::working_directory(&canonical);
        root.to_str().ok_or(ERROR)?;
        let names: &[&str] = if cfg!(windows) {
            if conda {
                &[
                    "",
                    "Library/mingw-w64/bin",
                    "Library/usr/bin",
                    "Library/bin",
                    "Scripts",
                    "bin",
                ]
            } else {
                &["Scripts"]
            }
        } else {
            &["bin"]
        };
        let mut paths = vec![];
        for name in names {
            let path = canonical.join(name);
            if !present(&path)? {
                continue;
            }
            let path = path.canonicalize().map_err(|_| ERROR)?;
            if !path.is_dir() || !path.starts_with(&canonical) {
                return Err(ERROR.into());
            }
            let path = crate::process_command::working_directory(&path);
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        std::env::join_paths(&paths).map_err(|_| ERROR)?;
        // Do not canonicalize the interpreter symlink: venv selection uses its invocation path.
        Ok(Self {
            root,
            paths,
            executable: crate::process_command::working_directory(&executable),
            kind,
        })
    }
}

fn present(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("project_python_environment_invalid".into()),
    }
}
