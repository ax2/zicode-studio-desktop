use super::{head, pending, run, site, status, sync_reviewed};
use std::{
    fs,
    path::{Path, PathBuf},
};

const ARTICLE: &str = "src/content/blog/one.md";
const FIRST_REVISION: &str =
    "---\ntitle: First writer\nother: keep this metadata\n---\nA's draft.\n";
const SECOND_REVISION: &str =
    "---\ntitle: Second writer\nother: keep this metadata\n---\nB's draft.\n";

struct Checkouts {
    _temp: tempfile::TempDir,
    origin: PathBuf,
    first: PathBuf,
    second: PathBuf,
}

impl Checkouts {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let origin = temp.path().join("origin.git");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir(&origin).unwrap();
        fs::create_dir(&first).unwrap();
        run(&origin, &["init", "--bare", "--initial-branch=main"]).unwrap();
        run(&first, &["init", "--initial-branch=main"]).unwrap();
        Self::identity(&first);
        run(
            &first,
            &["remote", "add", "origin", origin.to_str().unwrap()],
        )
        .unwrap();
        fs::create_dir_all(first.join(site::COLLECTION)).unwrap();
        fs::write(first.join(ARTICLE), "Initial post.\n").unwrap();
        fs::write(first.join("astro.config.mjs"), "").unwrap();
        run(&first, &["add", "--", ARTICLE, "astro.config.mjs"]).unwrap();
        run(&first, &["commit", "-m", "Initial article"]).unwrap();
        run(&first, &["push", "-u", "origin", "main"]).unwrap();
        run(
            temp.path(),
            &[
                "clone",
                "--config",
                "core.autocrlf=false",
                origin.to_str().unwrap(),
                "second",
            ],
        )
        .unwrap();
        Self::identity(&second);
        Self {
            _temp: temp,
            origin,
            first,
            second,
        }
    }

    fn identity(repo: &Path) {
        run(repo, &["config", "user.name", "Blog sync test"]).unwrap();
        run(repo, &["config", "user.email", "blog-test@example.invalid"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        run(repo, &["config", "core.autocrlf", "false"]).unwrap();
    }

    fn push_url(&self, path: &Path) {
        run(
            &self.first,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                path.to_str().unwrap(),
            ],
        )
        .unwrap();
    }
}

fn push_article(repo: &Path) -> Result<(), String> {
    let article = vec!["one.md".to_owned()];
    sync_reviewed(repo, "main", "push", article.clone(), &article, &[])
}

fn retry_push(repo: &Path) -> Result<(), String> {
    sync_reviewed(repo, "main", "push", vec![], &[], &[])
}

fn pending_first(checkouts: &Checkouts) -> String {
    fs::write(checkouts.first.join(ARTICLE), FIRST_REVISION).unwrap();
    fs::write(
        checkouts.first.join("private-draft.txt"),
        "A's local-only draft",
    )
    .unwrap();

    checkouts.push_url(&checkouts.origin.with_file_name("unavailable.git"));
    assert_eq!(
        push_article(&checkouts.first).unwrap_err(),
        "blog_git_push_pending"
    );
    let committed = head(&checkouts.first).unwrap();
    assert_eq!(
        pending(&checkouts.first, "main").as_deref(),
        Some(committed.as_str())
    );
    checkouts.push_url(&checkouts.origin);
    committed
}

