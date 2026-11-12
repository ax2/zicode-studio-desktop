//! Draft text is stored separately from character revisions until explicit approval.
use super::{
    characters::{self, Facet},
    Result,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS novel_character_draft(
    id TEXT NOT NULL UNIQUE CHECK(length(id)=36), character_id TEXT NOT NULL REFERENCES character(id),
    facet TEXT NOT NULL CHECK(facet IN ('identity','appearance','style')), base_version INTEGER,
    evidence TEXT NOT NULL, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
    approved_version INTEGER,
    UNIQUE(character_id,facet,approved_version),
    FOREIGN KEY(character_id,facet,base_version) REFERENCES character_revision(character_id,facet,version),
    FOREIGN KEY(character_id,facet,approved_version) REFERENCES character_revision(character_id,facet,version)
);
CREATE INDEX IF NOT EXISTS novel_character_draft_history ON novel_character_draft(character_id);";

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Evidence {
    pub(super) workspace_id: String,
    pub(super) notebook_id: String,
    pub(super) chapter_id: String,
    pub(super) chapter_title: String,
    pub(super) revision: String,
    pub(super) line: usize,
    pub(super) quote: String,
}

pub(super) struct Chapter<'a> {
    pub(super) workspace_id: &'a str,
    pub(super) notebook_id: &'a str,
    pub(super) id: &'a str,
    pub(super) title: &'a str,
    pub(super) revision: &'a str,
    pub(super) body: &'a str,
}

impl Chapter<'_> {
    fn evidence(&self, line: usize, quote: &str) -> Evidence {
        Evidence {
            workspace_id: self.workspace_id.into(),
            notebook_id: self.notebook_id.into(),
            chapter_id: self.id.into(),
            chapter_title: self.title.into(),
            revision: self.revision.into(),
            line,
            quote: quote.into(),
        }
    }

    pub(super) fn excerpts(&self, phrase: &str) -> Result<Vec<Evidence>> {
        let phrase = characters::name(phrase)?;
        Ok(self
            .body
            .lines()
            .enumerate()
            .filter_map(|(index, raw)| {
                let quote = raw.trim();
                (quote.contains(phrase) && quote.chars().take(1201).count() <= 1200)
                    .then(|| self.evidence(index + 1, quote))
            })
            .take(8)
            .collect())
    }

    pub(super) fn verify(&self, evidence: &Evidence) -> Result<()> {
        let same_revision = self.workspace_id == evidence.workspace_id
            && self.notebook_id == evidence.notebook_id
            && self.id == evidence.chapter_id
            && self.title == evidence.chapter_title
            && self.revision == evidence.revision;
        let exact_line = evidence
            .line
            .checked_sub(1)
            .and_then(|index| self.body.lines().nth(index))
            .map(str::trim);
        if !same_revision
            || exact_line != Some(evidence.quote.as_str())
            || !valid_evidence(evidence)
        {
            return Err("visual_assets_chapter_changed".into());
        }
        Ok(())
    }
}

