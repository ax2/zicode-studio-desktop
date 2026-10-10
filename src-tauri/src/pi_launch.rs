use crate::native_pi_manager::NativeLaunchSpec;
use crate::process_command::new_command;
use crate::runtime_coordinator::RuntimeTarget;
use crate::runtime_isolation::prepare_runtime_isolation;
use crate::scene_profiles::resolve_scene_profile;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;

mod extensions;

use extensions::resolve_bundled_extensions;

const PI_VERSION_JSON: &str = include_str!("../../scripts/pi-version.json");

pub fn locked_pi_version() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        let needle = "\"version\"";
        let bytes = PI_VERSION_JSON;
        let start = bytes
            .find(needle)
            .expect("pi-version.json: missing \"version\" key");
        let after_key = &bytes[start + needle.len()..];
        let colon = after_key
            .find(':')
            .expect("pi-version.json: malformed \"version\" entry");
        let after_colon = &after_key[colon + 1..];
        let first_quote = after_colon
            .find('"')
            .expect("pi-version.json: \"version\" value not quoted");
        let rest = &after_colon[first_quote + 1..];
        let end_quote = rest
            .find('"')
            .expect("pi-version.json: unterminated \"version\" value");
        rest[..end_quote].to_string()
    })
}

#[derive(Clone)]
pub struct PiLaunchResolver {
    static_dir: PathBuf,
}

impl PiLaunchResolver {
    pub fn new(static_dir: PathBuf) -> Self {
        Self { static_dir }
    }

    pub fn ensure_bundled_runtime(&self) -> Result<(), String> {
        self.resolve_bundled_pi()?;
        self.resolve_bundled_portable_git()?;
        Ok(())
    }

    pub fn native_launch_spec(
        &self,
        cwd: &str,
        session_path: Option<&str>,
        target: &RuntimeTarget,
    ) -> Result<NativeLaunchSpec, String> {
        let binary = self.resolve_bundled_pi()?;
        let portable_git = self.resolve_bundled_portable_git()?;
        let isolation = prepare_runtime_isolation(target, Path::new(cwd), portable_git.as_deref())?;
        let scene = resolve_scene_profile(&target.scene_id)?;
        let mut environment = isolation.environment;
        environment.insert("PI_DESKTOP_SCENE_NAME".into(), scene.name);
        environment.insert("PI_DESKTOP_SCENE_PROMPT".into(), scene.system_prompt);
        if let Some(allowed_tools) = scene.allowed_tools {
            environment.insert(
                "PI_DESKTOP_ALLOWED_TOOLS".into(),
                serde_json::to_string(&allowed_tools)
                    .map_err(|error| format!("Cannot encode scene tool policy: {error}"))?,
            );
        }
        let extensions =
            resolve_bundled_extensions(&self.static_dir, Path::new(cwd), session_path.is_some())?;
        Ok(NativeLaunchSpec {
            binary,
            cwd: PathBuf::from(strip_verbatim_prefix(cwd)),
            session_path: session_path.map(|path| PathBuf::from(strip_verbatim_prefix(path))),
            extensions,
            pi_version: locked_pi_version().to_owned(),
            path_env: build_augmented_path(portable_git.as_deref(), Some(&isolation.agent_dir)),
            environment,
        })
    }

