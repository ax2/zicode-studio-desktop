//! Successful top-level visits. Explicit deletion only; no silent retention expiry.
use super::Store;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub visited_at: String,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub entries: Vec<Visit>,
    pub next_before: Option<i64>,
    pub latest_id: i64,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List {
        query: String,
        before: Option<i64>,
    },
    Remove {
        id: i64,
    },
    Clear {
        #[serde(rename = "throughId")]
        through_id: i64,
    },
}
impl Store {
    pub fn record_visit(
        &mut self,
        owner: &str,
        url: &str,
        title: &str,
        at: &str,
    ) -> Result<(), String> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid history URL")?;
        if url.len() > 16384
            || !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Unsupported history URL".into());
        }
        chrono::DateTime::parse_from_rfc3339(at).map_err(|_| "Invalid visit time")?;
        let title: String = title.chars().take(512).collect();
        self.0
            .execute(
                "INSERT INTO browser_history(owner,url,title,visited_at) VALUES(?1,?2,?3,?4)",
                params![owner, url, title, at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn history(&mut self, owner: &str, request: Request) -> Result<Page, String> {
        match request {
            Request::List { query, before } => self.history_page(owner, &query, before),
            Request::Remove { id } => {
                if id <= 0 {
                    return Err("Invalid history entry".into());
                }
                self.0
                    .execute(
                        "DELETE FROM browser_history WHERE owner=?1 AND id=?2",
                        params![owner, id],
                    )
                    .map_err(|e| e.to_string())?;
                self.history_page(owner, "", None)
            }
            Request::Clear { through_id } => {
                if through_id < 0 {
                    return Err("Invalid history boundary".into());
                }
                self.0
                    .execute(
                        "DELETE FROM browser_history WHERE owner=?1 AND id<=?2",
                        params![owner, through_id],
                    )
                    .map_err(|e| e.to_string())?;
                self.history_page(owner, "", None)
            }
        }
    }
    fn history_page(&self, owner: &str, query: &str, before: Option<i64>) -> Result<Page, String> {
        if query.len() > 1024 || before.is_some_and(|id| id <= 0) {
            return Err("Invalid history search".into());
        }
        // Escape SQL LIKE metacharacters; ! avoids Rust/SQL backslash ambiguity.
        let pattern = format!(
            "%{}%",
            query
                .replace('!', "!!")
                .replace('%', "!%")
                .replace('_', "!_")
        );
        let tx = self.0.unchecked_transaction().map_err(|e| e.to_string())?;
        let latest_id = tx
            .query_row(
                "SELECT COALESCE(MAX(id),0) FROM browser_history WHERE owner=?1",
                [owner],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut statement = tx.prepare("SELECT id,url,title,visited_at FROM browser_history WHERE owner=?1 AND (?2 IS NULL OR id<?2) AND (url LIKE ?3 ESCAPE '!' OR title LIKE ?3 ESCAPE '!') ORDER BY id DESC LIMIT 51").map_err(|e|e.to_string())?;
        let rows = statement
            .query_map(params![owner, before, pattern], |r| {
                Ok(Visit {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    title: r.get(2)?,
                    visited_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut entries = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let next_before = if entries.len() > 50 {
            entries.truncate(50);
            entries.last().map(|v| v.id)
        } else {
            None
        };
        Ok(Page {
            entries,
            next_before,
            latest_id,
        })
    }
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