fn valid_evidence(evidence: &Evidence) -> bool {
    (1..=1024 * 1024).contains(&evidence.line)
        && !evidence.quote.is_empty()
        && evidence.quote.chars().take(1201).count() <= 1200
        && !evidence.quote.contains(['\0', '\n', '\r'])
        && evidence
            .revision
            .strip_prefix("sha256:")
            .is_some_and(|digest| {
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
        && [
            &evidence.workspace_id,
            &evidence.notebook_id,
            &evidence.chapter_id,
            &evidence.chapter_title,
            &evidence.revision,
        ]
        .iter()
        .all(|value| {
            !value.is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Proposal {
    pub(super) draft_id: Uuid,
    pub(super) character_id: String,
    pub(super) facet: Facet,
    pub(super) base_version: Option<i64>,
    pub(super) evidence: Evidence,
    pub(super) text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Draft {
    pub(super) id: String,
    pub(super) character_id: String,
    pub(super) facet: Facet,
    pub(super) base_version: Option<i64>,
    pub(super) evidence: Evidence,
    pub(super) text: String,
    pub(super) approved_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) model: Option<super::novel_model_source::Summary>,
    #[serde(skip)]
    cursor: i64,
}

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='novel_character_draft'")?
        .exists([])
}

const COLUMNS: &str = "id,character_id,facet,base_version,evidence,text,approved_version,rowid";

fn decode(row: &Row<'_>) -> rusqlite::Result<Draft> {
    let evidence: String = row.get(4)?;
    let evidence: Evidence =
        serde_json::from_str(&evidence).map_err(|_| rusqlite::Error::InvalidQuery)?;
    if !valid_evidence(&evidence) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(Draft {
        id: row.get(0)?,
        character_id: row.get(1)?,
        facet: Facet::from_key(&row.get::<_, String>(2)?)?,
        base_version: row.get(3)?,
        evidence,
        text: row.get(5)?,
        approved_version: row.get(6)?,
        model: None,
        cursor: row.get(7)?,
    })
}

pub(super) fn get(db: &Connection, id: Uuid) -> Result<Option<Draft>> {
    if !schema_present(db)? {
        return Ok(None);
    }
    let mut draft = db
        .query_row(
            &format!("SELECT {COLUMNS} FROM novel_character_draft WHERE id=?1"),
            [id.to_string()],
            decode,
        )
        .optional()?;
    if let Some(draft) = draft.as_mut() {
        draft.model = super::novel_model_archive::summary(db, draft)?;
    }
    Ok(draft)
}

pub(super) fn list(
    db: &Connection,
    id: &str,
    before: Option<i64>,
) -> Result<(Vec<Draft>, Option<i64>)> {
    characters::get(db, id)?;
    if !schema_present(db)? {
        return Ok((Vec::new(), None));
    }
    let mut statement = db.prepare(&format!("SELECT {COLUMNS} FROM novel_character_draft WHERE character_id=?1 AND rowid<=?2 ORDER BY rowid DESC LIMIT 11"))?;
    let mut rows = statement
        .query_map(params![id, before.unwrap_or(i64::MAX)], decode)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next = if rows.len() > 10 {
        rows.pop().map(|entry| entry.cursor)
    } else {
        None
    };
    for draft in &mut rows {
        draft.model = super::novel_model_archive::summary(db, draft)?;
    }
    Ok((rows, next))
}

pub(super) fn revision_model(
    db: &Connection,
    character: &str,
    facet: Facet,
    version: i64,
) -> Result<Option<super::novel_model_source::Summary>> {
    let id: Option<String> = db.query_row("SELECT id FROM novel_character_draft WHERE character_id=?1 AND facet=?2 AND approved_version=?3",params![character,facet.key(),version],|row| row.get(0)).optional()?;
    Ok(match id {
        Some(id) => get(db, Uuid::parse_str(&id)?)?.and_then(|draft| draft.model),
        None => None,
    })
}

pub(super) fn create(tx: &Transaction<'_>, draft: &Proposal, chapter: Chapter<'_>) -> Result<()> {
    if let Some(existing) = get(tx, draft.draft_id)? {
        if existing.character_id == draft.character_id
            && existing.facet == draft.facet
            && existing.base_version == draft.base_version
            && existing.evidence == draft.evidence
            && existing.text == draft.text.trim()
        {
            return Ok(());
        }
        return Err("visual_assets_draft_id_conflict".into());
    }
    chapter.verify(&draft.evidence)?;
    let text = characters::description(&draft.text)?;
    if characters::latest(tx, &draft.character_id, draft.facet)? != draft.base_version {
        return Err("visual_assets_character_revision_changed".into());
    }
    tx.execute_batch(SCHEMA)?;
    tx.execute(
        "INSERT INTO novel_character_draft VALUES (?1,?2,?3,?4,?5,?6,NULL)",
        params![
            draft.draft_id.to_string(),
            draft.character_id,
            draft.facet.key(),
            draft.base_version,
            serde_json::to_string(&draft.evidence)?,
            text
        ],
    )?;
    Ok(())
}

pub(super) fn approve(tx: &Transaction<'_>, id: Uuid, chapter: Chapter<'_>) -> Result<i64> {
    let draft = get(tx, id)?.ok_or("visual_assets_draft_missing")?;
    if let Some(version) = draft.approved_version {
        return Ok(version);
    }
    chapter.verify(&draft.evidence)?;
    let version = characters::append(
        tx,
        &draft.character_id,
        draft.facet,
        draft.base_version,
        &draft.text,
    )?;
    tx.execute(
        "UPDATE novel_character_draft SET approved_version=?2 WHERE id=?1",
        params![id.to_string(), version],
    )?;
    Ok(version)
}

pub(super) fn revision_evidence(
    db: &Connection,
    character: &str,
    facet: Facet,
    version: i64,
) -> rusqlite::Result<Option<Evidence>> {
    let mut statement = db.prepare_cached(&format!("SELECT {COLUMNS} FROM novel_character_draft WHERE character_id=?1 AND facet=?2 AND approved_version=?3"))?;
    Ok(statement
        .query_row(params![character, facet.key(), version], decode)
        .optional()?
        .map(|draft| draft.evidence))
}

pub(super) fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let mut statement = db.prepare(&format!("SELECT {COLUMNS} FROM novel_character_draft"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let draft = decode(row)?;
        if Uuid::parse_str(&draft.id).is_err()
            || draft.approved_version.is_some_and(|version| {
                draft.base_version.unwrap_or(0).checked_add(1) != Some(version)
            })
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    let invalid = db
        .prepare(
            "SELECT 1 FROM novel_character_draft d JOIN character_revision r
        ON d.character_id=r.character_id AND d.facet=r.facet AND d.approved_version=r.version
        WHERE d.text<>r.text LIMIT 1",
        )?
        .exists([])?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
