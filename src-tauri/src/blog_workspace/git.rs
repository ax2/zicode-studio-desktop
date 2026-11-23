use super::{assets, site};
use crate::process_command::{new_command, working_directory};
use std::{collections::BTreeSet, path::Path, process::Stdio, time::Duration};

// The integration test additionally connects two disposable repositories by
// local path. Application sync validates a GitHub origin and limits transport.
#[cfg(not(test))]
const PROTOCOLS: &str = "ssh:https";
#[cfg(test)]
const PROTOCOLS: &str = "ssh:https:file";

pub(super) struct Status {
    pub changed: Vec<String>,
    pub pending: bool,
}

fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = new_command("git");
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            cmd.env_remove(key);
        }
    }
    cmd.current_dir(working_directory(root))
        .args([
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "submodule.recurse=false",
            "-c",
            "push.followTags=false",
            "-c",
            "remote.origin.mirror=false",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_ALLOW_PROTOCOL", PROTOCOLS)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let output = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            Duration::from_secs(90),
            tokio::process::Command::from(cmd)
                .kill_on_drop(true)
                .output(),
        )
        .await
    })
    .map_err(|_| "blog_git_timeout")?
    .map_err(|_| "blog_git_unavailable")?;
    if !output.status.success() {
        return Err("blog_git_failed".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "blog_git_failed".into())
}

fn head(root: &Path) -> Result<String, String> {
    let id = run(root, &["rev-parse", "--verify", "HEAD"])?;
    Ok(id.trim().into())
}

fn pending_ref(branch: &str) -> String {
    format!("refs/zicode/blog-pending/{branch}")
}

fn branch(root: &Path) -> Result<String, String> {
    let name = run(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map_err(|_| "blog_git_branch")?;
    Ok(name.trim().into())
}

fn pending(root: &Path, branch: &str) -> Option<String> {
    run(root, &["rev-parse", "--verify", &pending_ref(branch)])
        .ok()
        .map(|v| v.trim().into())
}

fn records(root: &Path) -> Result<Vec<(String, String)>, String> {
    let raw = run(
        root,
        &[
            "status",
            "--porcelain=v1",
            "--no-renames",
            "--untracked-files=all",
            "-z",
        ],
    )?;
    raw.split_terminator('\0')
        .map(|entry| {
            let status = entry.get(..2).ok_or("blog_git_failed")?;
            let path = entry.get(3..).ok_or("blog_git_failed")?;
            Ok((status.to_owned(), path.to_owned()))
        })
        .collect()
}

fn key(layout: site::Layout, prefix: &str, path: &str) -> Option<String> {
    let local = path.strip_prefix(prefix)?;
    if Some(local) == layout.picks() {
        return Some("@homepagePicks".into());
    }
    let key = local.strip_prefix(layout.collection())?.strip_prefix('/')?;
    layout.relative(key).ok().map(|_| key.to_owned())
}

pub(super) fn preview(root: &Path, owners: &[String]) -> Result<assets::Preview, String> {
    let changes = records(root)?;
    plan(root, &changes, owners)
}

fn plan(
    root: &Path,
    changes: &[(String, String)],
    owners: &[String],
) -> Result<assets::Preview, String> {
    let prefix = run(root, &["rev-parse", "--show-prefix"])?;
    let prefix = prefix.trim_end_matches(['\r', '\n']);
    let layout = site::Layout::at(root)?;
    let mut plan = assets::Preview::default();
    let mut images = assets::ArticleImages::default();
    for owner in owners {
        let file = layout.relative(owner)?;
        if let Some((state, _)) = changes
            .iter()
            .find(|(_, name)| name.strip_prefix(prefix) == Some(file.as_str()))
        {
            if state.contains('D') {
                return Err("blog_article_retirement_required".into());
            }
            plan.paths.insert(owner.clone());
        }
        if layout == site::Layout::Astro && owner != "@homepagePicks" {
            images.include(root, owner)?;
        }
    }
    images.validate_directories(root)?;
    for (state, name) in changes {
        let Some(file) = name.strip_prefix(prefix) else {
            continue;
        };
        if !images.includes(file) {
            continue;
        }
        let deleted = state.contains('D');
        let key = format!("{}{file}", assets::PREFIX);
        if let Some(bytes) = assets::checked_size(root, file, deleted)? {
            if deleted {
                return Err("blog_git_refresh".into());
            }
            plan.sizes.insert(key.clone(), bytes);
        } else {
            if images.references.contains(file) {
                return Err("blog_asset_referenced".into());
            }
            plan.deletions.insert(key.clone());
        }
        plan.paths.insert(key);
    }
    // An unchanged reference may be omitted by sparse checkout. Confirm it is
    // in the Git index rather than forcing a download or trusting a local file.
    let mut tracked = Vec::new();
    for file in &images.references {
        site::checked(root, file, true)?;
        if !plan.paths.contains(&format!("{}{file}", assets::PREFIX)) {
            tracked.push(file.as_str());
        }
    }
    for chunk in tracked.chunks(32) {
        let mut args = vec!["ls-files", "--stage", "--error-unmatch", "-z", "--"];
        args.extend_from_slice(chunk);
        let entries = run(root, &args).map_err(|_| "blog_asset_missing")?;
        for entry in entries.split_terminator('\0') {
            let info = entry.split_once('\t').ok_or("blog_git_refresh")?.0;
            if !(info.starts_with("100644 ") || info.starts_with("100755 "))
                || !info.ends_with(" 0")
            {
                return Err("blog_invalid_path".into());
            }
        }
    }
    Ok(plan)
}

pub(super) fn status(root: &Path) -> Result<Status, String> {
    let layout = site::Layout::at(root)?;
    let prefix = run(root, &["rev-parse", "--show-prefix"])?;
    let changed = records(root)?
        .into_iter()
        .filter_map(|(_, file)| key(layout, prefix.trim_end_matches(['\r', '\n']), &file))
        .collect();
    let name = branch(root)?;
    Ok(Status {
        changed,
        pending: pending(root, &name).is_some(),
    })
}

fn github_remote(value: &str) -> bool {
    let url = value.trim_end_matches(['\r', '\n']);
    [
        "https://github.com/",
        "git@github.com:",
        "ssh://git@github.com/",
    ]
    .iter()
    .any(|prefix| {
        url.strip_prefix(prefix).is_some_and(|rest| {
            let mut parts = rest.split('/');
            let safe = |part: &str| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
            };
            parts.next().is_some_and(safe)
                && parts.next().is_some_and(safe)
                && parts.next().is_none()
        })
    })
}

