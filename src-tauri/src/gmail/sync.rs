use super::{api, oauth::Result, store};
use reqwest::Client;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashSet},
    path::Path,
};

// Page-shaped member records keep older versions of the local search index readable.
const LABEL_PAGES: &str =
    "((?3='INBOX' AND cache_key NOT GLOB 'label:*') OR instr(cache_key,'label:'||?3||':')=1)";
pub struct Snapshot {
    pub page: Value,
    previous: Option<String>,
    checkpoint: Option<String>,
    rebuild: bool,
    updates: Vec<(String, api::Membership)>,
}

fn checkpoint(path: &Path, scope: &str, account: &str, label: &str) -> Result<Option<String>> {
    Ok(store::cached(path, scope, account, "history", label)?
        .as_str()
        .map(str::to_owned))
}
fn saved_ids(path: &Path, scope: &str, account: &str, label: &str) -> Result<BTreeSet<String>> {
    let db = store::db(path)?;
    let mut sql=db.prepare(&format!("SELECT DISTINCT json_extract(member.value,'$.id') FROM gmail_cache JOIN json_each(gmail_cache.value,'$.items') member WHERE workspace=?1 AND account=?2 AND kind='page' AND {LABEL_PAGES}")).map_err(|_|"gmail_storage")?;
    let ids = sql
        .query_map(params![scope, account, label], |r| r.get(0))
        .map_err(|_| "gmail_storage")?;
    ids.collect::<rusqlite::Result<_>>()
        .map_err(|_| "gmail_storage")
}

pub struct CachedLabel<'a> {
    pub path: &'a Path,
    pub scope: &'a str,
    pub account: &'a str,
    pub label: &'a str,
}

pub async fn fetch(
    client: &Client,
    base: &str,
    token: &str,
    folder: CachedLabel<'_>,
    cursor: Option<&str>,
    limit: u8,
) -> Result<Snapshot> {
    let CachedLabel {
        path,
        scope,
        account,
        label,
    } = folder;
    let previous = checkpoint(path, scope, account, label)?;
    let mut next = None;
    let mut rebuild = false;
    let mut expired = false;
    let mut ids = BTreeSet::new();
    if cursor.is_none() {
        if let Some(start) = &previous {
            match api::changes(client, base, token, start, label).await {
                Ok((end, changed)) => {
                    next = Some(end);
                    ids = changed;
                }
                Err("gmail_not_found") => expired = true,
                Err(error) => return Err(error),
            }
        }
        if next.is_none() {
            // Capture before listing, so subsequent history includes concurrent arrivals.
            next = Some(api::latest_history(client, base, token).await?);
            ids = saved_ids(path, scope, account, label)?;
            rebuild = true;
        }
    }
    let page = api::list(client, base, token, label, cursor, limit).await?;
    let mut updates = Vec::new();
    if expired {
        let mut token_page = page["nextCursor"].as_str().map(str::to_owned);
        let mut seen = HashSet::new();
        while let Some(p) = token_page {
            if !seen.insert(p.clone()) {
                return Err("gmail_invalid_response");
            }
            let older = api::list(client, base, token, label, Some(&p), 30).await?;
            for item in older["items"].as_array().ok_or("gmail_invalid_response")? {
                let id = item["id"].as_str().ok_or("gmail_invalid_response")?;
                ids.remove(id);
                updates.push((id.to_owned(), api::Membership::Present(item.clone())));
            }
            token_page = older["nextCursor"].as_str().map(str::to_owned);
        }
    }
    for item in page["items"].as_array().ok_or("gmail_invalid_response")? {
        ids.remove(item["id"].as_str().ok_or("gmail_invalid_response")?);
    }
    updates.extend(api::membership(client, base, token, label, ids).await?);
    Ok(Snapshot {
        page,
        previous,
        checkpoint: next,
        rebuild,
        updates,
    })
}

