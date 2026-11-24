//! Bounded JSON export for a successful duplicate-files report.
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

pub(super) const PROFILE: &str = "resource.host.duplicate-files-json.v1";
const MAX_REPORT_BYTES: usize = 48 * 1024;
const MAX_ENTRIES: u32 = 4096;
const MAX_HASHED_FILES: u32 = 256;
const MAX_HASHED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_GROUPS_SHOWN: usize = 20;
const MAX_PATHS_SHOWN: usize = 12;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Report<'a> {
    ok: bool,
    schema_version: u32,
    material: &'a str,
    partial: bool,
    group_count: u32,
    duplicate_file_count: u32,
    redundant_bytes: &'a str,
    #[serde(borrow)]
    groups: Vec<Group<'a>>,
    projection_truncated: bool,
    #[serde(borrow)]
    source: Source<'a>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Group<'a> {
    logical_bytes: &'a str,
    sha256: &'a str,
    redundant_bytes: &'a str,
    file_count: u32,
    #[serde(borrow)]
    paths: Vec<&'a str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source<'a> {
    visited_entries: u32,
    candidate_files: u32,
    hashed_files: u32,
    hashed_bytes: &'a str,
    skipped_links: u32,
    skipped_depth: u32,
    skipped_names: u32,
    unreadable: u32,
    changed_files: u32,
    skipped_budget: u32,
    limit_reason: Option<Limit>,
    partial: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Limit {
    Entries,
    Time,
    CandidateFiles,
    HashBytes,
    SnapshotBytes,
}

fn decimal(text: &str) -> Option<u64> {
    let bytes = text.parse::<u64>().ok()?;
    (bytes.to_string() == text).then_some(bytes)
}

fn safe_relative_path(path: &str) -> bool {
    path.len() <= 2048
        && !path.chars().any(|ch| {
            ch.is_control() || matches!(ch, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
}

impl Source<'_> {
    fn valid(&self) -> bool {
        let skipped = [
            self.skipped_links,
            self.skipped_depth,
            self.skipped_names,
            self.unreadable,
            self.changed_files,
            self.skipped_budget,
        ];
        self.visited_entries <= MAX_ENTRIES
            && self.candidate_files <= self.visited_entries
            && self.hashed_files <= self.candidate_files.min(MAX_HASHED_FILES)
            && skipped.iter().all(|count| *count <= self.visited_entries)
            && self.partial
                == (self.limit_reason.is_some() || skipped.iter().any(|count| *count != 0))
            && (self.partial || self.candidate_files == self.hashed_files)
    }
}

pub(super) fn encode(value: &Value) -> Option<Vec<u8>> {
    let report = Report::deserialize(value).ok()?;
    let hashed_bytes = decimal(report.source.hashed_bytes)?;
    let redundant_bytes = decimal(report.redundant_bytes)?;
    if !report.ok
        || report.schema_version != 1
        || report.material != "duplicate-files-report"
        || report.partial != report.source.partial
        || value["source"].get("limitReason").is_none()
        || !report.source.valid()
        || hashed_bytes > MAX_HASHED_BYTES
        || redundant_bytes > hashed_bytes
        || report.duplicate_file_count > report.source.hashed_files
        || report.group_count > report.duplicate_file_count / 2
        || report.groups.len() != MAX_GROUPS_SHOWN.min(report.group_count as usize)
        || report.projection_truncated
            != (report.groups.len() < report.group_count as usize
                || report
                    .groups
                    .iter()
                    .any(|group| group.paths.len() < group.file_count as usize))
    {
        return None;
    }

    let mut paths = HashSet::new();
    let mut visible_files = 0;
    let mut visible_bytes = 0;
    for group in report.groups {
        let per_file = decimal(group.logical_bytes)?;
        let bytes = decimal(group.redundant_bytes)?;
        if !(2..=report.duplicate_file_count).contains(&group.file_count)
            || per_file.checked_mul(u64::from(group.file_count - 1))? != bytes
            || group.sha256.len() != 64
            || !group
                .sha256
                .bytes()
                .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
            || group.paths.len() > MAX_PATHS_SHOWN.min(group.file_count as usize)
            || group
                .paths
                .iter()
                .any(|path| !safe_relative_path(path) || !paths.insert(*path))
        {
            return None;
        }
        visible_files += group.file_count;
        visible_bytes = u64::checked_add(visible_bytes, bytes)?;
    }
    if visible_files > report.duplicate_file_count
        || visible_bytes > redundant_bytes
        || (report.group_count <= MAX_GROUPS_SHOWN as u32
            && (visible_files != report.duplicate_file_count || visible_bytes != redundant_bytes))
    {
        return None;
    }
    let output = serde_json::to_vec(value).ok()?;
    (output.len() <= MAX_REPORT_BYTES).then_some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report() -> Value {
        json!({
            "ok":true, "schemaVersion":1, "material":"duplicate-files-report",
            "partial":false, "groupCount":1, "duplicateFileCount":2, "redundantBytes":"3",
            "groups":[{"logicalBytes":"3","redundantBytes":"3","sha256":"a".repeat(64),
                "fileCount":2,"paths":["原件.txt","备份/副本.txt"]}],
            "projectionTruncated":false,
            "source":{"visitedEntries":2,"candidateFiles":2,"hashedFiles":2,"hashedBytes":"6",
                "skippedLinks":0,"skippedDepth":0,"skippedNames":0,"unreadable":0,"changedFiles":0,
                "skippedBudget":0,"limitReason":null,"partial":false}
        })
    }

    #[test]
    fn keeps_counts_precision_and_the_actual_projected_paths() {
        let mut value = report();
        value["groups"][0]["paths"] = json!(["原件.txt"]);
        value["projectionTruncated"] = json!(true);
        value["partial"] = json!(true);
        value["source"]["partial"] = json!(true);
        value["source"]["limitReason"] = json!("candidate_files");
        assert_eq!(
            serde_json::from_slice::<Value>(&encode(&value).unwrap()).unwrap(),
            value
        );
    }

    #[test]
    fn rejects_untrusted_shapes_without_exporting() {
        for (keys, replacement) in [
            ("/groups/0/paths/0", json!("/private/sample")),
            ("/groups/0/paths/0", json!("folder/../sample")),
            ("/groups/0/paths/0", json!("C:\\sample")),
            ("/groups/0/paths/0", json!("备份/副本.txt")),
            ("/groups/0/sha256", json!("A".repeat(64))),
            ("/groups/0/redundantBytes", json!("04")),
            ("/source/hashedBytes", json!("18446744073709551616")),
            ("/projectionTruncated", json!(true)),
            ("/ok", json!(false)),
        ] {
            let mut changed = report();
            *changed.pointer_mut(keys).unwrap() = replacement;
            assert!(encode(&changed).is_none(), "{keys}");
        }
        let mut changed = report();
        changed["unexpected"] = json!("ignored in a different schema");
        assert!(encode(&changed).is_none());
    }
}
