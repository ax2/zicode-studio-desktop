use super::*;
use crate::notes_vault::NoteDocument;
use crate::visual_assets::novel_draft_commands::{chapter, model};
use crate::visual_assets::{
    catalog,
    characters::{self, Facet},
    snapshot,
};
use std::{os::windows::process::CommandExt, path::PathBuf};

const WORKSPACE: &str = "2e3310dc-b33a-4eec-a51d-b78230d6868d";
const SCENE: &str = "fiction";

struct Fixture {
    root: PathBuf,
    library: PathBuf,
    db: Connection,
    notes: NotesVault,
    note: NoteDocument,
    character: String,
    store: Store,
    job: Uuid,
    plan: Value,
}

impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-model-archive")
            .join(format!("fixture-{}", Uuid::new_v4()));
        let library = root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        let mut db = catalog::open(&library).unwrap();
        db.execute_batch("PRAGMA user_version=1").unwrap();
        let tx = db.transaction().unwrap();
        let character = characters::create(&tx, "绘光", "作者原设定").unwrap();
        tx.commit().unwrap();
        let notes = NotesVault::new(root.join("plugins"))
            .unwrap()
            .scoped(WORKSPACE)
            .unwrap();
        let book = notes.create_notebook("小说", None, None).unwrap();
        let note = notes
            .create_note(&book.id, "桥头", "绘光守在桥头。", vec![], None, None)
            .unwrap();
        let hash = Sha256::digest(SCENE.as_bytes());
        let scene: String = hash[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let config = root.join("scenes").join(scene).join("agent");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("models.json"),json!({"providers":{"local":{"api":"openai-completions","authHeader":false,"baseUrl":"http://127.0.0.1:1/v1","models":[{"id":"fixture-model"}]}}}).to_string()).unwrap();
        let plan = model::preview(&db,&notes,WORKSPACE,SCENE,&root,serde_json::from_value(json!({
            "characterId":character,"facet":"identity","baseVersion":1,
            "evidence":chapter(&note,WORKSPACE).excerpts("绘光").unwrap()[0],"provider":"local","model":"fixture-model"
        })).unwrap()).unwrap();
        let store = Store::open(
            &root.join("jobs"),
            plan["libraryId"].as_str().unwrap(),
            WORKSPACE,
            SCENE,
        )
        .unwrap();
        let job = Uuid::new_v4();
        store.begin(job, &plan).unwrap();
        store.finish(job,&json!({"state":"ready","text":"模型原始建议","error":null,"providerResponseId":"response-one","usage":{"promptTokens":20,"completionTokens":10,"totalTokens":30},"elapsedMs":42,"cost":null})).unwrap();
        Self {
            root,
            library,
            db,
            notes,
            note,
            character,
            store,
            job,
            plan,
        }
    }

    fn save(
        &mut self,
        id: Uuid,
        text: &str,
        checkpoint: &impl Fn(&str) -> Result<()>,
    ) -> Result<Value> {
        adopt_checked(
            &mut self.db,
            &Context {
                library: &self.library,
                store: &self.store,
                notes: &self.notes,
                workspace: WORKSPACE,
                scene: SCENE,
            },
            &Selection {
                job_id: self.job,
                draft_id: id,
                text: text.into(),
            },
            checkpoint,
        )
    }

    fn clean(self) {
        let root = self.root.canonicalize().unwrap();
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-model-archive")
            .canonicalize()
            .unwrap();
        assert_eq!(root.parent(), Some(expected.as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("fixture-"));
        drop(self);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn archives_original_output_author_edits_and_approved_revision_without_automatic_approval() {
    let mut f = Fixture::new();
    let id = Uuid::new_v4();
    f.save(id, "作者审核后的新草案", &|_| Ok(())).unwrap();
    let draft = novel_drafts::get(&f.db, id).unwrap().unwrap();
    assert_eq!(draft.text, "作者审核后的新草案");
    assert!(draft.approved_version.is_none());
    let source = archive::get(&f.db, id).unwrap().unwrap();
    assert!(source.edited);
    assert_eq!(source.result.text, "模型原始建议");
    let source_json = serde_json::to_value(&source).unwrap();
    assert_eq!(source_json["plan"], f.plan);
    assert_eq!(source_json["result"]["providerResponseId"], "response-one");
    assert_eq!(
        characters::latest(&f.db, &f.character, Facet::Identity).unwrap(),
        Some(1)
    );
    let tx = f.db.transaction().unwrap();
    assert_eq!(
        novel_drafts::approve(&tx, id, chapter(&f.note, WORKSPACE)).unwrap(),
        2
    );
    tx.commit().unwrap();
    let revisions = serde_json::to_value(
        characters::revisions(&f.db, &f.character, Facet::Identity, None)
            .unwrap()
            .0,
    )
    .unwrap();
    assert_eq!(revisions[0]["model"]["draftId"], id.to_string());
    assert_eq!(revisions[0]["model"]["jobId"], f.job.to_string());
    assert_eq!(revisions[0]["model"]["edited"], true);
    assert_eq!(revisions[0]["text"], "作者审核后的新草案");
    f.clean();
}

#[test]
fn retry_uses_the_archive_after_receipt_loss_source_changes_and_local_job_loss() {
    let mut f = Fixture::new();
    let id = Uuid::new_v4();
    assert!(f
        .save(
            id,
            "模型原始建议",
            &|phase| if phase == "after-archive-commit" {
                Err("lost receipt".into())
            } else {
                Ok(())
            }
        )
        .is_err());
    assert!(!archive::get(&f.db, id).unwrap().unwrap().edited);
    f.note = f
        .notes
        .save_note(
            &f.note.summary.notebook_id,
            &f.note.summary.id,
            "桥头",
            "绘光离开了。",
            vec![],
            None,
            &f.note.summary.version,
        )
        .unwrap();
    // All Store connections are short lived; keep the original file as offline evidence.
    std::fs::rename(
        f.root.join("jobs/model-drafts.sqlite"),
        f.root.join("jobs/model-drafts.offline"),
    )
    .unwrap();
    let retry = f.save(Uuid::new_v4(), "模型原始建议", &|_| Ok(())).unwrap();
    assert_eq!(retry["id"], id.to_string());
    assert_eq!(retry["alreadySaved"], true);
    assert_eq!(
        f.db.query_row("SELECT count(*) FROM novel_character_draft", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        1
    );
    assert!(f
        .save(id, "不同内容", &|_| Ok(()))
        .unwrap_err()
        .to_string()
        .contains("already_adopted"));
    assert_eq!(
        characters::latest(&f.db, &f.character, Facet::Identity).unwrap(),
        Some(1)
    );
    f.clean();
}

#[test]
fn rejects_stale_sources_unknown_results_and_invalid_provenance_without_partial_drafts() {
    for change in ["chapter", "role", "unknown", "prompt", "credential-field"] {
        let mut f = Fixture::new();
        match change {
            "chapter" => {
                f.note = f
                    .notes
                    .save_note(
                        &f.note.summary.notebook_id,
                        &f.note.summary.id,
                        "桥头",
                        "绘光离开了。",
                        vec![],
                        None,
                        &f.note.summary.version,
                    )
                    .unwrap();
            }
            "role" => {
                let tx = f.db.transaction().unwrap();
                characters::append(&tx, &f.character, Facet::Identity, Some(1), "作者另有设定")
                    .unwrap();
                tx.commit().unwrap();
            }
            "unknown" => {
                f.job = Uuid::new_v4();
                f.store.begin(f.job, &f.plan).unwrap();
            }
            _ => {
                let tasks = Connection::open(f.root.join("jobs/model-drafts.sqlite")).unwrap();
                let path = if change == "prompt" {
                    "$.prompt"
                } else {
                    "$.model.apiKey"
                };
                tasks
                    .execute(
                        "UPDATE novel_model_job SET plan=json_set(plan,?1,'injected') WHERE id=?2",
                        rusqlite::params![path, f.job.to_string()],
                    )
                    .unwrap();
            }
        }
        assert!(
            f.save(Uuid::new_v4(), "待采纳文本", &|_| Ok(())).is_err(),
            "{change}"
        );
        assert!(!novel_drafts::schema_present(&f.db).unwrap(), "{change}");
        assert!(!archive::schema_present(&f.db).unwrap(), "{change}");
        f.clean();
    }
}

#[test]
fn portable_v9_sources_survive_without_local_tasks_and_v8_remains_compatible() {
    let mut f = Fixture::new();
    let manual = Uuid::new_v4();
    let proposal: Proposal = serde_json::from_value(json!({"draftId":manual,"characterId":f.character,"facet":"identity","baseVersion":1,"evidence":f.plan["evidence"],"text":"手工草案"})).unwrap();
    let tx = f.db.transaction().unwrap();
    novel_drafts::create(&tx, &proposal, chapter(&f.note, WORKSPACE)).unwrap();
    tx.commit().unwrap();
    let old = f.root.join("backup-v8");
    std::fs::create_dir(&old).unwrap();
    let old =
        snapshot::create(&mut f.db, &f.library, &old, None, &|_| Ok(()), &|_| Ok(())).unwrap();
    let old_restored = f.root.join("restored-v8");
    let manifest =
        snapshot::restore(&old, &old_restored, |_, _| panic!("no images"), &|_| Ok(())).unwrap();
    assert_eq!(serde_json::to_value(manifest).unwrap()["version"], 8);
    let old_db = catalog::open(&old_restored).unwrap();
    assert!(novel_drafts::get(&old_db, manual)
        .unwrap()
        .unwrap()
        .model
        .is_none());
    assert!(!archive::schema_present(&old_db).unwrap());
    drop(old_db);
    let generated = Uuid::new_v4();
    f.save(generated, "作者采纳的设定", &|_| Ok(())).unwrap();
    let tx = f.db.transaction().unwrap();
    novel_drafts::approve(&tx, generated, chapter(&f.note, WORKSPACE)).unwrap();
    tx.commit().unwrap();
    let expected = serde_json::to_value(archive::get(&f.db, generated).unwrap()).unwrap();
    let destination = f.root.join("backup-v9");
    std::fs::create_dir(&destination).unwrap();
    let backup = snapshot::create(
        &mut f.db,
        &f.library,
        &destination,
        None,
        &|_| Ok(()),
        &|_| Ok(()),
    )
    .unwrap();
    let restored = f.root.join("restored-v9");
    let manifest =
        snapshot::restore(&backup, &restored, |_, _| panic!("no images"), &|_| Ok(())).unwrap();
    assert_eq!(serde_json::to_value(manifest).unwrap()["version"], 9);
    let restored_db = catalog::open(&restored).unwrap();
    assert!(!restored.join("model-drafts.sqlite").exists());
    assert!(!restored.join("scenes").exists());
    assert_eq!(
        serde_json::to_value(archive::get(&restored_db, generated).unwrap()).unwrap(),
        expected
    );
    let draft = novel_drafts::get(&restored_db, generated).unwrap().unwrap();
    assert_eq!(draft.approved_version, Some(2));
    assert!(draft.model.is_some());
    assert_eq!(
        characters::latest(&restored_db, &f.character, Facet::Identity).unwrap(),
        Some(2)
    );
    drop(restored_db);
    f.clean();
}

#[test]
fn backup_refuses_changed_source_bytes_bindings_and_author_text() {
    let mut f = Fixture::new();
    let id = Uuid::new_v4();
    f.save(id, "采纳文本", &|_| Ok(())).unwrap();
    let original: String =
        f.db.query_row(
            "SELECT source FROM novel_model_source WHERE draft_id=?1",
            [id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    for (index, path) in [
        "$.result.text",
        "$.edited",
        "$.plan.evidence.quote",
        "$.textDigest",
        "$.result.usage.totalTokens",
        "$.jobId",
    ]
    .iter()
    .enumerate()
    {
        f.db.execute(
            "UPDATE novel_model_source SET source=json_set(source,?1,'changed') WHERE draft_id=?2",
            rusqlite::params![path, id.to_string()],
        )
        .unwrap();
        let destination = f.root.join(format!("invalid-{index}"));
        std::fs::create_dir(&destination).unwrap();
        assert!(
            snapshot::create(
                &mut f.db,
                &f.library,
                &destination,
                None,
                &|_| Ok(()),
                &|_| Ok(())
            )
            .is_err(),
            "{path}"
        );
        assert!(!destination.join("snapshot").exists());
        f.db.execute(
            "UPDATE novel_model_source SET source=?1 WHERE draft_id=?2",
            rusqlite::params![original, id.to_string()],
        )
        .unwrap();
    }
    f.db.execute(
        "UPDATE novel_character_draft SET text='different author text' WHERE id=?1",
        [id.to_string()],
    )
    .unwrap();
    assert!(archive::validate_snapshot(&f.db).is_err());
    f.clean();
}

#[test]
fn archive_crash_child() {
    let Some(root) = std::env::var_os("ZICODE_MODEL_ARCHIVE_CRASH_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let request: Value =
        serde_json::from_slice(&std::fs::read(root.join("crash.json")).unwrap()).unwrap();
    let library = root.join("library");
    let mut db = catalog::open(&library).unwrap();
    let library_id: String = db
        .query_row("SELECT id FROM library", [], |row| row.get(0))
        .unwrap();
    let notes = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(WORKSPACE)
        .unwrap();
    let store = Store::open(&root.join("jobs"), &library_id, WORKSPACE, SCENE).unwrap();
    let selection: Selection = serde_json::from_value(request["selection"].clone()).unwrap();
    adopt_checked(
        &mut db,
        &Context {
            library: &library,
            store: &store,
            notes: &notes,
            workspace: WORKSPACE,
            scene: SCENE,
        },
        &selection,
        &|phase| {
            if request["phase"] == phase {
                std::process::exit(86);
            }
            Ok(())
        },
    )
    .unwrap();
    panic!("checkpoint not reached");
}

#[test]
fn real_process_exit_never_leaves_a_draft_without_its_model_source() {
    for phase in ["before-archive-commit", "after-archive-commit"] {
        let mut f = Fixture::new();
        let id = Uuid::new_v4();
        std::fs::write(
            f.root.join("crash.json"),
            json!({"phase":phase,"selection":{"jobId":f.job,"draftId":id,"text":"审核文本"}})
                .to_string(),
        )
        .unwrap();
        // Release the original process's Notes lease before simulating a restart.
        let original_notes = std::mem::replace(
            &mut f.notes,
            NotesVault::new(f.root.join("child-placeholder/plugins")).unwrap(),
        );
        drop(original_notes);
        let output = crate::process_command::new_command(std::env::current_exe().unwrap())
            .args(["--exact","visual_assets::novel_draft_commands::model_commands::adoption::tests::archive_crash_child","--nocapture"])
            .env("ZICODE_MODEL_ARCHIVE_CRASH_ROOT",&f.root).creation_flags(0x08000000).output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(86),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        f.notes = NotesVault::new(f.root.join("plugins"))
            .unwrap()
            .scoped(WORKSPACE)
            .unwrap();
        let expected = phase == "after-archive-commit";
        assert_eq!(novel_drafts::get(&f.db, id).unwrap().is_some(), expected);
        assert_eq!(archive::get(&f.db, id).unwrap().is_some(), expected);
        f.save(id, "审核文本", &|_| Ok(())).unwrap();
        assert_eq!(
            archive::find_job(&f.db, f.job).unwrap(),
            Some(id.to_string())
        );
        assert_eq!(
            f.db.query_row("SELECT count(*) FROM novel_character_draft", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1
        );
        assert_eq!(
            characters::latest(&f.db, &f.character, Facet::Identity).unwrap(),
            Some(1)
        );
        f.clean();
    }
}