pub fn apply(
    path: &Path,
    scope: &str,
    account: &str,
    label: &str,
    epoch: i64,
    key: &str,
    snapshot: &Snapshot,
) -> Result<()> {
    if snapshot.previous.is_none() && snapshot.checkpoint.is_none() {
        return store::cache(path, scope, account, epoch, "page", key, &snapshot.page);
    }
    let mut db = store::db(path)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| "gmail_storage")?;
    let current:i64=tx.query_row("SELECT COALESCE((SELECT generation FROM gmail_cache_generation WHERE workspace=? AND account=?),0)",params![scope,account],|r|r.get(0)).map_err(|_|"gmail_storage")?;
    let previous:Option<String>=tx.query_row("SELECT json_extract(value,'$') FROM gmail_cache WHERE workspace=? AND account=? AND kind='history' AND cache_key=?",params![scope,account,label],|r|r.get(0)).optional().map_err(|_|"gmail_storage")?;
    if epoch != current || previous != snapshot.previous {
        return Err("gmail_cancelled");
    }
    if snapshot.rebuild {
        tx.execute(&format!("DELETE FROM gmail_cache WHERE workspace=?1 AND account=?2 AND kind='page' AND {LABEL_PAGES}"),params![scope,account,label]).map_err(|_|"gmail_storage")?;
    }
    let prefix = if label == "INBOX" {
        "member:".into()
    } else {
        format!("label:{label}:member:")
    };
    let save = |id: &str, m: &Value| -> Result<()> {
        tx.execute("INSERT INTO gmail_cache VALUES(?,?,'page',?,?) ON CONFLICT(workspace,account,kind,cache_key) DO UPDATE SET value=excluded.value",
            params![scope,account,format!("{prefix}{id}"),json!({"items":[m]}).to_string()]).map_err(|_|"gmail_storage")?;
        Ok(())
    };
    for (id, membership) in &snapshot.updates {
        if let api::Membership::Present(m) = membership {
            save(id, m)?;
        } else {
            tx.execute("DELETE FROM gmail_cache WHERE workspace=? AND account=? AND kind='page' AND cache_key=?",params![scope,account,format!("{prefix}{id}")]).map_err(|_|"gmail_storage")?;
            if matches!(membership, api::Membership::Deleted) {
                // Gmail message IDs belong to an account. A confirmed deletion also
                // invalidates copies in other labels, including legacy multi-item pages.
                tx.execute(
                    "DELETE FROM gmail_cache WHERE workspace=?1 AND account=?2 AND kind='page' AND
                    (cache_key='member:'||?3 OR cache_key GLOB 'label:*:member:'||?3)",
                    params![scope, account, id],
                )
                .map_err(|_| "gmail_storage")?;
                tx.execute("UPDATE gmail_cache SET value=json_set(value,'$.items',
                    (SELECT json_group_array(json(m.value)) FROM json_each(gmail_cache.value,'$.items') m WHERE json_extract(m.value,'$.id')<>?3))
                    WHERE workspace=?1 AND account=?2 AND kind='page' AND EXISTS
                    (SELECT 1 FROM json_each(gmail_cache.value,'$.items') m WHERE json_extract(m.value,'$.id')=?3)", params![scope,account,id]).map_err(|_|"gmail_storage")?;
                tx.execute("DELETE FROM gmail_cache WHERE workspace=? AND account=? AND kind='body' AND cache_key=?",params![scope,account,id]).map_err(|_|"gmail_storage")?;
            }
        }
    }
    for m in snapshot.page["items"]
        .as_array()
        .ok_or("gmail_invalid_response")?
    {
        save(m["id"].as_str().ok_or("gmail_invalid_response")?, m)?;
    }
    if let Some(end) = &snapshot.checkpoint {
        tx.execute("INSERT INTO gmail_cache VALUES(?,?,'history',?,?) ON CONFLICT(workspace,account,kind,cache_key) DO UPDATE SET value=excluded.value",params![scope,account,label,json!(end).to_string()]).map_err(|_|"gmail_storage")?;
    }
    tx.commit().map_err(|_| "gmail_storage")
}

pub fn offline_page(
    path: &Path,
    scope: &str,
    account: &str,
    label: &str,
    cursor: Option<&str>,
    limit: u8,
    legacy_key: &str,
) -> Result<Value> {
    if checkpoint(path, scope, account, label)?.is_none() {
        return store::cached(path, scope, account, "page", legacy_key);
    }
    let prefix = format!("offline:{label}:");
    let boundary = cursor
        .map(|cursor| -> Result<(i64, &str)> {
            let (date, id) = cursor
                .strip_prefix(&prefix)
                .and_then(|v| v.split_once(':'))
                .ok_or("gmail_invalid")?;
            if !api::valid_id(id) {
                return Err("gmail_invalid");
            }
            Ok((date.parse().map_err(|_| "gmail_invalid")?, id))
        })
        .transpose()?;
    let db = store::db(path)?;
    let sql=format!("SELECT item FROM (SELECT json_extract(value,'$.items[0]') AS item FROM gmail_cache
        WHERE workspace=?1 AND account=?2 AND kind='page' AND {LABEL_PAGES})
        WHERE ?5 IS NULL OR (json_extract(item,'$.internalDate'),json_extract(item,'$.id')) < (?5,?6)
        ORDER BY json_extract(item,'$.internalDate') DESC,json_extract(item,'$.id') DESC LIMIT ?4");
    let mut stmt = db.prepare(&sql).map_err(|_| "gmail_storage")?;
    let rows = stmt
        .query_map(
            params![
                scope,
                account,
                label,
                u32::from(limit) + 1,
                boundary.map(|b| b.0),
                boundary.map(|b| b.1)
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| "gmail_storage")?;
    let mut items = Vec::new();
    for row in rows {
        items.push(
            serde_json::from_str::<Value>(&row.map_err(|_| "gmail_storage")?)
                .map_err(|_| "gmail_storage")?,
        );
    }
    let more = items.len() > usize::from(limit);
    items.truncate(usize::from(limit));
    let next = if more {
        let tail = items.last().ok_or("gmail_storage")?;
        Some(format!(
            "{prefix}{}:{}",
            tail["internalDate"].as_i64().ok_or("gmail_storage")?,
            tail["id"].as_str().ok_or("gmail_storage")?
        ))
    } else {
        None
    };
    Ok(json!({"items":items,"nextCursor":next}))
}