    /// Run the embedded `pi` CLI with the given arguments and return trimmed stdout.
    /// Blocking; callers on an async runtime should wrap this in `spawn_blocking`.
    pub fn run_pi_command(&self, args: &[&str]) -> Result<String, String> {
        let pi_bin = self.resolve_bundled_pi()?;
        let pi_bin_str = strip_verbatim_prefix(&pi_bin.to_string_lossy());
        let portable_git = self.resolve_bundled_portable_git()?;
        let augmented_path = build_augmented_path(portable_git.as_deref(), None);
        // Pi commands run outside a scene runtime; point their global agent
        // config at `~/.zicode/agent` instead of the default `~/.pi/agent`.
        let pi_agent_dir = crate::app_paths::pi_global_agent_dir()?;
        fs::create_dir_all(&pi_agent_dir)
            .map_err(|error| format!("Cannot create {}: {error}", pi_agent_dir.display()))?;
        crate::app_paths::migrate_legacy_pi_agent()?;
        let mut command = new_command(&pi_bin_str);
        crate::desktop_profile::configure_pi_child(&mut command);
        command
            .args(crate::desktop_profile::pi_discovery_flags())
            .args(args)
            .env("PATH", augmented_path)
            .env("PI_CODING_AGENT_DIR", &pi_agent_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = command.output().map_err(|error| {
            format!("Failed to run embedded pi command ({pi_bin_str} {args:?}): {error}")
        })?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        Err(format!(
            "Embedded pi command failed: {pi_bin_str} {args:?}: {details}"
        ))
    }

    /// Parse `pi list` output into the set of configured package sources
    /// (e.g. `npm:pi-web-access`, `git:…`, or local paths).
    pub fn list_pi_packages(&self) -> Result<Vec<String>, String> {
        let output = self.run_pi_command(&["list"])?;
        let mut sources = Vec::new();
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("No packages installed.") {
                continue;
            }
            // Section headers such as "User packages:" end with a colon.
            if trimmed.ends_with(':') {
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix('-') {
                let value = rest.trim();
                if !value.is_empty() {
                    sources.push(value.to_string());
                }
                continue;
            }
            if trimmed.starts_with("npm:") || trimmed.starts_with("git:") {
                sources.push(trimmed.to_string());
            }
            // Resolved install paths (indented under each source) are ignored:
            // they never match a registry package's `npm:<name>` source.
        }
        Ok(sources)
    }

    pub fn install_pi_package(&self, source: &str) -> Result<(), String> {
        self.run_pi_command(&["install", source]).map(|_| ())
    }

    pub fn remove_pi_package(&self, source: &str) -> Result<(), String> {
        self.run_pi_command(&["remove", source]).map(|_| ())
    }

    fn resolve_bundled_pi(&self) -> Result<PathBuf, String> {
        let bin_name = if cfg!(target_os = "windows") {
            "pi.exe"
        } else {
            "pi"
        };

        if let Ok(explicit) = std::env::var("PI_BIN") {
            let candidate = PathBuf::from(explicit.trim());
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let mut tried = Vec::new();
        if let Some(candidate) = self
            .static_dir
            .parent()
            .map(|parent| parent.join("pi").join(bin_name))
        {
            if candidate.is_file() {
                return Ok(candidate);
            }
            tried.push(candidate);
        }

        if cfg!(debug_assertions) {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pi")
                .join(bin_name);
            if dev_path.is_file() {
                return Ok(dev_path);
            }
            tried.push(dev_path);
        }

        Err(format!(
            "Could not find embedded pi binary. Tried:\n{}\n\n\
             For dev: run `bun run fetch:pi` from the repo root.\n\
             For release: the installed application is missing `pi/{bin_name}` in its resource directory. \
             Reinstall ZiCode Studio Desktop.",
            tried
                .iter()
                .map(|path| format!("  - {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n")
        ))
    }

    fn resolve_bundled_portable_git(&self) -> Result<Option<PathBuf>, String> {
        if !cfg!(target_os = "windows") {
            return Ok(None);
        }

        let candidates = portable_git_candidates(&self.static_dir);
        if let Some(root) = candidates.iter().find(|root| {
            root.join("cmd").join("git.exe").is_file()
                && root.join("bin").join("bash.exe").is_file()
        }) {
            return Ok(Some(root.clone()));
        }

        Err(format!(
            "Could not find bundled PortableGit. Tried:\n{}\n\n\
             Run `bun run fetch:portable-git` from the repository root.",
            candidates
                .iter()
                .map(|path| format!("  - {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n")
        ))
    }
}

pub fn configure_bundled_tool_path(static_dir: &Path) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }
    let root = portable_git_candidates(static_dir)
        .into_iter()
        .find(|root| {
            root.join("cmd").join("git.exe").is_file()
                && root.join("bin").join("bash.exe").is_file()
        })
        .ok_or_else(|| {
            "Bundled PortableGit is missing from the application resources".to_string()
        })?;
    std::env::set_var("PATH", build_augmented_path(Some(&root), None));
    Ok(())
}

fn portable_git_candidates(static_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = static_dir
        .parent()
        .map(|parent| parent.join("portable-git"))
    {
        candidates.push(path);
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("portable-git"),
        );
    }
    candidates
}

fn build_augmented_path(portable_git_root: Option<&Path>, agent_dir: Option<&Path>) -> String {
    let mut dirs = Vec::new();

    if let Some(root) = portable_git_root {
        dirs.extend([
            root.join("cmd"),
            root.join("bin"),
            root.join("usr").join("bin"),
        ]);
    }
    if let Some(agent_dir) = agent_dir {
        dirs.push(agent_dir.join("npm").join("node_modules").join(".bin"));
    }

    let ambient: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for path in ambient {
        if !dirs.iter().any(|existing| existing == &path) {
            dirs.push(path);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut extras = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/local/sbin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ];

        if let Ok(home) = std::env::var("HOME") {
            let home = Path::new(&home);
            extras.push(home.join(".local/bin"));
            extras.push(home.join(".bun/bin"));
            extras.push(home.join(".volta/bin"));
            extras.push(home.join(".cargo/bin"));
            extras.push(home.join(".local/share/mise/shims"));
            let nvm_root = home.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(nvm_root) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.is_dir() {
                        extras.push(bin);
                    }
                }
            }
        }

