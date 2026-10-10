use super::{catalog, python_tasks, tests::Fixture, TaskRunner};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn fake_executable(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "not executed").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn fake_environment(root: &Path) -> PathBuf {
    let environment = root.join(".venv");
    let executable = environment.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    fake_executable(&executable);
    std::fs::write(environment.join("pyvenv.cfg"), "home = fixture\n").unwrap();
    executable
}

#[test]
fn project_venv_precedes_selected_python_and_preserves_other_tool_directories() {
    let project = Fixture::new();
    let tools = Fixture::new();
    let custom = tools.0.join(if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    });
    fake_executable(&custom);
    let environment =
        crate::project_environment::Environment::new(crate::project_environment::Settings {
            revision: 1,
            directories: vec![tools.0.to_string_lossy().into_owned()],
            python_environment: None,
        })
        .unwrap();
    let fallback = python_tasks::resolve_environment(&project.0, &project.0, &environment).unwrap();
    assert_eq!(
        fallback.executable.canonicalize().unwrap(),
        custom.canonicalize().unwrap()
    );
    let local = fake_environment(&project.0);
    let selected = python_tasks::resolve_environment(&project.0, &project.0, &environment).unwrap();
    assert_eq!(selected.executable.canonicalize().unwrap(), local.canonicalize().unwrap());
    let mut command = crate::process_command::new_command(&selected.executable);
    environment.configure(&mut command).unwrap();
    python_tasks::configure(&mut command, &selected).unwrap();
    let path = command
        .get_envs()
        .find(|(key, _)| *key == "PATH")
        .unwrap()
        .1
        .unwrap();
    let directories: Vec<_> = std::env::split_paths(path).collect();
    assert_eq!(directories[0].canonicalize().unwrap(), local.parent().unwrap().canonicalize().unwrap());
    assert_eq!(directories[1].canonicalize().unwrap(), tools.0);
    std::fs::remove_file(local).unwrap();
    assert!(python_tasks::resolve_environment(&project.0, &project.0, &environment).is_err());
}

#[test]
fn prefers_project_environment_and_configures_child_tool_paths() {
    let project = Fixture::new();
    let host = Fixture::new();
    let executable = fake_environment(&project.0);
    fake_executable(&host.0.join(if cfg!(windows) {
        "python.exe"
    } else {
        "python3"
    }));
    let path = std::env::join_paths([&host.0]).unwrap();
    let selected = python_tasks::resolve_with_path(&project.0, Some(&path)).unwrap();
    assert_eq!(selected.executable.canonicalize().unwrap(), executable.canonicalize().unwrap());
    let mut command = crate::process_command::new_command(&selected.executable);
    python_tasks::configure(&mut command, &selected).unwrap();
    let variables: std::collections::HashMap<_, _> = command.get_envs().collect();
    assert_eq!(
        variables[std::ffi::OsStr::new("VIRTUAL_ENV")],
        selected.environment.as_deref().map(Path::as_os_str)
    );
    assert_eq!(variables[std::ffi::OsStr::new("PYTHONHOME")], None);
    assert_eq!(
        variables[std::ffi::OsStr::new("PYTHONIOENCODING")],
        Some(std::ffi::OsStr::new("utf-8"))
    );
    assert_eq!(
        variables[std::ffi::OsStr::new("PYTHONUNBUFFERED")],
        Some(std::ffi::OsStr::new("1"))
    );
    assert_eq!(
        std::env::split_paths(variables[std::ffi::OsStr::new("PATH")].unwrap())
            .next()
            .unwrap().canonicalize().unwrap(),
        executable.parent().unwrap().canonicalize().unwrap()
    );
}

#[test]
fn broken_environment_disables_commands_instead_of_falling_back() {
    let project = Fixture::new();
    std::fs::create_dir(project.0.join(".venv")).unwrap();
    std::fs::write(
        project.0.join("pyproject.toml"),
        "[project]\nname='fixture'\n",
    )
    .unwrap();
    std::fs::write(project.0.join("requirements.txt"), "").unwrap();
    let broken = catalog::read(&project.0).unwrap();
    assert_eq!(broken.tasks.len(), 3);
    assert!(broken.tasks.iter().all(|task| !task.runnable
        && task.unavailable_reason.as_deref() == Some("task_python_environment_invalid")));
    assert_eq!(
        TaskRunner::default()
            .start(&project.0, "p", "@python/unittest", &broken.fingerprint)
            .err()
            .unwrap(),
        "task_python_environment_invalid"
    );
    fake_environment(&project.0);
    let repaired = catalog::read(&project.0).unwrap();
    assert_ne!(broken.fingerprint, repaired.fingerprint);
    assert!(repaired.tasks.iter().all(|task| task.runnable));
    let unit = repaired
        .tasks
        .iter()
        .find(|task| task.id == "@python/unittest")
        .unwrap();
    assert_eq!(unit.arguments, ["-m", "unittest", "discover"]);
    assert_eq!(unit.source, "pyproject.toml, requirements.txt");
    assert_eq!(
        TaskRunner::default()
            .start(&project.0, "p", "@python/unittest", &broken.fingerprint)
            .err()
            .unwrap(),
        "task_catalog_changed"
    );
}

