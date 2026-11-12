//! Ordered download history, separate from browsing sessions/cookies.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{mpsc::{sync_channel, SyncSender}, OnceLock}, time::Duration};
type Job = Box<dyn FnOnce(Result<&Connection, String>) + Send>;
static QUEUE: OnceLock<Result<SyncSender<Job>, String>> = OnceLock::new();
fn open(root: &std::path::Path) -> Result<Connection, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let db = Connection::open(root.join("downloads.sqlite3")).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS downloads (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS downloads_owner ON downloads(owner, seq DESC);")
        .map_err(|e| e.to_string())?;
    Ok(db)
}
fn start(root: PathBuf) -> Result<SyncSender<Job>, String> {
    let (sender, receiver) = sync_channel::<Job>(128);
    std::thread::Builder::new().name("browser-downloads".into()).spawn(move || {
        for job in receiver { let store = open(&root); job(store.as_ref().map_err(Clone::clone)); }
    }).map_err(|e| e.to_string())?;
    Ok(sender)
}
fn submit(job: Job) -> Result<(), String> {
    QUEUE.get_or_init(|| start(crate::app_paths::data_root()?.join("browser"))).as_ref().map_err(Clone::clone)?
        .try_send(job).map_err(|_| "Download history is busy or unavailable".into())
}
fn write(db: &Connection, owner: &str, record: &Value) -> Result<(), String> {
    let id = record["id"].as_str().ok_or("Missing download identity")?;
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid download identity")?;
    db.execute("INSERT INTO downloads(owner,id,payload) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE downloads.owner=excluded.owner",
        params![owner, id, record.to_string()]).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn record(owner: String, record: Value, failed: impl FnOnce(String) + Send + 'static) -> Result<(), String> {
    submit(Box::new(move |db| { if let Err(error) = db.and_then(|db| write(db, &owner, &record)) { failed(error); } }))
}
fn page(db: &Connection, owner: &str, before: Option<i64>, query: Option<&str>) -> Result<Value, String> {
    if before.is_some_and(|n| n < 1) { return Err("Invalid download history cursor".into()); }
    let mut statement = db.prepare(
        "SELECT seq,payload FROM downloads
         WHERE owner=?1 AND (?2 IS NULL OR seq<?2)
           AND (?3 IS NULL
             OR instr(lower(json_extract(payload, '$.name')), ?3) > 0
             OR instr(lower(json_extract(payload, '$.url')), ?3) > 0)
         ORDER BY seq DESC LIMIT 101",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map(params![owner, before, query], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
    let mut rows = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let more = rows.len() > 100; rows.truncate(100);
    let next = more.then(|| rows.last().map(|v| v.0)).flatten();
    let entries = rows.into_iter().map(|(_, raw)| serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"entries":entries,"nextBefore":next}))
}
pub async fn list(owner: String, before: Option<i64>, query: Option<String>) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    submit(Box::new(move |db| { let _ = tx.send(db.and_then(|db| page(db, &owner, before, query.as_deref()))); }))?;
    rx.await.map_err(|_| "Download history worker stopped".to_owned())?
}
fn find_completed_path(db: &Connection, owner: &str, id: &str) -> Result<PathBuf, String> {
    use rusqlite::OptionalExtension;

    uuid::Uuid::parse_str(id).map_err(|_| "Invalid download identity")?;
    let record = db
        .query_row(
            "SELECT payload FROM downloads WHERE owner=?1 AND id=?2",
            params![owner, id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or("Download is no longer in this list")?;
    let record: Value = serde_json::from_str(&record).map_err(|error| error.to_string())?;
    if record["state"].as_str() != Some("completed") {
        return Err("Only completed downloads can be shown in File Explorer".into());
    }
    record["path"]
        .as_str()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "The downloaded file is no longer available".into())
}

pub async fn completed_path(owner: String, id: String) -> Result<PathBuf, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    submit(Box::new(move |db| {
        let _ = tx.send(db.and_then(|db| find_completed_path(db, &owner, &id)));
    }))?;
    rx.await.map_err(|_| "Download history worker stopped")?
}