        for extra in extras {
            if !dirs.iter().any(|dir| dir == &extra) {
                dirs.push(extra);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut extras = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            extras.push(Path::new(&appdata).join("npm"));
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let home = Path::new(&home);
            extras.push(home.join(".cargo").join("bin"));
            extras.push(home.join(".bun").join("bin"));
            extras.push(home.join("scoop").join("shims"));
        }
        for extra in extras {
            if !dirs.iter().any(|dir| dir == &extra) {
                dirs.push(extra);
            }
        }
    }

    std::env::join_paths(dirs)
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppTarget {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub app_name: Option<String>,
    pub command: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_installed_app_names() -> HashSet<String> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    let mut names = HashSet::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || path.extension().and_then(|ext| ext.to_str()) != Some("app") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
                names.insert(stem.to_ascii_lowercase());
            }
        }
    }
    names
}

#[cfg(not(target_os = "macos"))]
fn command_on_path(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path)
        .filter(|directory| directory.is_absolute())
        .any(|directory| {
            let suffixes: &[&str] = if cfg!(windows) {
                &[".exe", ".cmd", ".bat"]
            } else {
                &[""]
            };
            suffixes.iter().any(|suffix| {
                let candidate = directory.join(format!("{name}{suffix}"));
                if !candidate.is_file() {
                    return false;
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    return candidate
                        .metadata()
                        .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0);
                }
                #[cfg(windows)]
                {
                    true
                }
            })
        })
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn linux_opener() -> Option<(&'static str, &'static [&'static str])> {
    if command_on_path("xdg-open") {
        Some(("xdg-open", &[]))
    } else if command_on_path("gio") {
        Some(("gio", &["open"]))
    } else {
        None
    }
}

/// List launch targets ZiCode Studio Desktop can use to open a workspace in an external app.
pub fn list_installed_apps() -> Vec<AppTarget> {
    let candidates: [(&str, &str, &[&str], &str); 6] = [
        ("vscode", "VS Code", &["Visual Studio Code", "Code"], "code"),
        ("cursor", "Cursor", &["Cursor"], "cursor"),
        (
            "webstorm",
            "WebStorm",
            &["WebStorm", "WebStorm EAP"],
            "webstorm",
        ),
        ("zed", "Zed", &["Zed"], "zed"),
        ("terminal", "Terminal", &["Terminal", "iTerm", "Warp"], ""),
        ("ghostty", "Ghostty", &["Ghostty"], ""),
    ];

    #[cfg(target_os = "macos")]
    {
        let installed = macos_installed_app_names();
        let mut targets = Vec::new();
        for (id, label, bundle_names, _command) in candidates {
            if let Some(app_name) = bundle_names
                .iter()
                .find(|name| installed.contains(&name.to_ascii_lowercase()))
            {
                targets.push(AppTarget {
                    id: id.to_string(),
                    label: label.to_string(),
                    kind: "app".to_string(),
                    app_name: Some((*app_name).to_string()),
                    command: None,
                });
            }
        }
        targets.push(AppTarget {
            id: "finder".to_string(),
            label: "Finder".to_string(),
            kind: "finder".to_string(),
            app_name: None,
            command: None,
        });
        targets
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut targets: Vec<AppTarget> = candidates
            .iter()
            .filter(|(_, _, _, command)| !command.is_empty() && command_on_path(command))
            .map(|(id, label, _, command)| AppTarget {
                id: id.to_string(),
                label: label.to_string(),
                kind: "command".to_string(),
                app_name: None,
                command: Some(command.to_string()),
            })
            .collect();
        if file_manager_opener_available() {
            targets.push(AppTarget {
                id: "finder".to_string(),
                label: "File Manager".to_string(),
                kind: "finder".to_string(),
                app_name: None,
                command: None,
            });
        }
        targets
    }
}

#[cfg(not(target_os = "macos"))]
fn file_manager_opener_available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(windows))]
    {
        linux_opener().is_some()
    }
}