#[test]
fn host_lookup_skips_relative_and_project_paths() {
    let project = Fixture::new();
    let host = Fixture::new();
    let name = if cfg!(windows) {
        "python.exe"
    } else {
        "python3"
    };
    fake_executable(&project.0.join(name));
    fake_executable(&host.0.join(name));
    let path = std::env::join_paths([Path::new("."), &project.0, &host.0]).unwrap();
    let selected = python_tasks::resolve_with_path(&project.0, Some(&path)).unwrap();
    assert_eq!(selected.executable, host.0.join(name));
    assert!(selected.environment.is_none());
    assert_eq!(
        python_tasks::resolve_with_path(&project.0, None)
            .err()
            .unwrap(),
        "task_python_missing"
    );
}

#[cfg(windows)]
#[test]
fn ignores_windows_store_aliases() {
    let project = Fixture::new();
    let host = Fixture::new();
    let aliases = host.0.join("WindowsApps");
    fake_executable(&aliases.join("python.exe"));
    let path = std::env::join_paths([aliases]).unwrap();
    assert_eq!(
        python_tasks::resolve_with_path(&project.0, Some(&path))
            .err()
            .unwrap(),
        "task_python_missing"
    );
}

#[cfg(unix)]
#[test]
fn preserves_interpreter_symlinks_but_rejects_external_environment_directories() {
    use std::os::unix::fs::symlink;
    let project = Fixture::new();
    let host = Fixture::new();
    let target = host.0.join("python3");
    fake_executable(&target);
    let executable = fake_environment(&project.0);
    std::fs::remove_file(&executable).unwrap();
    symlink(&target, &executable).unwrap();
    assert_eq!(
        python_tasks::resolve_with_path(&project.0, None)
            .unwrap()
            .executable,
        executable
    );
    std::fs::remove_dir_all(project.0.join(".venv")).unwrap();
    symlink(&host.0, project.0.join(".venv")).unwrap();
    assert_eq!(
        python_tasks::resolve_with_path(&project.0, None)
            .err()
            .unwrap(),
        "task_python_environment_invalid"
    );
}

#[tokio::test]
#[ignore = "requires installed Python with venv; creates an isolated fixture without pip or downloads"]
async fn runs_unittest_with_a_real_project_environment() {
    let project = Fixture::new();
    let host = python_tasks::resolve(&project.0)
        .expect("Python is required for the explicit environment lifecycle check");
    let mut command = crate::process_command::new_command(host.executable);
    command
        .args(["-m", "venv", "--without-pip", ".venv"])
        .current_dir(&project.0)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    super::process_tree::prepare(&mut command);
    let child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let _tree = super::process_tree::ProcessTree::attach(&child).unwrap();
    let output = tokio::time::timeout(Duration::from_secs(45), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    std::fs::write(project.0.join("requirements.txt"), "").unwrap();
    std::fs::write(project.0.join("test_environment.py"), r#"import os, pathlib, sys, unittest
class EnvironmentTest(unittest.TestCase):
    def test_environment(self):
        expected = pathlib.Path('.venv').resolve()
        self.assertTrue(os.path.samefile(sys.prefix, expected))
        self.assertTrue(os.path.samefile(os.environ['VIRTUAL_ENV'], expected))
        self.assertTrue(os.path.samefile(os.environ['PATH'].split(os.pathsep)[0], pathlib.Path(sys.executable).parent))
        self.assertNotIn('PYTHONHOME', os.environ)
        print('verified-project-environment 中文输出')
"#).unwrap();
    let runner = TaskRunner::default();
    let catalog = catalog::read(&project.0).unwrap();
    let run = runner
        .start(&project.0, "p", "@python/unittest", &catalog.fingerprint)
        .unwrap();
    assert!(run.executable.contains(".venv"));
    let finished = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let run = runner.list("p").remove(0);
            if run.finished_at.is_some() {
                break run;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(finished.status, "succeeded", "{}", finished.stderr);
    assert!(finished.stdout.contains("verified-project-environment"));
    assert!(finished.stdout.contains("中文输出"));
    assert!(finished.stderr.contains("Ran 1 test"));
    println!("verified Python unittest: exit 0; project sys.prefix and VIRTUAL_ENV matched");
}
