//! Cold-copy and independent JSON restore through real isolated-profile Hosts.
use super::*;
use crate::metadata_store::MetadataStore;
use crate::notes_vault::{NoteDocument, NoteSource, NotesVault};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path};

const WORKSPACE: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async fn start_profile(profile: &Path) -> HostServer {
    crate::workspace_mode::initialize_desktop();
    crate::desktop_profile::initialize([
        "--isolated-profile".into(),
        profile.as_os_str().to_owned(),
    ])
    .unwrap();
    assert_eq!(
        crate::desktop_profile::root()
            .unwrap()
            .canonicalize()
            .unwrap(),
        profile.canonicalize().unwrap()
    );
    let public = profile.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "Synthetic Notes recovery").unwrap();
    let path = crate::app_paths::metadata_path().unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let metadata = MetadataStore::open(&path).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let workspace = crate::app_paths::global_workspace_root().unwrap();
    fs::create_dir_all(&workspace).unwrap();
    host.register_workspace(WORKSPACE, workspace).unwrap();
    host
}

fn client(host: &HostServer) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "x-zicode-desktop-token",
        host.desktop_token().parse().unwrap(),
    );
    reqwest::Client::builder()
        .no_proxy()
        .default_headers(headers)
        .build()
        .unwrap()
}

async fn get(host: &HostServer, client: &reqwest::Client, path: &str) -> Value {
    let response = client
        .get(format!("{}{path}", host.origin()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "GET {path}");
    response.json().await.unwrap()
}

fn export_path() -> String {
    format!("/v2/notes/export-all?sceneId=programming&workspaceId={WORKSPACE}")
}

fn save_attachment_note(
    vault: &NotesVault,
    notebook: &str,
    title: &str,
    bytes: &[u8],
    filename: &str,
    mime: &str,
    suffix: &str,
) -> NoteDocument {
    let note = vault
        .create_note(
            notebook,
            title,
            "initial",
            vec!["backup".into()],
            Some("🧾".into()),
            None,
        )
        .unwrap();
    let attachment = vault
        .store_attachment(notebook, &note.summary.id, filename, mime, bytes)
        .unwrap();
    vault
        .save_note(
            notebook,
            &note.summary.id,
            title,
            &format!("# {title}\n\n中文 😀\n\n{}\n{suffix}", attachment.markdown),
            note.summary.tags,
            note.summary.icon,
            &note.summary.version,
        )
        .unwrap()
}

fn create_fixture(host: &HostServer) {
    let manager = host.state.notes.lock().unwrap();
    let vault = manager.scoped(WORKSPACE).unwrap();
    let parent = vault
        .create_notebook("合成根笔记本", Some("📚".into()), None)
        .unwrap();
    let child = vault
        .create_notebook("合成子笔记本", Some("📁".into()), Some(parent.id.clone()))
        .unwrap();
    let note = vault
        .create_note(
            &parent.id,
            "有来源的合成笔记",
            "# 合成正文\n\n中文与 emoji 😀",
            vec!["source".into(), "中文".into()],
            Some("🌐".into()),
            Some(NoteSource {
                url: "https://example.org/synthetic-notes".into(),
                captured_at: "2026-11-18T08:00:00Z".into(),
                content_hash: "a".repeat(64),
                document_revision: Some("synthetic-document".into()),
                author: None,
                published_at: None,
                site_name: None,
                image: None,
            }),
        )
        .unwrap();
    let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMRkAAAAASUVORK5CYII=").unwrap();
    save_attachment_note(
        &vault,
        &child.id,
        "图片和笔记引用",
        &png,
        "synthetic.png",
        "image/png",
        &format!(
            "[内部笔记](zicode-note://{}/{})",
            parent.id, note.summary.id
        ),
    );
    let mut binary = b"%PDF-1.4\n% synthetic binary fixture\n".to_vec();
    binary.extend(0..=255);
    binary.extend_from_slice(b"\n%%EOF\n");
    let trash = save_attachment_note(
        &vault,
        &child.id,
        "回收站中的二进制附件",
        &binary,
        "synthetic.pdf",
        "application/pdf",
        "",
    );
    vault
        .delete_note(&child.id, &trash.summary.id, &trash.summary.version)
        .unwrap();
}

async fn source(owner: &Path, host: &HostServer, client: &reqwest::Client) {
    create_fixture(host);
    let backup = get(host, client, &export_path()).await["backup"].clone();
    assert_eq!(backup["notebooks"].as_array().unwrap().len(), 2);
    let attachments: usize = backup["notebooks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["attachments"].as_array().unwrap().len())
        .sum();
    assert_eq!(attachments, 2);
    let recovery = format!(
        "ZNS1-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x5a; 32])
    );
    crate::notes_sync::SyncKey::from_recovery(&recovery).unwrap();
    let archive = serde_json::to_vec_pretty(&backup).unwrap();
    assert!(!String::from_utf8_lossy(&archive).contains(&recovery));
    fs::create_dir_all(owner.join("independent-backup")).unwrap();
    fs::create_dir_all(owner.join("separate-recovery-code")).unwrap();
    fs::write(owner.join("independent-backup/notes.json"), archive).unwrap();
    fs::write(owner.join("separate-recovery-code/code.txt"), recovery).unwrap();

    // A broken managed attachment must not silently become a partial backup.
    let book = backup["notebooks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| !b["attachments"].as_array().unwrap().is_empty())
        .unwrap();
    let attachment = &book["attachments"][0];
    let data = crate::app_paths::workspace_app_dir(
        &crate::app_paths::global_workspace_root().unwrap(),
        &crate::app_paths::system_root().unwrap(),
    );
    let path = data
        .join("notes")
        .join(book["notebook"]["id"].as_str().unwrap())
        .join("public/attachments")
        .join(attachment["noteId"].as_str().unwrap())
        .join(attachment["fileName"].as_str().unwrap());
    let original = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let failed = client
        .get(format!("{}{}", host.origin(), export_path()))
        .send()
        .await
        .unwrap();
    assert!(
        !failed.status().is_success(),
        "unreadable managed attachment was silently omitted from a supposedly complete backup"
    );
    fs::remove_dir(&path).unwrap();
    fs::write(&path, []).unwrap();
    let failed = client
        .get(format!("{}{}", host.origin(), export_path()))
        .send()
        .await
        .unwrap();
    assert!(
        !failed.status().is_success(),
        "empty attachment produced an archive the importer would reject"
    );
    fs::write(&path, &original).unwrap();
}

async fn import_archive(owner: &Path, host: &HostServer, client: &reqwest::Client, backup: &Value) {
    // Import remains additive and must roll back a malformed complete bundle.
    {
        let manager = host.state.notes.lock().unwrap();
        let vault = manager.scoped(WORKSPACE).unwrap();
        let notebook = vault
            .create_notebook("导入前已有的合成笔记本", None, None)
            .unwrap();
        let note = vault
            .create_note(
                &notebook.id,
                "保留已有资料",
                "synthetic sentinel",
                vec![],
                None,
                None,
            )
            .unwrap();
        fs::write(
            owner.join("sentinel.json"),
            serde_json::to_vec(&note).unwrap(),
        )
        .unwrap();
    }
    let mut damaged = backup.clone();
    damaged["notebooks"]
        .as_array_mut()
        .unwrap()
        .sort_by_key(|book| !book["attachments"].as_array().unwrap().is_empty());
    let book = damaged["notebooks"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|b| !b["attachments"].as_array().unwrap().is_empty())
        .unwrap();
    book["attachments"][0]["dataBase64"] = json!("not-base64!");
    let response = client
        .post(format!("{}/v2/notes/import-all-backup", host.origin()))
        .json(&json!({"sceneId":"programming","workspaceId":WORKSPACE,"backup":damaged}))
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    let snapshot = get(
        host,
        client,
        &format!("/v2/notes?sceneId=programming&workspaceId={WORKSPACE}"),
    )
    .await;
    assert_eq!(
        snapshot["snapshot"]["notebooks"].as_array().unwrap().len(),
        1
    );
    let response = client
        .post(format!("{}/v2/notes/import-all-backup", host.origin()))
        .json(&json!({"sceneId":"programming","workspaceId":WORKSPACE,"backup":backup}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

async fn verify_corpus(
    owner: &Path,
    host: &HostServer,
    client: &reqwest::Client,
    backup: &Value,
    imported: bool,
) {
    let snapshot = get(
        host,
        client,
        &format!("/v2/notes?sceneId=programming&workspaceId={WORKSPACE}"),
    )
    .await;
    let books = snapshot["snapshot"]["notebooks"].as_array().unwrap();
    assert_eq!(books.len(), if imported { 3 } else { 2 });
    let expected = backup["notebooks"].as_array().unwrap();
    let mut mapping = HashMap::new();
    for book in expected {
        let title = book["notebook"]["title"].as_str().unwrap();
        let title = if imported {
            format!("{title} (Imported)")
        } else {
            title.to_string()
        };
        let actual = books.iter().find(|b| b["title"] == title).unwrap();
        assert_eq!(actual["icon"], book["notebook"]["icon"]);
        mapping.insert(
            book["notebook"]["id"].as_str().unwrap().to_string(),
            actual["id"].as_str().unwrap().to_string(),
        );
    }
    let trash = get(
        host,
        client,
        &format!("/v2/notes/trash?sceneId=programming&workspaceId={WORKSPACE}"),
    )
    .await;
    assert_eq!(trash["trash"].as_array().unwrap().len(), 1);
    for book in expected {
        let old_book = book["notebook"]["id"].as_str().unwrap();
        let id = &mapping[old_book];
        let actual = books.iter().find(|b| b["id"] == *id).unwrap();
        if let Some(parent) = book["notebook"]["parentId"].as_str() {
            assert_eq!(actual["parentId"], mapping[parent]);
        } else {
            assert!(actual["parentId"].is_null());
        }
        for note in book["notes"].as_array().unwrap() {
            let note_id = note["id"].as_str().unwrap();
            let actual = get(host, client, &format!("/v2/notes/note?sceneId=programming&workspaceId={WORKSPACE}&notebookId={id}&noteId={note_id}")).await;
            let mut body = note["content"].as_str().unwrap().to_string();
            if imported {
                for (old, new) in &mapping {
                    body = body.replace(
                        &format!("zicode-note://{old}/"),
                        &format!("zicode-note://{new}/"),
                    );
                }
            }
            assert_eq!(actual["note"]["content"], body);
            for key in ["title", "icon", "tags", "source", "createdAt", "updatedAt"] {
                assert_eq!(actual["note"][key], note[key], "note field {key}");
            }
            if !imported {
                assert_eq!(actual["note"]["version"], note["version"]);
            }
        }
        for attachment in book["attachments"].as_array().unwrap() {
            let note = attachment["noteId"].as_str().unwrap();
            let file = attachment["fileName"].as_str().unwrap();
            let response = client.get(format!("{}/v2/notes/attachment?sceneId=programming&workspaceId={WORKSPACE}&notebookId={id}&noteId={note}&attachmentId={file}", host.origin())).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()[reqwest::header::CONTENT_TYPE],
                attachment["mimeType"].as_str().unwrap()
            );
            let bytes = response.bytes().await.unwrap();
            let expected = base64::engine::general_purpose::STANDARD
                .decode(attachment["dataBase64"].as_str().unwrap())
                .unwrap();
            assert_eq!(bytes.as_ref(), expected.as_slice());
            assert_eq!(Sha256::digest(&bytes), Sha256::digest(&expected));
        }
        for deleted in book["trashedNotes"].as_array().unwrap() {
            let note_id = deleted["note"]["id"].as_str().unwrap();
            let actual = trash["trash"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["note"]["id"] == note_id)
                .unwrap();
            assert_eq!(actual["notebookId"], *id);
            assert_eq!(actual["deletedAt"], deleted["deletedAt"]);
            assert_eq!(actual["deletionTimeKnown"], deleted["deletionTimeKnown"]);
            for key in ["title", "icon", "tags", "source", "createdAt", "updatedAt"] {
                assert_eq!(
                    actual["note"][key], deleted["note"][key],
                    "trash note field {key}"
                );
            }
            let restored = {
                let manager = host.state.notes.lock().unwrap();
                manager
                    .scoped(WORKSPACE)
                    .unwrap()
                    .restore_note(id, note_id)
                    .unwrap()
            };
            assert_eq!(
                restored.content,
                deleted["note"]["content"].as_str().unwrap()
            );
        }
    }
    if imported {
        let note: Value =
            serde_json::from_slice(&fs::read(owner.join("sentinel.json")).unwrap()).unwrap();
        let book = note["notebookId"].as_str().unwrap();
        let id = note["id"].as_str().unwrap();
        let actual=get(host,client,&format!("/v2/notes/note?sceneId=programming&workspaceId={WORKSPACE}&notebookId={book}&noteId={id}")).await;
        assert_eq!(actual["note"], note);
    }
}

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let metadata = fs::symlink_metadata(entry.path()).unwrap();
        assert!(!metadata.file_type().is_symlink());
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            assert_eq!(metadata.file_attributes() & 0x400, 0);
        }
        let destination = target.join(entry.file_name());
        if metadata.is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            assert!(metadata.is_file());
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

#[tokio::test]
async fn local_complete_copy_and_independent_archive_restore_without_cloud_recovery_code() {
    let case = std::thread::current().name().unwrap().to_string();
    if std::env::var("ZICODE_NOTES_BACKUP_CASE").as_deref() == Ok(case.as_str()) {
        let owner = PathBuf::from(std::env::var_os("ZICODE_NOTES_BACKUP_OWNER").unwrap());
        let role = std::env::var("ZICODE_NOTES_BACKUP_ROLE").unwrap();
        assert!(["source", "copy", "archive"].contains(&role.as_str()));
        assert_eq!(
            fs::read_to_string(owner.join("owner.json")).unwrap(),
            "synthetic Notes backup recovery acceptance"
        );
        let profile = owner.join(format!("profile-{role}"));
        let host = start_profile(&profile).await;
        let client = client(&host);
        if role == "source" {
            source(&owner, &host, &client).await;
        } else {
            assert!(!owner.join("profile-source").exists());
            assert!(!owner.join("separate-recovery-code/code.txt").exists());
            let backup: Value = serde_json::from_slice(
                &fs::read(owner.join("independent-backup/notes.json")).unwrap(),
            )
            .unwrap();
            if role == "archive" {
                import_archive(&owner, &host, &client, &backup).await;
            }
            verify_corpus(&owner, &host, &client, &backup, role == "archive").await;
        }
        host.stop_and_wait().await.unwrap();
        return;
    }
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let scratch = scratch.canonicalize().unwrap();
    let owner = scratch.join(format!("notes-backup-recovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&owner).unwrap();
    fs::write(
        owner.join("owner.json"),
        "synthetic Notes backup recovery acceptance",
    )
    .unwrap();
    for role in ["source", "copy", "archive"] {
        if role == "copy" {
            copy_tree(&owner.join("profile-source"), &owner.join("profile-copy"));
            fs::rename(
                owner.join("profile-source"),
                owner.join("retained-original-offline"),
            )
            .unwrap();
            fs::remove_file(owner.join("separate-recovery-code/code.txt")).unwrap();
        }
        let archive = owner.join("independent-backup/notes.json");
        let before = fs::read(&archive).ok().map(Sha256::digest);
        let result = crate::process_command::new_command(std::env::current_exe().unwrap())
            .args(["--exact", &case, "--nocapture"])
            .env("ZICODE_NOTES_BACKUP_CASE", &case)
            .env("ZICODE_NOTES_BACKUP_OWNER", &owner)
            .env("ZICODE_NOTES_BACKUP_ROLE", role)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "isolated role {role} failed:\n{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        if let Some(hash) = before {
            assert_eq!(Sha256::digest(fs::read(&archive).unwrap()), hash);
        }
    }
    assert_eq!(owner.parent(), Some(scratch.as_path()));
    fs::remove_dir_all(owner).unwrap();
}