/// Open an existing project entry in an external app (editor / terminal / file manager). Blocking.
pub fn open_in_app(
    path: &Path,
    app_name: Option<&str>,
    command: Option<&str>,
) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Missing path".to_string());
    }
    let launch_path = crate::process_command::working_directory(path);

    if let Some(command) = command.map(str::trim).filter(|command| !command.is_empty()) {
        let status = new_command(command)
            .arg(&launch_path)
            .status()
            .map_err(|error| format!("Failed to launch `{command}`: {error}"))?;
        if !status.success() {
            return Err(format!("`{command}` exited with status {status}"));
        }
        return Ok(());
    }

    if let Some(app_name) = app_name
        .map(str::trim)
        .filter(|app_name| !app_name.is_empty())
    {
        #[cfg(target_os = "macos")]
        let status = new_command("open")
            .arg("-a")
            .arg(app_name)
            .arg(&launch_path)
            .status();
        #[cfg(not(target_os = "macos"))]
        let status = new_command(app_name).arg(&launch_path).status();

        let status = status.map_err(|error| format!("Failed to open `{app_name}`: {error}"))?;
        if !status.success() {
            return Err(format!("`{app_name}` failed to open (status {status})"));
        }
        return Ok(());
    }

    open_path(&launch_path)
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = new_command("open").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = {
        let mut command = new_command("explorer");
        command.arg(path).status()
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = linux_opener()
        .ok_or_else(|| "No supported file manager opener is installed".to_string())
        .and_then(|(program, args)| {
            new_command(program)
                .args(args)
                .arg(path)
                .status()
                .map_err(|error| format!("Failed to reveal path: {error}"))
        });

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let status = status.map_err(|error| format!("Failed to reveal path: {error}"));
    match status? {
        code if code.success() => Ok(()),
        code => Err(format!("File manager exited with status {code}")),
    }
}

/// Open a URL in the user's default browser via the OS opener. Blocking.
pub fn open_external(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Missing URL".to_string());
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "Invalid external URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto")
        || (parsed.scheme() != "mailto" && parsed.host_str().is_none())
    {
        return Err("Unsupported external URL".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = new_command("open").arg(parsed.as_str()).status();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let operation: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let target: Vec<u16> = std::ffi::OsStr::new(parsed.as_str())
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if (result as isize) > 32 {
            Ok(())
        } else {
            Err("Failed to open external URL".to_string())
        }
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = linux_opener()
        .ok_or_else(|| "No supported URL opener is installed".to_string())
        .and_then(|(program, args)| {
            new_command(program)
                .args(args)
                .arg(parsed.as_str())
                .status()
                .map_err(|error| format!("Failed to open URL: {error}"))
        });

    #[cfg(not(target_os = "windows"))]
    #[cfg(target_os = "macos")]
    let status = status.map_err(|error| format!("Failed to open URL: {error}"));
    #[cfg(not(target_os = "windows"))]
    match status? {
        code if code.success() => Ok(()),
        code => Err(format!("Opener exited with status {code}")),
    }
}

fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}