fn delete_record(db: &Connection, owner: &str, id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid download identity")?;
    let changed = db.execute("DELETE FROM downloads WHERE owner=?1 AND id=?2", params![owner, id]).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("Download is no longer in this list".into()); }
    Ok(())
}
pub async fn remove(owner: String, id: String) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // Share the ordered queue so a previously queued terminal update cannot resurrect the row.
    submit(Box::new(move |db| { let _ = tx.send(db.and_then(|db| delete_record(db, &owner, &id))); }))?;
    rx.await.map_err(|_| "Download history worker stopped".to_owned())?
}
pub fn flush() -> Result<(), String> {
    let Some(queue) = QUEUE.get() else { return Ok(()); };
    let (tx, rx) = std::sync::mpsc::channel();
    queue.as_ref().map_err(Clone::clone)?.try_send(Box::new(move |db| { let _ = tx.send(db.map(|_| ())); }))
        .map_err(|_| "Could not queue download history checkpoint")?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "Download history checkpoint timed out")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_is_owner_scoped_persistent_and_keeps_the_downloaded_file() {
        let root = std::env::temp_dir().join(format!("browser-download-removal-{}", uuid::Uuid::new_v4()));
        let db = open(&root).unwrap();
        let file = root.join("download.txt");
        std::fs::write(&file, "保留文件内容").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        write(&db, "a", &json!({"id":id,"state":"completed","path":file})).unwrap();
        write(&db, "b", &json!({"id":other,"state":"cancelled"})).unwrap();
        assert_eq!(find_completed_path(&db, "a", &id).unwrap(), file);
        assert!(find_completed_path(&db, "b", &id).is_err());
        assert!(find_completed_path(&db, "b", &other).is_err());
        assert!(delete_record(&db, "b", &id).is_err());
        assert!(delete_record(&db, "a", "not-an-id").is_err());
        assert_eq!(page(&db,"a",None,None).unwrap()["entries"].as_array().unwrap().len(),1);
        delete_record(&db, "a", &id).unwrap();
        drop(db);
        let db = open(&root).unwrap();
        assert!(page(&db,"a",None,None).unwrap()["entries"].as_array().unwrap().is_empty());
        assert_eq!(page(&db,"b",None,None).unwrap()["entries"][0]["id"],other);
        assert_eq!(std::fs::read_to_string(file).unwrap(),"保留文件内容");
    }
    #[test]
    fn history_survives_reopen_updates_without_duplicates_and_isolates_owners() {
        let root = std::env::temp_dir().join(format!("browser-download-journal-{}", uuid::Uuid::new_v4()));
        let db = open(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        write(&db, "a", &json!({"id":id,"state":"waiting","name":"报告.txt"})).unwrap();
        write(&db, "a", &json!({"id":id,"state":"completed","name":"报告.txt"})).unwrap();
        write(&db, "b", &json!({"id":id,"state":"failed"})).unwrap();
        assert!(page(&db,"b",None,None).unwrap()["entries"].as_array().unwrap().is_empty());
        drop(db);
        let db = open(&root).unwrap();
        let saved = page(&db,"a",None,None).unwrap();
        assert_eq!(saved["entries"].as_array().unwrap().len(),1);
        assert_eq!(saved["entries"][0]["state"],"completed");
        for _ in 0..101 { write(&db,"a",&json!({"id":uuid::Uuid::new_v4().to_string(),"state":"cancelled"})).unwrap(); }
        let first = page(&db,"a",None,None).unwrap();
        let second = page(&db,"a",first["nextBefore"].as_i64(),None).unwrap();
        assert_eq!(first["entries"].as_array().unwrap().len(),100);
        assert_eq!(second["entries"].as_array().unwrap().len(),2);
        assert!(second["nextBefore"].is_null());
    }

    #[test]
    fn search_filters_before_pagination_and_treats_punctuation_literally() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE downloads (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)").unwrap();
        let insert = |owner, name, url| {
            write(&db, owner, &json!({"id":uuid::Uuid::new_v4().to_string(),"name":name,"url":url})).unwrap();
        };
        insert("a", "报告%_Q1.pdf", "https://example.org/archive");
        for _ in 0..101 {
            insert("a", "unrelated", "https://example.org/archive");
            insert("a", "latest", "https://example.org/REPORTS");
        }
        insert("b", "报告%_Q1.pdf", "https://example.org/reports");
        let literal = page(&db, "a", None, Some("%_q1")).unwrap();
        assert_eq!(literal["entries"].as_array().unwrap().len(), 1);
        assert_eq!(literal["entries"][0]["name"], "报告%_Q1.pdf");
        let first = page(&db, "a", None, Some("reports")).unwrap();
        assert_eq!(first["entries"].as_array().unwrap().len(), 100);
        let older = page(&db, "a", first["nextBefore"].as_i64(), Some("reports")).unwrap();
        assert_eq!(older["entries"].as_array().unwrap().len(), 1);
        assert!(older["nextBefore"].is_null());
    }
}