fn sync_branch(root: &Path) -> Result<String, String> {
    let fetch = run(root, &["remote", "get-url", "--all", "origin"])?;
    let push = run(root, &["remote", "get-url", "--push", "--all", "origin"])?;
    if fetch != push || !github_remote(&fetch) {
        return Err("blog_git_remote".into());
    }
    let name = branch(root)?;
    let upstream =
        run(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).map_err(|_| "blog_git_branch")?;
    if upstream.trim() != format!("origin/{name}") {
        return Err("blog_git_branch".into());
    }
    Ok(name)
}

fn commit_selected(
    root: &Path,
    local: &str,
    changes: &[(String, String)],
    selection: &[String],
) -> Result<String, String> {
    if selection.is_empty() {
        return Err("blog_git_no_selection".into());
    }
    let prefix = run(root, &["rev-parse", "--show-prefix"])?;
    let prefix = prefix.trim_end_matches(['\r', '\n']);
    let layout = site::Layout::at(root)?;
    let mut selected = BTreeSet::new();
    for item in selection {
        let file = if let Some(file) = item.strip_prefix(assets::PREFIX) {
            assets::checked_size(root, file, true)?;
            file.to_owned()
        } else {
            layout.resolve(root, item, true)?;
            layout.relative(item)?
        };
        if !changes
            .iter()
            .any(|(_, path)| path == &format!("{prefix}{file}"))
        {
            return Err("blog_git_refresh".into());
        }
        selected.insert(file);
    }
    if changes.iter().any(|(state, file)| {
        state.contains('U')
            || matches!(state.as_str(), "AA" | "DD")
            || (!state.starts_with([' ', '?'])
                && !file
                    .strip_prefix(prefix)
                    .is_some_and(|f| selected.contains(f)))
    }) {
        return Err("blog_git_index_busy".into());
    }
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ] {
        let path = run(
            root,
            &["rev-parse", "--path-format=absolute", "--git-path", marker],
        )?;
        if Path::new(path.trim_end()).exists() {
            return Err("blog_git_index_busy".into());
        }
    }
    let mut add = vec!["add", "--"];
    add.extend(selected.iter().map(String::as_str));
    run(root, &add)?;
    let mut commit = vec!["commit", "--only", "-m", "Update blog content", "--"];
    commit.extend(selected.iter().map(String::as_str));
    run(root, &commit).map_err(|_| "blog_git_commit_failed")?;
    let oid = head(root)?;
    let base = run(root, &["rev-parse", &format!("{oid}^")])?;
    let files = run(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--no-renames",
            "--name-only",
            "-z",
            &oid,
        ],
    )?;
    if base.trim() != local
        || files.split_terminator('\0').any(|path| {
            !path
                .strip_prefix(prefix)
                .is_some_and(|f| selected.contains(f))
        })
    {
        return Err("blog_git_unpublished".into());
    }
    Ok(oid)
}

