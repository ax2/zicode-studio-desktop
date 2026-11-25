use super::{api, oauth::Result, reply};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde_json::Value;
use std::path::Path;
pub(super) fn db(p: &Path) -> Result<Connection> {
    let db = Connection::open_with_flags(
        p,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "gmail_account_unavailable")?;
    db.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "gmail_storage")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS gmail_cache(workspace TEXT NOT NULL, account TEXT NOT NULL, kind TEXT NOT NULL, cache_key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(workspace,account,kind,cache_key));
    CREATE TABLE IF NOT EXISTS gmail_cache_generation(workspace TEXT,account TEXT,generation INTEGER NOT NULL,PRIMARY KEY(workspace,account));
    CREATE TABLE IF NOT EXISTS gmail_delivery(workspace TEXT NOT NULL,account TEXT NOT NULL,draft TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,message_id TEXT,PRIMARY KEY(workspace,account,draft,revision));").map_err(|_|"gmail_storage")?;
    db.execute_batch(reply::SCHEMA).map_err(|_| "gmail_storage")?;
    Ok(db)
}
pub fn address(p: &Path, scope: &str, account: &str) -> Result<String> {
    db(p)?
        .query_row(
            "SELECT address FROM accounts WHERE scope=? AND id=? AND provider='gmail'",
            params![scope, account],
            |r| r.get(0),
        )
        .map_err(|_| "gmail_account_unavailable")
}
pub fn cache_generation(p: &Path, scope: &str, account: &str) -> Result<i64> {
    db(p)?.query_row("SELECT COALESCE((SELECT generation FROM gmail_cache_generation WHERE workspace=? AND account=?),0)",params![scope,account],|r|r.get(0)).map_err(|_|"gmail_storage")
}
pub fn cache(
    p: &Path,
    scope: &str,
    account: &str,
    epoch: i64,
    kind: &str,
    key: &str,
    value: &Value,
) -> Result<()> {
    let written=db(p)?.execute("INSERT INTO gmail_cache SELECT ?1,?2,?3,?4,?5 WHERE ?6=COALESCE((SELECT generation FROM gmail_cache_generation WHERE workspace=?1 AND account=?2),0) ON CONFLICT(workspace,account,kind,cache_key) DO UPDATE SET value=excluded.value",
        params![scope,account,kind,key,value.to_string(),epoch]).map_err(|_|"gmail_storage")?;
    if written == 0 {
        return Err("gmail_cancelled");
    }
    Ok(())
}
pub(super) fn disconnect_local<T>(
    read_credential: impl FnOnce() -> Result<T>,
    clear_cached_mail: impl FnOnce() -> Result<()>,
    delete_credential: impl FnOnce() -> Result<()>,
) -> Result<T> {
    let credential = read_credential()?;
    // A cache error must leave the token available for a later revocation attempt.
    clear_cached_mail()?;
    delete_credential()?;
    Ok(credential)
}
pub fn clear_cache(p: &Path, scope: &str, account: &str) -> Result<()> {
    let mut db = db(p)?;
    let tx = db.transaction().map_err(|_| "gmail_storage")?;
    tx.execute("INSERT INTO gmail_cache_generation VALUES(?,?,1) ON CONFLICT(workspace,account) DO UPDATE SET generation=generation+1",params![scope,account]).map_err(|_|"gmail_storage")?;
    tx.execute(
        "DELETE FROM gmail_cache WHERE workspace=? AND account=?",
        params![scope, account],
    )
    .map_err(|_| "gmail_storage")?;
    tx.commit().map_err(|_| "gmail_storage")
}
pub fn cached(p: &Path, scope: &str, a: &str, kind: &str, key: &str) -> Result<Value> {
    let text:Option<String>=db(p)?.query_row("SELECT value FROM gmail_cache WHERE workspace=? AND account=? AND kind=? AND cache_key=?",params![scope,a,kind,key],|r|r.get(0)).optional().map_err(|_|"gmail_storage")?;
    match text {
        Some(v) => serde_json::from_str(&v).map_err(|_| "gmail_storage"),
        None => Ok(Value::Null),
    }
}

