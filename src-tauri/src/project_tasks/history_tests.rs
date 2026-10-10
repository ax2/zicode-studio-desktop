use super::*;
use crate::project_tasks::{
    catalog,
    tests::{finished, Fixture},
    TaskRunner,
};

fn sample(id: usize, completed: bool) -> Run {
    Run {
        id: format!("run-{id}"),
        workspace_id: "project".into(),
        directory: "service".into(),
        name: "check".into(),
        manager: "bun".into(),
        fingerprint: "manifest-digest".into(),
        status: if completed { "succeeded" } else { "running" }.into(),
        started_at: id as u64,
        finished_at: completed.then_some(id as u64 + 1),
        exit_code: completed.then_some(0),
        historical: false,
        command: "PRIVATE-COMMAND".into(),
        invocation: "PRIVATE-ARGS".into(),
        executable: "PRIVATE-EXECUTABLE".into(),
        stdout: "PRIVATE-STDOUT".into(),
        stderr: "PRIVATE-STDERR".into(),
        truncated: true,
    }
}

#[test]
fn reopens_metadata_without_command_or_output_and_isolates_roots() {
    let fixture = Fixture::new();
    let path = fixture.0.join("history.sqlite3");
    let key = scope(&fixture.0, "project");
    let mut store = History::open(&path);
    store.save(&key, &sample(1, true));
    assert_eq!(store.status(), "persistent");
    drop(store);
    let raw = std::fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("PRIVATE-"));
    let runner = TaskRunner::with_history(&path);
    let report = runner.run_history(&fixture.0, "project");
    assert_eq!(report.history_status, "persistent");
    let run = &report.runs[0];
    assert!(run.historical);
    assert_eq!(run.fingerprint, "manifest-digest");
    assert_eq!(run.status, "succeeded");
    assert_eq!(run.directory, "service");
    assert!(run.stdout.is_empty() && run.command.is_empty() && run.invocation.is_empty());
    assert!(runner.run_history(&fixture.0, "other").runs.is_empty());
    let other = Fixture::new();
    assert!(runner.run_history(&other.0, "project").runs.is_empty());
}

#[test]
fn other_live_host_runs_are_unknown_without_rewriting_the_database() {
    let fixture = Fixture::new();
    let path = fixture.0.join("history.sqlite3");
    let mut first = History::open(&path);
    let mut second = History::open(&path);
    first.save("project", &sample(1, false));
    assert_eq!(second.list("project")[0].status, "unknown");
    assert_eq!(first.list("project")[0].status, "unknown");
    first.save("project", &sample(1, true));
    assert_eq!(second.list("project")[0].status, "succeeded");
    assert_eq!(second.status(), "persistent");
}

#[test]
fn bounds_history_per_project_and_globally() {
    let fixture = Fixture::new();
    let mut store = History::open(&fixture.0.join("history.sqlite3"));
    for id in 0..45 {
        store.save("first", &sample(id, true));
    }
    let rows = store.list("first");
    assert_eq!(rows.len(), 40);
    assert_eq!(rows[0].id, "run-44");
    assert_eq!(rows[39].id, "run-5");
    for id in 45..550 {
        store.save(&format!("scope-{}", id / 30), &sample(id, true));
    }
    let count: u32 = store
        .connection
        .as_ref()
        .unwrap()
        .query_row("SELECT count(*) FROM runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 500);
    assert_eq!(store.status(), "persistent");
}

#[test]
fn clear_is_scoped_and_keeps_supplied_active_runs() {
    let fixture = Fixture::new();
    let mut store = History::open(&fixture.0.join("history.sqlite3"));
    store.save("first", &sample(1, true));
    store.save("first", &sample(2, false));
    store.save("other", &sample(3, true));
    store.clear("first", &[sample(2, false)]).unwrap();
    assert_eq!(store.list("first").len(), 1);
    assert_eq!(store.list("first")[0].id, "run-2");
    assert_eq!(store.list("other")[0].id, "run-3");
    store.clear("first", &[]).unwrap();
    assert!(store.list("first").is_empty());
}

#[test]
fn corruption_and_newer_schema_are_reported_without_overwriting_files() {
    let fixture = Fixture::new();
    let path = fixture.0.join("corrupt.sqlite3");
    std::fs::write(&path, b"not a sqlite database").unwrap();
    let mut store = History::open(&path);
    store.save("project", &sample(1, true));
    assert!(store.list("project").is_empty());
    assert_eq!(store.status(), "unavailable");
    assert!(store.clear("project", &[]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"not a sqlite database");
    let path = fixture.0.join("future.sqlite3");
    let connection = Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 99).unwrap();
    drop(connection);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(History::open(&path).status(), "unavailable");
    assert_eq!(bytes, std::fs::read(&path).unwrap());
}

#[test]
fn locked_reads_keep_cached_metadata_and_failed_clear_is_atomic() {
    let fixture = Fixture::new();
    let path = fixture.0.join("history.sqlite3");
    let mut store = History::open(&path);
    store.save("project", &sample(1, true));
    assert_eq!(store.list("project").len(), 1);
    let blocker = Connection::open(&path).unwrap();
    blocker.execute_batch("BEGIN EXCLUSIVE").unwrap();
    assert_eq!(store.list("project")[0].id, "run-1");
    assert!(store.clear("project", &[]).is_err());
    assert_eq!(store.status(), "unavailable");
    blocker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store.list("project").len(), 1);
    // A later successful read cannot prove that earlier writes were saved.
    assert_eq!(store.status(), "unavailable");
}

#[tokio::test]
async fn real_command_completes_with_unavailable_storage() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::with_history(&fixture.0); // a directory cannot be a SQLite file
    runner
        .start(
            &fixture.0,
            "project",
            "ok",
            &catalog::read(&fixture.0).unwrap().fingerprint,
        )
        .unwrap();
    assert_eq!(finished(&runner, "project").await.status, "succeeded");
    assert_eq!(
        runner.run_history(&fixture.0, "project").history_status,
        "unavailable"
    );
    assert!(runner.clear_history(&fixture.0, "project").is_err());
    assert_eq!(runner.list("project").len(), 1);
    runner.stop_all();
    runner.completion_tracker().wait().await;
}

#[tokio::test]
async fn shutdown_waits_for_final_metadata_and_clear_keeps_active_process() {
    let fixture = Fixture::runnable();
    let path = fixture.0.join("history.sqlite3");
    let runner = TaskRunner::with_history(&path);
    let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
    runner
        .start(&fixture.0, "project", "ok", &fingerprint)
        .unwrap();
    finished(&runner, "project").await;
    let active = runner
        .start(&fixture.0, "project", "watch", &fingerprint)
        .unwrap();
    runner.clear_history(&fixture.0, "project").unwrap();
    assert_eq!(runner.list("project").len(), 1);
    assert_eq!(runner.list("project")[0].status, "running");
    let tracker = runner.completion_tracker();
    drop(runner);
    tokio::time::timeout(std::time::Duration::from_secs(8), tracker.wait())
        .await
        .unwrap();
    let reopened = TaskRunner::with_history(&path);
    let runs = reopened.run_history(&fixture.0, "project").runs;
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, active.id);
    assert_eq!(runs[0].status, "cancelled");
    assert!(runs[0].finished_at.is_some());
    assert!(runs[0].historical && runs[0].stdout.is_empty());
    assert!(reopened.stop("project", &active.id).is_err());
}