pub(super) fn sync(
    root: &Path,
    action: &str,
    selection: Vec<String>,
    owners: Vec<String>,
    deletions: Vec<String>,
) -> Result<(), String> {
    let name = sync_branch(root)?;
    sync_reviewed(root, &name, action, selection, &owners, &deletions)
}

fn sync_reviewed(
    root: &Path,
    name: &str,
    action: &str,
    selection: Vec<String>,
    owners: &[String],
    deletions: &[String],
) -> Result<(), String> {
    let branch_ref = format!("refs/heads/{name}");
    let local = head(root)?;
    let pending = pending(root, name);
    if action == "pull" {
        if !records(root)?.is_empty() {
            return Err("blog_git_dirty".into());
        }
        run(root, &["fetch", "--no-tags", "origin", &branch_ref])?;
        if pending.is_some() && pending.as_deref() != Some(local.as_str()) {
            return Err("blog_git_unpublished".into());
        }
        run(root, &["merge-base", "--is-ancestor", &local, "FETCH_HEAD"])
            .map_err(|_| "blog_git_diverged")?;
        run(
            root,
            &["merge", "--ff-only", "--no-overwrite-ignore", "FETCH_HEAD"],
        )
        .map_err(|_| "blog_git_diverged")?;
        if let Some(oid) = pending {
            run(root, &["update-ref", "-d", &pending_ref(name), &oid])?;
        }
        return Ok(());
    }
    let remote = run(
        root,
        &["ls-remote", "--exit-code", "--heads", "origin", &branch_ref],
    )?;
    let remote = remote.split_whitespace().next().ok_or("blog_git_branch")?;
    let reference = pending_ref(name);
    let oid = if let Some(oid) = pending {
        if oid != local {
            return Err("blog_git_unpublished".into());
        }
        if oid == remote {
            run(root, &["update-ref", "-d", &reference, &oid])?;
            if selection.is_empty() {
                return Ok(());
            }
            return Err("blog_git_refresh".into());
        }
        if !selection.is_empty() {
            return Err("blog_git_retry_pending".into());
        }
        let base = run(root, &["rev-parse", &format!("{oid}^")])?;
        if base.trim() != remote {
            return Err("blog_git_diverged".into());
        }
        oid
    } else {
        if local != remote {
            return Err("blog_git_diverged".into());
        }
        let changes = records(root)?;
        let latest = plan(root, &changes, owners)?;
        if latest.paths != selection.iter().cloned().collect()
            || latest.deletions != deletions.iter().cloned().collect()
        {
            return Err("blog_git_refresh".into());
        }
        let oid = commit_selected(root, &local, &changes, &selection)?;
        run(root, &["update-ref", &reference, &oid, ""])?;
        oid
    };
    run(
        root,
        &[
            "push",
            "--no-follow-tags",
            "origin",
            &format!("{oid}:{branch_ref}"),
        ],
    )
    .map_err(|_| "blog_git_push_pending")?;
    run(root, &["update-ref", "-d", &reference, &oid])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn two_checkouts_pull_selected_content_retry_and_protect_divergence() {
        let temp = tempfile::tempdir().unwrap();
        let upstream = temp.path().join("upstream");
        let first = temp.path().join("first");
        for root in [&upstream, &first] {
            std::fs::create_dir(root).unwrap();
        }
        run(&upstream, &["init", "--bare", "--initial-branch=main"]).unwrap();
        run(&first, &["init", "--initial-branch=main"]).unwrap();
        let identity = |repo: &Path| {
            run(repo, &["config", "user.name", "Blog Test"]).unwrap();
            run(repo, &["config", "user.email", "test@example.invalid"]).unwrap();
            run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        };
        identity(&first);
        let remote = upstream.to_str().unwrap();
        run(&first, &["remote", "add", "origin", remote]).unwrap();
        let file = "src/content/blog/one.md";
        std::fs::create_dir_all(first.join(site::COLLECTION)).unwrap();
        std::fs::write(first.join(file), "initial").unwrap();
        std::fs::write(first.join("astro.config.mjs"), "").unwrap();
        run(&first, &["add", "--", file, "astro.config.mjs"]).unwrap();
        run(&first, &["commit", "-m", "Initial article"]).unwrap();
        run(&first, &["push", "-u", "origin", "main"]).unwrap();
        run(temp.path(), &["clone", remote, "peer"]).unwrap();
        let peer = temp.path().join("peer");
        identity(&peer);
        // Production public entry only accepts GitHub. Exercise the same push
        // and pull implementation with a real test-local transport below.
        assert_eq!(sync_branch(&first).unwrap_err(), "blog_git_remote");
        let push = |repo: &Path, keys: &[&str]| {
            let owners: Vec<String> = keys.iter().map(|s| s.to_string()).collect();
            let plan = preview(repo, &owners)?;
            sync_reviewed(
                repo,
                "main",
                "push",
                plan.paths.into_iter().collect(),
                &owners,
                &[],
            )
        };
        let pull = |repo: &Path| sync_reviewed(repo, "main", "pull", vec![], &[], &[]);
        let article="---\nslug: one\nheroImage: /heroes/one-hero.png\n---\n![shared](/images/shared/explicit.png)\n`![example](/images/other/unrelated.png)`";
        std::fs::write(first.join(file), article).unwrap();
        let owners = vec!["one.md".to_owned()];
        assert_eq!(
            preview(&first, &owners).err().unwrap(),
            "blog_asset_missing"
        );
        let png = include_bytes!("../../icons/32x32.png");
        let images = [
            "public/heroes/one-hero.png",
            "public/images/one/figure.png",
            "public/images/shared/explicit.png",
        ];
        let other = "public/images/other/unrelated.png";
        for image in images.iter().copied().chain([other]) {
            let path = first.join(image);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, png).unwrap();
        }
        let ignored = first.join(".git/info/exclude");
        std::fs::write(&ignored, "/public/images/shared/explicit.png\n").unwrap();
        assert_eq!(
            preview(&first, &owners).err().unwrap(),
            "blog_asset_missing"
        );
        std::fs::write(&ignored, "").unwrap();
        let initial = preview(&first, &owners).unwrap();
        assert_eq!(initial.paths.len(), 4);
        assert_eq!(initial.sizes.len(), 3);
        assert_eq!(
            sync_reviewed(&first, "main", "push", owners.clone(), &owners, &[]).unwrap_err(),
            "blog_git_refresh"
        );
        std::fs::write(first.join("local-only.txt"), "local only").unwrap();
        run(&first, &["add", "local-only.txt"]).unwrap();
        assert_eq!(
            push(&first, &["one.md"]).unwrap_err(),
            "blog_git_index_busy"
        );
        run(&first, &["restore", "--staged", "local-only.txt"]).unwrap();
        let missing = temp.path().join("missing");
        run(
            &first,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                missing.to_str().unwrap(),
            ],
        )
        .unwrap();
        assert_eq!(
            push(&first, &["one.md"]).unwrap_err(),
            "blog_git_push_pending"
        );
        assert!(status(&first).unwrap().pending);
        let committed = head(&first).unwrap();
        run(&first, &["remote", "set-url", "--push", "origin", remote]).unwrap();
        push(&first, &[]).unwrap();
        assert_eq!(head(&first).unwrap(), committed);
        assert!(!status(&first).unwrap().pending);
        pull(&peer).unwrap();
        assert_eq!(
            std::fs::read_to_string(peer.join(file))
                .unwrap()
                .replace("\r\n", "\n"),
            article
        );
        for image in images {
            assert_eq!(std::fs::read(peer.join(image)).unwrap().as_slice(), png);
        }
        assert!(!peer.join(other).exists());
        run(
            &peer,
            &[
                "sparse-checkout",
                "set",
                "--no-cone",
                "/src/content/blog/",
                "/astro.config.mjs",
            ],
        )
        .unwrap();
        assert!(!peer.join(images[0]).exists());
        assert!(preview(&peer, &owners).unwrap().paths.is_empty());
        run(&peer, &["sparse-checkout", "disable"]).unwrap();
        // An image-only edit has an unchanged Markdown owner. Dropping an
        // obsolete source image requires its own explicit removal approval.
        std::fs::remove_file(peer.join(images[1])).unwrap();
        let deletion = preview(&peer, &owners).unwrap();
        let removing: Vec<_> = deletion.paths.into_iter().collect();
        assert_eq!(removing, vec![format!("@asset/{}", images[1])]);
        assert_eq!(
            sync_reviewed(&peer, "main", "push", removing.clone(), &owners, &[]).unwrap_err(),
            "blog_git_refresh"
        );
        sync_reviewed(&peer, "main", "push", removing.clone(), &owners, &removing).unwrap();
        assert!(!peer.join("local-only.txt").exists());
        std::fs::write(peer.join(file), "machine two").unwrap();
        push(&peer, &["one.md"]).unwrap();
        std::fs::write(first.join(file), "concurrent edit").unwrap();
        assert_eq!(push(&first, &["one.md"]).unwrap_err(), "blog_git_diverged");
        assert_eq!(pull(&first).unwrap_err(), "blog_git_dirty");
        assert_eq!(
            std::fs::read_to_string(first.join(file)).unwrap(),
            "concurrent edit"
        );
        assert_eq!(
            std::fs::read_to_string(first.join("local-only.txt")).unwrap(),
            "local only"
        );
    }
    #[test]
    fn commits_only_selected_articles_and_preserves_other_work() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        let site = repo.join("astro-site");
        let posts = site.join(site::COLLECTION);
        std::fs::create_dir_all(&posts).unwrap();
        std::fs::write(site.join("astro.config.mjs"), "").unwrap();
        run(repo, &["init", "--initial-branch=main"]).unwrap();
        run(repo, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(repo, &["config", "user.name", "Blog Test"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        std::fs::write(repo.join("README.md"), "original").unwrap();
        run(repo, &["add", "README.md"]).unwrap();
        run(repo, &["commit", "-m", "Initial"]).unwrap();
        let base = head(repo).unwrap();
        std::fs::write(posts.join("one.md"), "selected").unwrap();
        std::fs::write(posts.join("two.md"), "other").unwrap();
        std::fs::write(repo.join("README.md"), "unrelated").unwrap();
        let selected = vec!["one.md".to_string()];
        run(repo, &["add", "README.md"]).unwrap();
        assert_eq!(
            commit_selected(&site, &base, &records(&site).unwrap(), &selected).unwrap_err(),
            "blog_git_index_busy"
        );
        run(repo, &["restore", "--staged", "README.md"]).unwrap();
        let oid = commit_selected(&site, &base, &records(&site).unwrap(), &selected).unwrap();
        assert_eq!(
            run(
                repo,
                &["diff-tree", "--name-only", "--no-commit-id", "-r", &oid]
            )
            .unwrap()
            .trim(),
            "astro-site/src/content/blog/one.md"
        );
        assert_eq!(status(&site).unwrap().changed, ["two.md"]);
        assert_eq!(
            std::fs::read_to_string(repo.join("README.md")).unwrap(),
            "unrelated"
        );
    }
    #[test]
    fn hugo_articles_keep_their_taxonomies_and_drafts_across_two_checkouts() {
        use super::super::catalog;
        use std::fs;

        let temp = tempfile::tempdir().unwrap();
        let upstream = temp.path().join("remote");
        let original = temp.path().join("first");
        let peer = temp.path().join("peer");
        fs::create_dir_all(original.join("content/posts/guide")).unwrap();
        fs::create_dir(&upstream).unwrap();
        run(&upstream, &["init", "--bare", "--initial-branch=main"]).unwrap();
        run(&original, &["init", "--initial-branch=main"]).unwrap();
        for (key, value) in [
            ("user.name", "Hugo test"),
            ("user.email", "hugo@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            run(&original, &["config", key, value]).unwrap();
        }
        fs::write(original.join(".gitattributes"), "*.md -text\n").unwrap();
        fs::write(
            original.join("hugo.toml"),
            "baseURL = 'https://example.org/'\n",
        )
        .unwrap();
        fs::write(
            original.join("content/posts/_index.md"),
            "---\ntitle: Posts\n---\n",
        )
        .unwrap();
        let key = "guide/index.md".to_owned();
        let relative = "content/posts/guide/index.md";
        let raw = "---\ntitle: Guide\ndate: 2025-01-01\ncategories: [development, docs]\ntags: [windows]\ndraft: false\n---\nSample\n";
        fs::write(original.join(relative), raw).unwrap();
        run(&original, &["add", "."]).unwrap();
        run(&original, &["commit", "-m", "Initial site"]).unwrap();
        let remote = upstream.to_str().unwrap();
        run(&original, &["remote", "add", "origin", remote]).unwrap();
        run(&original, &["push", "-u", "origin", "main"]).unwrap();
        run(temp.path(), &["clone", remote, "peer"]).unwrap();

        let root = site::detect(&original).unwrap();
        let layout = site::Layout::at(&root).unwrap();
        assert_eq!(layout.framework(), "hugo");
        assert_eq!(site::list(&root).unwrap(), [key.as_str()]);
        let summary = serde_json::to_value(catalog::summaries(
            &root,
            layout,
            std::slice::from_ref(&key),
        ))
        .unwrap();
        assert_eq!(
            summary[&key]["categories"],
            serde_json::json!(["development", "docs"])
        );
        assert_eq!(summary[&key]["tags"], serde_json::json!(["windows"]));
        assert!(site::resolve(&root, "@homepagePicks", false).is_err());
        assert!(site::resolve(&root, "_index.md", false).is_err());
        assert!(site::resolve(&root, "../about.md", true).is_err());

        let updated = raw
            .replace("development, docs", "engineering")
            .replace("draft: false", "draft: true");
        site::save(&root, &key, &updated, Some(raw)).unwrap();
        assert!(site::save(&root, &key, "stale", Some(raw)).is_err());
        fs::write(root.join("content/about.md"), "unsynced").unwrap();
        assert_eq!(status(&root).unwrap().changed, [key.as_str()]);
        let owners = vec![key.clone()];
        let reviewed = preview(&root, &owners).unwrap();
        assert_eq!(reviewed.paths.iter().collect::<Vec<_>>(), [&key]);
        sync_reviewed(
            &root,
            "main",
            "push",
            reviewed.paths.into_iter().collect(),
            &owners,
            &[],
        )
        .unwrap();
        sync_reviewed(&peer, "main", "pull", vec![], &[], &[]).unwrap();
        assert_eq!(fs::read_to_string(peer.join(relative)).unwrap(), updated);
        assert!(!peer.join("content/about.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("content/about.md")).unwrap(),
            "unsynced"
        );
    }

    #[test]
    fn limits_remote_and_reports_only_site_content() {
        assert!(github_remote("git@github.com:ax2/zicode-blog.git\n"));
        assert!(github_remote("https://github.com/ax2/zicode-blog.git"));
        for bad in [
            "file:///repo",
            "ext::foo",
            "https://github.com.example/a/b",
            "https://github.com/a/b\nhttps://example.org/a/b",
            "https://user@github.com/a/b",
        ] {
            assert!(!github_remote(bad));
        }
        assert_eq!(
            key(
                site::Layout::Astro,
                "site/",
                "site/src/content/blog/en/item.mdx"
            )
            .as_deref(),
            Some("en/item.mdx")
        );
        assert_eq!(
            key(
                site::Layout::Astro,
                "site/",
                "site/src/lib/homepagePicks.ts"
            )
            .as_deref(),
            Some("@homepagePicks")
        );
        assert_eq!(
            key(
                site::Layout::Astro,
                "site/",
                "other/src/content/blog/item.md"
            ),
            None
        );
    }
}
