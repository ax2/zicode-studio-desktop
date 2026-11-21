use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Accounts,
    PickAttachment { account: String, id: String, revision: i64 },
    RemoveAttachment { account: String, id: String, revision: i64, attachment: String },
    Search { account: Option<String>, label: Option<String>, query: String, offset: u32 },
    Add {
        provider: String,
        address: String,
    },
    Drafts {
        account: String,
    },
    Save {
        account: String,
        id: Option<String>,
        revision: i64,
        recipient: String,
        subject: String,
        body: String,
    },
    Delete {
        account: String,
        id: String,
        revision: i64,
    },
}

#[tauri::command]
pub(crate) async fn mail_local(window: WebviewWindow, request: Request) -> Result<Value, String> {
    crate::require_workspace_window(&window)?;
    let windows = window
        .try_state::<crate::WindowWorkspaceState>()
        .ok_or("mail_unavailable")?;
    let scope = windows
        .0
        .lock()
        .map_err(|_| "mail_unavailable")?
        .get(window.label())
        .cloned()
        .ok_or("mail_unavailable")?;
    let root = crate::app_paths::data_root()?.join("mail");
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&root).map_err(|_| "mail_storage")?;
        let path = root.join("mail.sqlite3");
        if let Request::PickAttachment { account, id, revision } = request {
            use std::io::Read;
            use tauri_plugin_dialog::DialogExt;
            let Some(selected) = window.app_handle().dialog().file().set_parent(&window).blocking_pick_file() else {
                return Ok(json!({"changed":false}));
            };
            crate::resource_export_picker::context(&window, &scope)?;
            let source = selected.into_path().map_err(|_| "mail_attachment_read")?;
            let name = source.file_name().and_then(|n| n.to_str()).ok_or("mail_attachment_read")?.to_owned();
            if name.chars().any(char::is_control) { return Err("mail_invalid".into()); }
            let file = std::fs::File::open(source).map_err(|_| "mail_attachment_read")?;
            if !file.metadata().map_err(|_| "mail_attachment_read")?.is_file() { return Err("mail_attachment_read".into()); }
            let mut bytes = Vec::new();
            file.take(MAX_DRAFT_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "mail_attachment_read")?;
            if bytes.len() as u64 > MAX_DRAFT_BYTES { return Err("mail_attachment_too_large".into()); }
            crate::resource_export_picker::context(&window, &scope)?;
            return attach_file(&path, &scope, &account, &id, revision, &name, bytes);
        }
        operate(&path, &scope, request)
    })
    .await
    .map_err(|_| "mail_storage")?
}

const MAX_DRAFT_BYTES: u64 = 16 * 1024 * 1024;

fn attach_file(path: &Path, scope: &str, account: &str, id: &str, revision: i64, name: &str, bytes: Vec<u8>) -> Result<Value, String> {
    let mut db = open_mail(path)?;
    let tx = db.transaction().map_err(|_| "mail_storage")?;
    advance_revision(&tx, scope, account, id, revision)?;
    let total: u64 = tx.query_row("SELECT COALESCE(SUM(length(content)),0) FROM draft_attachments WHERE scope=? AND account=? AND draft=?", params![scope,account,id], |row| row.get(0)).map_err(|_| "mail_storage")?;
    if total + bytes.len() as u64 > MAX_DRAFT_BYTES { return Err("mail_attachment_too_large".into()); }
    tx.execute("INSERT INTO draft_attachments(scope,account,draft,id,name,content) VALUES(?,?,?,?,?,?)",params![scope,account,id,Uuid::new_v4().to_string(),name,bytes]).map_err(|_| "mail_storage")?;
    tx.commit().map_err(|_| "mail_storage")?;
    Ok(json!({"changed":true,"revision":revision+1}))
}

fn advance_revision(db: &Connection, scope: &str, account: &str, id: &str, revision: i64) -> Result<(), String> {
    if db.execute("UPDATE drafts SET revision=revision+1 WHERE scope=? AND account=? AND id=? AND revision=?",params![scope,account,id,revision]).map_err(|_| "mail_storage")? != 1 {
        return Err("mail_conflict".into());
    }
    Ok(())
}

fn open_mail(file: &Path) -> Result<Connection, String> {
    let db = Connection::open(file).map_err(|_| "mail_storage")?;
    db.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "mail_storage")?;
    db.execute_batch("PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(scope TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,provider,address));
      CREATE TABLE IF NOT EXISTS drafts(scope TEXT NOT NULL,account TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,account,id),FOREIGN KEY(scope,account) REFERENCES accounts(scope,id));").map_err(|_|"mail_storage")?;
    db.execute_batch(studio_alibaba_mail::DRAFT_ATTACHMENT_SCHEMA)
        .map_err(|_| "mail_storage")?;
    Ok(db)
}

