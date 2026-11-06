//! Keep an installed local build independent of in-progress frontend edits.
use std::{
    fs,
    path::{Path, PathBuf},
};

fn canonical_public(dir: PathBuf) -> Option<PathBuf> {
    dir.join("index.html")
        .is_file()
        .then(|| fs::canonicalize(&dir).unwrap_or(dir))
}

fn is_development_executable(
    executable: Option<&Path>,
    build_directory: &Path,
    debug: bool,
) -> bool {
    if !debug {
        return false;
    }
    let actual = executable
        .and_then(Path::parent)
        .and_then(|dir| fs::canonicalize(dir).ok());
    let built = fs::canonicalize(build_directory).ok();
    actual.is_some() && actual == built
}

fn resolve_public_dir(
    resource_dir: Option<PathBuf>,
    workspace_public: PathBuf,
    current_dir: Option<PathBuf>,
    development: bool,
) -> PathBuf {
    if development {
        if let Some(dir) = canonical_public(workspace_public) {
            return dir;
        }
        let current_public = current_dir.unwrap_or_default().join("public");
        return canonical_public(current_public.clone()).unwrap_or(current_public);
    }
    // Missing installed resources must never redirect to a developer's checkout.
    let bundled = resource_dir
        .map(|dir| dir.join("public"))
        .unwrap_or_else(|| PathBuf::from("public"));
    canonical_public(bundled.clone()).unwrap_or(bundled)
}

pub fn public_dir(resource_dir: Option<PathBuf>) -> PathBuf {
    // Cargo OUT_DIR is <profile>/build/<package-hash>/out, including custom
    // target directories and target triples. Only that build's executable
    // directory gets live source files; a relocated debug executable is installed.
    let build_directory = Path::new(env!("OUT_DIR"))
        .ancestors()
        .nth(3)
        .expect("Cargo build directory");
    let executable = std::env::current_exe().ok();
    resolve_public_dir(
        resource_dir,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public"),
        std::env::current_dir().ok(),
        is_development_executable(
            executable.as_deref(),
            build_directory,
            cfg!(debug_assertions),
        ),
    )
}

pub fn validate(public: &Path) -> Result<(), String> {
    if public.join("index.html").is_file() {
        return Ok(());
    }
    Err(format!("Studio interface files are missing at {}. Restore the public directory beside the installed runtime or reinstall Studio.", public.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> std::io::Result<Self> {
            let directory = std::env::temp_dir()
                .join(format!("studio-runtime-assets-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&directory)?;
            Ok(Self(directory))
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            if self.0.starts_with(std::env::temp_dir())
                && self.0.file_name().is_some_and(|name| {
                    name.to_string_lossy().starts_with("studio-runtime-assets-")
                })
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    fn page(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name).join("public");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), name).unwrap();
        dir
    }

    #[test]
    fn development_prefers_live_source_over_a_stale_bundle() {
        let root = TempDir::new().unwrap();
        let source = page(root.path(), "workspace");
        page(root.path(), "bundled");
        assert_eq!(
            resolve_public_dir(
                Some(root.path().join("bundled")),
                source.clone(),
                None,
                true
            ),
            fs::canonicalize(source).unwrap()
        );
    }

    #[test]
    fn relocated_debug_uses_installed_assets_even_with_source_working_directory() {
        let root = TempDir::new().unwrap();
        let source = page(root.path(), "workspace");
        let installed = page(root.path(), "installed");
        let build = root
            .path()
            .join("custom-target")
            .join("x86_64-pc-windows-msvc")
            .join("debug");
        fs::create_dir_all(&build).unwrap();
        let executable = root.path().join("installed/studio.exe");
        assert!(!is_development_executable(Some(&executable), &build, true));
        assert_eq!(
            resolve_public_dir(
                Some(root.path().join("installed")),
                source,
                Some(root.path().join("workspace")),
                false
            ),
            fs::canonicalize(installed).unwrap()
        );
    }

    #[test]
    fn missing_installed_assets_do_not_fall_back_to_source_or_working_directory() {
        let root = TempDir::new().unwrap();
        let source = page(root.path(), "workspace");
        let expected = root.path().join("installed/public");
        let resolved = resolve_public_dir(
            Some(root.path().join("installed")),
            source,
            Some(root.path().join("workspace")),
            false,
        );
        assert_eq!(resolved, expected);
        assert!(validate(&resolved)
            .unwrap_err()
            .contains("interface files are missing"));
    }

    #[test]
    fn only_the_actual_debug_build_directory_gets_live_source() {
        let root = TempDir::new().unwrap();
        let build = root.path().join("custom-target/debug");
        fs::create_dir_all(&build).unwrap();
        let executable = build.join("studio.exe");
        assert!(is_development_executable(Some(&executable), &build, true));
        assert!(!is_development_executable(Some(&executable), &build, false));
        assert!(!is_development_executable(None, &build, true));
        assert!(!is_development_executable(
            Some(&executable),
            &root.path().join("absent"),
            true
        ));
    }

    #[test]
    fn development_retains_working_directory_fallback() {
        let root = TempDir::new().unwrap();
        let current = page(root.path(), "current");
        assert_eq!(
            resolve_public_dir(
                None,
                root.path().join("absent"),
                Some(root.path().join("current")),
                true
            ),
            fs::canonicalize(current).unwrap()
        );
    }
}
