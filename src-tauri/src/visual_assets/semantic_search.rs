//! Rank locally indexed filenames and tags using user-approved query concepts.
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Serialize;

pub fn valid_term(s: &str) -> bool {
    !s.trim().is_empty()
        && s.trim() == s
        && s.chars().count() <= 64
        && !s.chars().any(char::is_control)
}

#[derive(Serialize)]
pub struct Match {
    pub id: i64,
    pub name: String,
    pub matched: Vec<String>,
    score: i64,
}

pub fn ranked(db: &Connection, query: &str, concepts: &[String]) -> rusqlite::Result<Vec<Match>> {
    if !valid_term(query) || concepts.len() > 8 || concepts.iter().any(|s| !valid_term(s)) {
        return Err(rusqlite::Error::InvalidParameterName("query".into()));
    }
    let mut terms = vec![query];
    for term in concepts {
        if !terms.contains(&term.as_str()) {
            terms.push(term);
        }
    }
    let placeholders = vec!["(?,?,?,?)"; terms.len()].join(",");
    let mut parameters = Vec::with_capacity(terms.len() * 4);
    for (index, term) in terms.into_iter().enumerate() {
        let label = match term {
            "横幅" => "Landscape",
            "竖幅" => "Portrait",
            "方形" => "Square",
            "明亮" => "Light tones",
            "暗调" => "Dark tones",
            "中间调" => "Mid tones",
            _ => term,
        };
        parameters.extend([
            Value::Text(term.into()),
            Value::Text(term.chars().take(3).collect()),
            Value::Integer(if index == 0 { 100 } else { 10 - index as i64 }),
            Value::Text(label.into()),
        ]);
    }
    let labels = if super::tags::local_preview::present(db)? {
        "UNION SELECT l.asset,t.term,t.weight FROM terms t JOIN local_preview_label_v1 l ON l.label=t.label
         JOIN revision r ON r.asset=l.asset AND r.version=1 AND r.digest=l.digest"
    } else {
        ""
    };
    let sql = format!("WITH terms(term,gram,weight,label) AS (VALUES {placeholders}),
        hits(id,term,weight) AS (
            SELECT g.asset,t.term,t.weight FROM terms t JOIN asset_name_gram g ON g.gram IN (t.gram,'')
            JOIN asset a ON a.id=g.asset WHERE instr(a.name,t.term)>0
            UNION SELECT l.asset,t.term,t.weight FROM terms t JOIN asset_tag l ON t.term=l.tag {labels})
        SELECT a.id,a.name,group_concat(h.term,char(31)),sum(h.weight) AS score
        FROM hits h JOIN asset a ON a.id=h.id GROUP BY a.id ORDER BY score DESC,a.id LIMIT 50");
    let mut statement = db.prepare(&sql)?;
    let values = statement
        .query_map(params_from_iter(parameters), |r| {
            Ok(Match {
                id: r.get(0)?,
                name: r.get(1)?,
                matched: r
                    .get::<_, String>(2)?
                    .split('\u{1f}')
                    .map(str::to_owned)
                    .collect(),
                score: r.get(3)?,
            })
        })?
        .collect();
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_literal_above_related_terms_and_deduplicates_sources() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE asset(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE asset_tag(tag TEXT,asset INTEGER); CREATE TABLE asset_name_gram(gram TEXT,asset INTEGER);
            INSERT INTO asset VALUES(1,'开销'),(2,'费用总览'),(3,'同名'),(4,'同名');
            INSERT INTO asset_name_gram VALUES('开销',1),('费用',2);
            INSERT INTO asset_tag VALUES('费用',2),('费用',4),('成本',3);").unwrap();
        let hits = ranked(&db, "开销", &["费用".into(), "费用".into(), "成本".into()]).unwrap();
        assert_eq!(hits.iter().map(|h| h.id).collect::<Vec<_>>(), [1, 2, 4, 3]);
        assert_eq!(hits[1].matched, ["费用"]);
        assert!(ranked(&db, "海洋生物", &[]).unwrap().is_empty());
    }
}