fn operate(file: &Path, scope: &str, req: Request) -> Result<Value, String> {
    let mut db = open_mail(file)?;
    match req {
        Request::PickAttachment { .. } => Err("mail_invalid".into()),
        Request::RemoveAttachment { account,id,revision,attachment } => {
            let tx = db.transaction().map_err(|_| "mail_storage")?;
            advance_revision(&tx, scope, &account, &id, revision)?;
            if tx.execute("DELETE FROM draft_attachments WHERE scope=? AND account=? AND draft=? AND id=?", params![scope,account,id,attachment]).map_err(|_| "mail_storage")? != 1 {
                return Err("mail_attachment_missing".into());
            }
            tx.commit().map_err(|_| "mail_storage")?;
            Ok(json!({"changed":true,"revision":revision+1}))
        }
        Request::Search { account, label, query, offset } => search_cache(&mut db, scope, account.as_deref(), label.as_deref(), &query, offset),
        Request::Accounts => {
            let mut q=db.prepare("SELECT id,provider,address FROM accounts WHERE scope=? ORDER BY address,provider").map_err(|_|"mail_storage")?;
            let rows=q.query_map([scope],|r| Ok(json!({"id":r.get::<_,String>(0)?,"provider":r.get::<_,String>(1)?,"address":r.get::<_,String>(2)?}))).map_err(|_|"mail_storage")?.collect::<Result<Vec<_>,_>>().map_err(|_|"mail_storage")?;
            Ok(json!(rows))
        }
        Request::Add { provider, address } => {
            let address = address.trim().to_ascii_lowercase();
            if !matches!(provider.as_str(), "gmail" | "alibaba")
                || address.len() > 254
                || !address
                    .split_once('@')
                    .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty() && !b.contains('@'))
                || address.chars().any(|c| c.is_control() || c.is_whitespace())
            {
                return Err("mail_invalid".into());
            }
            let id = Uuid::new_v4().to_string();
            let n=db.execute("INSERT INTO accounts VALUES(?,?,?,?) ON CONFLICT(scope,provider,address) DO NOTHING",params![scope,id,provider,address]).map_err(|_|"mail_storage")?;
            if n == 0 {
                return Err("mail_duplicate".into());
            }
            Ok(json!({"id":id}))
        }
        Request::Drafts { account } => {
            let mut q=db.prepare("SELECT id,revision,recipient,subject,body FROM drafts WHERE scope=? AND account=? ORDER BY rowid DESC").map_err(|_|"mail_storage")?;
            let mut attachments = db.prepare("SELECT id,name,length(content) FROM draft_attachments WHERE scope=? AND account=? AND draft=? ORDER BY rowid").map_err(|_| "mail_storage")?;
            let rows = q.query_map(params![scope, account], |r| {
                let id: String = r.get(0)?;
                let files = attachments.query_map(params![scope, account, id], |file| {
                    Ok(json!({"id": file.get::<_,String>(0)?, "name": file.get::<_,String>(1)?, "size": file.get::<_,i64>(2)?}))
                })?.collect::<Result<Vec<_>,_>>()?;
                Ok(json!({"id": id, "revision": r.get::<_,i64>(1)?, "recipient": r.get::<_,String>(2)?, "subject": r.get::<_,String>(3)?, "body": r.get::<_,String>(4)?, "attachments": files}))
            }).map_err(|_| "mail_storage")?.collect::<Result<Vec<_>,_>>().map_err(|_| "mail_storage")?;
            Ok(json!(rows))
        }
        Request::Save {
            account,
            id,
            revision,
            recipient,
            subject,
            body,
        } => {
            if recipient.len() > 4096 || subject.len() > 4096 || body.len() > 1_048_576 {
                return Err("mail_invalid".into());
            }
            let id = match id {
                Some(id) => {
                    let n=db.execute("UPDATE drafts SET recipient=?,subject=?,body=?,revision=revision+1 WHERE scope=? AND account=? AND id=? AND revision=?",params![recipient,subject,body,scope,account,id,revision]).map_err(|_|"mail_storage")?;
                    if n == 0 {
                        return Err("mail_conflict".into());
                    }
                    id
                }
                None => {
                    if revision != 0 {
                        return Err("mail_invalid".into());
                    }
                    let id = Uuid::new_v4().to_string();
                    db.execute(
                        "INSERT INTO drafts VALUES(?,?,?,1,?,?,?)",
                        params![scope, account, id, recipient, subject, body],
                    )
                    .map_err(|_| "mail_storage")?;
                    id
                }
            };
            Ok(json!({"id":id,"revision":revision+1}))
        }
        Request::Delete {
            account,
            id,
            revision,
        } => {
            if db
                .execute(
                    "DELETE FROM drafts WHERE scope=? AND account=? AND id=? AND revision=?",
                    params![scope, account, id, revision],
                )
                .map_err(|_| "mail_storage")?
                == 0
            {
                return Err("mail_conflict".into());
            }
            Ok(Value::Null)
        }
    }
}

