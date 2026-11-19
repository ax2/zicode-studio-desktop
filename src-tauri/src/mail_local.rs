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
        operate(&root.join("mail.sqlite3"), &scope, request)
    })
    .await
    .map_err(|_| "mail_storage")?
}

fn operate(file: &Path, scope: &str, req: Request) -> Result<Value, String> {
    let db = Connection::open(file).map_err(|_| "mail_storage")?;
    db.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "mail_storage")?;
    db.execute_batch("PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(scope TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,provider,address));
      CREATE TABLE IF NOT EXISTS drafts(scope TEXT NOT NULL,account TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,account,id),FOREIGN KEY(scope,account) REFERENCES accounts(scope,id));").map_err(|_|"mail_storage")?;
    match req {
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
            let rows=q.query_map(params![scope,account],|r| Ok(json!({"id":r.get::<_,String>(0)?,"revision":r.get::<_,i64>(1)?,"recipient":r.get::<_,String>(2)?,"subject":r.get::<_,String>(3)?,"body":r.get::<_,String>(4)?}))).map_err(|_|"mail_storage")?.collect::<Result<Vec<_>,_>>().map_err(|_|"mail_storage")?;
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

#[cfg(test)]
mod tests {
    use super::*;
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
        delete(2).unwrap();
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