pub fn reply_draft(path: &Path, scope: &str, account: &str, message: &str) -> Result<Value> {
    if !api::valid_id(message) {
        return Err("gmail_invalid");
    }
    let mut db = db(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|_| "gmail_storage")?;
    let metadata: String = tx.query_row(
        "SELECT COALESCE(json_extract(value,'$.reply'),'null') FROM gmail_cache
         WHERE workspace=?1 AND account=?2 AND kind='body' AND cache_key=?3
             AND json_extract(value,'$.id')=?3 AND json_type(value,'$.reply') IS NOT NULL
         UNION ALL
         SELECT COALESCE(json_extract(item.value,'$.reply'),'null') FROM gmail_cache JOIN json_each(gmail_cache.value,'$.items') item
         WHERE workspace=?1 AND account=?2 AND kind='page' AND json_extract(item.value,'$.id')=?3
             AND json_type(item.value,'$.reply') IS NOT NULL
         LIMIT 1",
        params![scope, account, message],
        |row| row.get(0),
    ).optional().map_err(|_| "gmail_storage")?.ok_or("gmail_reply_metadata_missing")?;
    let reply = serde_json::from_str::<Option<reply::Metadata>>(&metadata)
        .map_err(|_| "gmail_storage")?.ok_or("gmail_reply_unavailable")?;
    let id = uuid::Uuid::new_v4().to_string();
    let inserted = tx.execute(
        "INSERT INTO drafts(scope,account,id,revision,recipient,subject,body)
         SELECT ?1,?2,?3,1,?4,?5,'' WHERE EXISTS
            (SELECT 1 FROM accounts WHERE scope=?1 AND id=?2 AND provider='gmail')",
        params![scope, account, id, reply.recipient, reply.subject],
    ).map_err(|_| "gmail_storage")?;
    if inserted != 1 {
        return Err("gmail_account_unavailable");
    }
    tx.execute("INSERT INTO gmail_reply VALUES(?,?,?,?)", params![scope, account, id, metadata])
        .map_err(|_| "gmail_storage")?;
    tx.commit().map_err(|_| "gmail_storage")?;
    Ok(serde_json::json!({"id":id,"revision":1,"recipient":reply.recipient,"subject":reply.subject,"body":"","gmailReply":true}))
}

pub struct Outgoing {
    pub raw: String,
    pub thread: Option<String>,
}

pub fn begin(
    p: &Path,
    scope: &str,
    a: &str,
    from: &str,
    draft: &str,
    revision: i64,
) -> Result<Outgoing> {
    let mut db = db(p)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "gmail_storage")?;
    let (to,subject,body):(String,String,String)=tx.query_row("SELECT recipient,subject,body FROM drafts WHERE scope=? AND account=? AND id=? AND revision=?",params![scope,a,draft,revision],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"gmail_draft_changed")?;
    let original: Option<String> = tx.query_row(
        "SELECT metadata FROM gmail_reply WHERE workspace=? AND account=? AND draft=?",
        params![scope, a, draft], |row| row.get(0),
    ).optional().map_err(|_| "gmail_storage")?;
    let original: Option<reply::Metadata> = original.map(|data| serde_json::from_str(&data))
        .transpose().map_err(|_| "gmail_storage")?;
    let reply = original.filter(|source| source.recipient == to && source.subject == subject);
    let files = studio_alibaba_mail::draft_attachments(&tx, scope, a, draft)?;
    let mime = if files.is_empty() {
        api::mime_message(from, &to, &subject, &body)?
    } else {
        api::validate_message(from, &to, &subject, &body)?;
        let saved = studio_alibaba_mail::StoredDraft { recipient: to, subject, body };
        studio_alibaba_mail::compose_attached(from, &saved, None, files)?.formatted()
    };
    let message = match reply {
        Some(source) => {
            let mime = source.write_headers(mime).ok_or("gmail_invalid_draft")?;
            Outgoing { raw: URL_SAFE_NO_PAD.encode(mime), thread: Some(source.thread) }
        }
        None => Outgoing { raw: URL_SAFE_NO_PAD.encode(mime), thread: None },
    };
    let n=tx.execute("INSERT INTO gmail_delivery(workspace,account,draft,revision,status) VALUES(?,?,?,?,'unknown') ON CONFLICT DO NOTHING",params![scope,a,draft,revision]).map_err(|_|"gmail_storage")?;
    if n == 0 {
        return Err("gmail_attempt_already_recorded");
    }
    tx.commit().map_err(|_| "gmail_storage")?;
    Ok(message)
}
pub fn finish(
    p: &Path,
    scope: &str,
    a: &str,
    draft: &str,
    revision: i64,
    status: &str,
    id: Option<&str>,
) -> Result<()> {
    db(p)?.execute("UPDATE gmail_delivery SET status=?,message_id=? WHERE workspace=? AND account=? AND draft=? AND revision=?",params![status,id,scope,a,draft,revision]).map_err(|_|"gmail_storage")?;
    Ok(())
}
pub fn delivery(p: &Path, scope: &str, a: &str, draft: &str, revision: i64) -> Result<Value> {
    let data=db(p)?.query_row("SELECT status,message_id FROM gmail_delivery WHERE workspace=? AND account=? AND draft=? AND revision=?",params![scope,a,draft,revision],|r|Ok(serde_json::json!({"status":r.get::<_,String>(0)?,"messageId":r.get::<_,Option<String>>(1)?}))).optional().map_err(|_|"gmail_storage")?;
    Ok(data.unwrap_or(Value::Null))
}