fn search_cache(db: &mut Connection, scope: &str, account: Option<&str>, label: Option<&str>, query: &str, offset: u32) -> Result<Value, String> {
    let query = query.trim();
    if label.is_some() && account.is_none() || query.is_empty() || query.len() > 512 {
        return Err("mail_invalid".into());
    }
    let mut sources = Vec::new();
    for (table, sql) in [
        ("gmail_cache", include_str!("mail_search_gmail.sql")),
        ("alibaba_inbox", include_str!("mail_search_alibaba.sql")),
    ] {
        let present: bool = db.query_row("SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [table], |row| row.get(0)).map_err(|_| "mail_storage")?;
        if present {
            if table == "alibaba_inbox" { studio_alibaba_mail::initialize_cache(db)?; }
            sources.push(sql);
        }
    }
    if sources.is_empty() {
        return Ok(json!({"items": [], "more": false}));
    }
    let sql = format!("SELECT account, address, provider, id, epoch, subject, sender, folder FROM ({}) ORDER BY address, account, folder, id, epoch LIMIT 41 OFFSET ?4", sources.join(" UNION ALL "));
    let mut statement = db.prepare(&sql).map_err(|_| "mail_storage")?;
    let mut items = statement.query_map(params![scope, account, query, offset, label], |r| Ok(json!({
        "account": r.get::<_, String>(0)?, "address": r.get::<_, String>(1)?,
        "provider": r.get::<_, String>(2)?, "id": r.get::<_, String>(3)?,
        "epoch": r.get::<_, Option<u32>>(4)?, "subject": r.get::<_, String>(5)?,
        "sender": r.get::<_, String>(6)?, "folder": r.get::<_, Option<String>>(7)?,
    }))).map_err(|_| "mail_storage")?.collect::<Result<Vec<_>,_>>().map_err(|_| "mail_storage")?;
    let more = items.len() > 40;
    items.truncate(40);
    Ok(json!({"items":items, "more":more}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_reopens_both_provider_caches_with_workspace_and_uidvalidity_boundaries() {
        let temp = std::env::temp_dir().join(format!("mail-search-{}", Uuid::new_v4()));
        std::fs::create_dir(&temp).unwrap();
        let file = temp.join("mail.sqlite3");
        operate(&file, "main", Request::Accounts).unwrap();
        let search = |scope: &str, account: Option<&str>, query: &str| {
            operate(&file, scope, Request::Search {
                account: account.map(str::to_owned), label: None, query: query.into(), offset: 0
            }).unwrap()["items"].as_array().unwrap().clone()
        };
        assert!(search("main", None, "%_").is_empty());
        let db = Connection::open(&file).unwrap();
        db.execute_batch(r#"INSERT INTO accounts VALUES ('main','a','alibaba','a@example.test'),('main','b','gmail','b@example.test'),('other','b','gmail','hidden@example.test');
          CREATE TABLE gmail_cache(workspace TEXT, account TEXT, kind TEXT, cache_key TEXT,value TEXT);
          CREATE TABLE alibaba_inbox(scope TEXT,account TEXT,epoch INTEGER,uid INTEGER,meta TEXT,body TEXT);
          CREATE TABLE alibaba_epoch(scope TEXT,account TEXT,epoch INTEGER);
          INSERT INTO alibaba_epoch VALUES ('main','a',7);
          INSERT INTO alibaba_inbox VALUES ('main','a',7,42,'{"subject":"same","sender":"Alice"}','中文 %_'),('main','a',3,42,'{"subject":"stale","sender":"Alice"}','中文 %_');
          INSERT INTO gmail_cache VALUES ('main','b','page','one','{"items":[{"id":"42","subject":"same prior title","from":"Bob","snippet":"preview"}]}'),('main','b','body','42','{"id":"42","subject":"same","from":"Bob","plainText":"中文 %_"}'),('other','b','body','42','{"id":"42","subject":"private","from":"Bob","plainText":"other"}');"#).unwrap();
        drop(db);
        assert_eq!(search("main", None, "SAME").len(), 2);
        assert_eq!(search("main", Some("b"), "SAME")[0]["subject"], "same");
        assert_eq!(search("main", None, "中文").len(), 2);
        assert_eq!(search("main", Some("a"), "%_")[0]["epoch"], 7);
        assert_eq!(search("main", Some("b"), "preview")[0]["id"], "42");
        assert_eq!(search("main", None, "bob").len(), 1);
        assert!(search("main", None, "private").is_empty());
        assert!(search("main", None, "stale").is_empty());
        assert!(search("other", Some("a"), "same").is_empty());
        Connection::open(&file).unwrap().execute(
            "INSERT INTO gmail_cache VALUES ('main','b','page','label:Label_42:20:',?1)",
            [json!({"items":[{"id":"42","subject":"invoice"}]}).to_string()],
        ).unwrap();
        let in_label = |account: &str, label: &str| operate(&file, "main", Request::Search {
            account: Some(account.into()), label: Some(label.into()), query: "中文".into(), offset: 0,
        }).unwrap()["items"].as_array().unwrap().clone();
        assert_eq!(in_label("b", "Label_42")[0]["id"], "42");
        assert_eq!(in_label("b", "INBOX").len(), 1);
        assert!(in_label("b", "Label_4").is_empty());
        assert!(in_label("a", "Label_42").is_empty());
        let db = Connection::open(&file).unwrap();
        db.execute_batch("INSERT INTO alibaba_epoch(scope,account,folder,epoch) VALUES ('main','a','Archive',7);
            INSERT INTO alibaba_inbox(scope,account,folder,epoch,uid,meta,body)
              SELECT scope,account,'Archive',epoch,uid,meta,body FROM alibaba_inbox WHERE folder='INBOX' AND epoch=7;").unwrap();
        drop(db);
        assert_eq!(in_label("a","Archive")[0]["folder"], "Archive");
        assert_eq!(in_label("a","INBOX")[0]["folder"], "INBOX");
        assert_eq!(search("main",Some("a"),"中文").len(), 2);
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(temp).unwrap();
    }
    #[test]
    fn independent_accounts_restart_conflict_delete_and_profile() {
        let dir = std::env::temp_dir().join(format!("studio-mail-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let p = dir.join("local.sqlite");
        let acct = |scope, provider: &str| {
            operate(
                &p,
                scope,
                Request::Add {
                    provider: provider.into(),
                    address: "me@example.test".into(),
                },
            )
            .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let a = acct("one", "gmail");
        let b = acct("one", "alibaba");
        let c = acct("two", "gmail");
        let change = |scope, account: &str, id: Option<String>, revision, body: &str| {
            operate(
                &p,
                scope,
                Request::Save {
                    account: account.into(),
                    id,
                    revision,
                    recipient: "friend@example.test".into(),
                    subject: "hello".into(),
                    body: body.into(),
                },
            )
        };
        let saved = change("one", &a, None, 0, "邮件正文").unwrap();
        let id = saved["id"].as_str().unwrap().to_string();
        let list = |scope, account: &str| {
            operate(
                &p,
                scope,
                Request::Drafts {
                    account: account.into(),
                },
            )
            .unwrap()
        };
        assert_eq!(list("one", &a)[0]["body"], "邮件正文");
        assert_eq!(list("one", &b), json!([]));
        assert_eq!(list("two", &c), json!([]));
        assert_eq!(list("two", &a), json!([]));
        assert!(change("one", &b, Some(id.clone()), 1, "wrong").is_err());
        assert!(change("two", &a, None, 0, "wrong").is_err());
        assert_eq!(
            change("one", &a, Some(id.clone()), 1, "updated").unwrap()["revision"],
            2
        );
        assert!(change("one", &a, Some(id.clone()), 1, "stale").is_err());
        let delete = |rev| {
            operate(
                &p,
                "one",
                Request::Delete {
                    account: a.clone(),
                    id: id.clone(),
                    revision: rev,
                },
            )
        };
        assert!(delete(1).is_err());
        assert_eq!(list("one", &a)[0]["body"], "updated");
        attach_file(&p, "one", &a, &id, 2, "proof.bin", vec![0, 255]).unwrap();
        let reopened = list("one", &a);
        let file = &reopened[0]["attachments"][0];
        assert_eq!(file["name"], "proof.bin");
        assert_eq!(file["size"], 2);
        let remove = |account: &str, revision, attachment: &str| operate(&p, "one", Request::RemoveAttachment {
            account:account.into(), id:id.clone(), revision, attachment:attachment.into()
        });
        let attachment = file["id"].as_str().unwrap();
        assert!(remove(&b, 3, attachment).is_err());
        assert!(remove(&a, 2, attachment).is_err());
        assert!(remove(&a, 3, "missing").is_err());
        assert_eq!(list("one", &a), reopened);
        assert_eq!(remove(&a, 3, attachment).unwrap()["revision"], 4);
        assert_eq!(list("one", &a)[0]["attachments"], json!([]));
        delete(4).unwrap();
        assert_eq!(list("one", &a), json!([]));
        assert_eq!(
            operate(
                &dir.join("another-profile.sqlite"),
                "one",
                Request::Accounts
            )
            .unwrap(),
            json!([])
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
