//! Fixed Bundler commands for a directory with a Gemfile.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) fn configure(command: &mut std::process::Command, root: &Path) {
    // Keep Bundler on the selected command directory even when the host was
    // started from a different Ruby project.
    command
        .env("BUNDLE_GEMFILE", root.join("Gemfile"))
        .env_remove("BUNDLE_APP_CONFIG");
}

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let Some(gemfile) = read_manifest(root, "Gemfile")? else {
        return Ok(());
    };
    hash.update(b"ruby-tasks-v1");
    hash.update((gemfile.len() as u64).to_le_bytes());
    hash.update(&gemfile);
    let lock = read_manifest(root, "Gemfile.lock")?;
    if let Some(lock) = lock.as_ref() {
        hash.update(b"Gemfile.lock");
        hash.update((lock.len() as u64).to_le_bytes());
        hash.update(lock);
    }
    let rakefile = read_manifest(root, "Rakefile")?;
    if let Some(rakefile) = rakefile.as_ref() {
        hash.update(b"Rakefile");
        hash.update((rakefile.len() as u64).to_le_bytes());
        hash.update(rakefile);
    }
    for (id, args) in [("check", vec!["check"]), ("install", vec!["install"])] {
        let command = format!("bundle {}", args.join(" "));
        tasks.push(Task {
            id: format!("@bundle/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: "Gemfile".into(),
            manager: "bundle".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    if rakefile.is_some() {
        let command = "bundle exec rake".to_owned();
        tasks.push(Task {
            id: "@bundle/rake".into(),
            name: command.clone(),
            command,
            runnable: true,
            source: "Gemfile, Rakefile".into(),
            manager: "bundle".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: vec!["exec".into(), "rake".into()],
        });
    }
    Ok(())
}