#[test]
fn acknowledged_pending_revision_unblocks_after_the_peer_pushes_again() {
    let checkouts = Checkouts::new();
    let first_commit = pending_first(&checkouts);

    // Model a lost push acknowledgement: the pending state stays on the
    // first checkout, but a real Git transmission adds its exact OID upstream.
    run(&checkouts.first, &["push", "origin", "main"]).unwrap();
    sync_reviewed(&checkouts.second, "main", "pull", vec![], &[], &[]).unwrap();
    assert_eq!(head(&checkouts.second).unwrap(), first_commit);
    assert_eq!(
        fs::read_to_string(checkouts.second.join(ARTICLE)).unwrap(),
        FIRST_REVISION
    );
    fs::write(checkouts.second.join(ARTICLE), SECOND_REVISION).unwrap();
    push_article(&checkouts.second).unwrap();
    let remote_tip = head(&checkouts.origin).unwrap();
    assert_ne!(remote_tip, first_commit);

    assert_eq!(
        sync_reviewed(&checkouts.first, "main", "pull", vec![], &[], &[]).unwrap_err(),
        "blog_git_dirty"
    );
    assert!(status(&checkouts.first).unwrap().pending);
    let tracking_ref = ["rev-parse", "--verify", "refs/remotes/origin/main"];
    let tracked_before = run(&checkouts.first, &tracking_ref).unwrap();
    let fetch_head = checkouts.first.join(".git/FETCH_HEAD");
    assert!(!fetch_head.exists());
    retry_push(&checkouts.first).unwrap();
    assert!(!fetch_head.exists());
    assert_eq!(
        run(&checkouts.first, &tracking_ref).unwrap(),
        tracked_before
    );
    assert!(!status(&checkouts.first).unwrap().pending);
    assert_eq!(head(&checkouts.first).unwrap(), first_commit);
    assert_eq!(head(&checkouts.second).unwrap(), remote_tip);
    assert_eq!(head(&checkouts.origin).unwrap(), remote_tip);
    assert_eq!(
        fs::read_to_string(checkouts.first.join(ARTICLE)).unwrap(),
        FIRST_REVISION
    );
    assert_eq!(
        fs::read_to_string(checkouts.first.join("private-draft.txt")).unwrap(),
        "A's local-only draft"
    );
    assert_eq!(
        fs::read_to_string(checkouts.second.join(ARTICLE)).unwrap(),
        SECOND_REVISION
    );
    assert!(!checkouts.second.join("private-draft.txt").exists());

    // An explicit clean pull can now continue the cycle. The retry never
    // moved the draft or pulled either checkout on the user's behalf.
    let draft = checkouts.first.join("private-draft.txt");
    let moved_draft = checkouts.first.with_file_name("retained-draft.txt");
    fs::rename(&draft, &moved_draft).unwrap();
    sync_reviewed(&checkouts.first, "main", "pull", vec![], &[], &[]).unwrap();
    assert_eq!(head(&checkouts.first).unwrap(), remote_tip);
    assert_eq!(
        fs::read_to_string(checkouts.first.join(ARTICLE)).unwrap(),
        SECOND_REVISION
    );
    fs::rename(moved_draft, &draft).unwrap();
    assert_eq!(fs::read_to_string(draft).unwrap(), "A's local-only draft");
}

#[test]
fn unpublished_pending_revision_stays_available_when_the_peer_diverges() {
    let checkouts = Checkouts::new();
    let first_commit = pending_first(&checkouts);

    fs::write(checkouts.second.join(ARTICLE), SECOND_REVISION).unwrap();
    push_article(&checkouts.second).unwrap();
    let remote_tip = head(&checkouts.origin).unwrap();
    assert_ne!(remote_tip, first_commit);

    assert_eq!(
        retry_push(&checkouts.first).unwrap_err(),
        "blog_git_diverged"
    );
    assert!(status(&checkouts.first).unwrap().pending);
    assert_eq!(
        pending(&checkouts.first, "main").as_deref(),
        Some(first_commit.as_str())
    );
    assert_eq!(head(&checkouts.first).unwrap(), first_commit);
    assert_eq!(head(&checkouts.origin).unwrap(), remote_tip);
    assert_eq!(
        fs::read_to_string(checkouts.first.join(ARTICLE)).unwrap(),
        FIRST_REVISION
    );
    assert_eq!(
        fs::read_to_string(checkouts.second.join(ARTICLE)).unwrap(),
        SECOND_REVISION
    );
}
