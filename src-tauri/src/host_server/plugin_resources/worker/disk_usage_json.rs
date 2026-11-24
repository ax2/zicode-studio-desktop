//! JSON projection of a successful, bounded Disk Inspector report from a confirmed directory.
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) const PROFILE: &str = "resource.host.directory-usage-json.v1";
const MAX_ENTRIES: u32 = 4096;
const MAX_PATH_BYTES: usize = 512;
const MAX_INPUT_BYTES: u32 = 2 * 1024 * 1024;
const MAX_ANALYSIS_BYTES: u32 = 64 * 1024;
const MAX_REPORT_BYTES: usize = 48 * 1024;
const TOP: usize = 20;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Report<'a> {
    ok: bool,
    schema_version: u32,
    material: &'a str,
    partial: bool,
    logical_bytes: &'a str,
    root_files_logical_bytes: &'a str,
    file_count: u32,
    directory_count: u32,
    group_count: u32,
    #[serde(borrow)]
    groups: Vec<Row<'a>>,
    #[serde(borrow)]
    largest_files: Vec<Row<'a>>,
    source: Option<Source>,
    analysis: Analysis,
    limits: BTreeMap<&'a str, u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Row<'a> {
    path: &'a str,
    logical_bytes: &'a str,
    path_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    visited_entries: u32,
    skipped_links: u32,
    skipped_depth: u32,
    skipped_names: u32,
    unreadable: u32,
    limit_reason: Option<SourceLimit>,
    partial: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum SourceLimit {
    Entries,
    Time,
    SnapshotBytes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Analysis {
    examined_entries: u32,
    input_bytes: u32,
    read_bytes: u32,
    limit_reason: Option<AnalysisLimit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalysisLimit {
    AnalysisBytes,
}

const LIMITS: &[(&str, u32)] = &[
    ("hostMaxEntries", MAX_ENTRIES),
    ("hostMaxDepth", 16),
    ("hostScanSeconds", 15),
    ("hostMaxSnapshotBytes", MAX_INPUT_BYTES),
    ("maxAnalysisBytes", MAX_ANALYSIS_BYTES),
    ("displayedPathBytes", MAX_PATH_BYTES as u32),
    ("displayedRowsPerList", TOP as u32),
];

fn logical_bytes(text: &str) -> Option<u128> {
    let bytes = text.parse::<u128>().ok()?;
    (bytes <= u128::from(u64::MAX) * u128::from(MAX_ENTRIES) && bytes.to_string() == text)
        .then_some(bytes)
}

fn safe_path(path: &str, shortened: bool) -> bool {
    let last = path.matches('/').count();
    !path.is_empty()
        && path.len() <= MAX_PATH_BYTES
        && (!shortened || path.len() >= MAX_PATH_BYTES - 3)
        && !path
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '\\'))
        && path.split('/').enumerate().all(|(index, part)| {
            !matches!(part, "" | "." | "..") || (shortened && index > 0 && index == last)
        })
}

impl Source {
    fn valid(&self, examined: u32) -> bool {
        self.visited_entries >= examined
            && self.visited_entries <= MAX_ENTRIES
            && [
                self.skipped_links,
                self.skipped_depth,
                self.skipped_names,
                self.unreadable,
            ]
            .into_iter()
            .all(|value| value <= MAX_ENTRIES)
            && self.partial
                == (self.limit_reason.is_some()
                    || [
                        self.skipped_links,
                        self.skipped_depth,
                        self.skipped_names,
                        self.unreadable,
                    ]
                    .into_iter()
                    .any(|value| value != 0))
    }
}

pub(super) fn encode(value: &Value) -> Option<Vec<u8>> {
    let report = Report::deserialize(value).ok()?;
    let total = logical_bytes(report.logical_bytes)?;
    let root = logical_bytes(report.root_files_logical_bytes)?;
    let analysis = &report.analysis;
    let limited = analysis.limit_reason.is_some();
    if !report.ok
        || report.schema_version != 1
        || report.material != "directory-usage-report"
        || value.get("source").is_none()
        || (!limited && value["source"].get("limitReason").is_none())
        || value["analysis"].get("limitReason").is_none()
        || root > total
        || report.file_count.checked_add(report.directory_count)? != analysis.examined_entries
        || analysis.examined_entries > MAX_ENTRIES
        || report.group_count > report.directory_count
        || report.groups.len() != TOP.min(report.group_count as usize)
        || report.largest_files.len() != TOP.min(report.file_count as usize)
        || report.limits.len() != LIMITS.len()
        || !LIMITS
            .iter()
            .all(|(key, expected)| report.limits.get(key) == Some(expected))
        || !(1..=MAX_INPUT_BYTES).contains(&analysis.input_bytes)
        || analysis.read_bytes != analysis.input_bytes.min(MAX_ANALYSIS_BYTES)
        || limited != (analysis.input_bytes > analysis.read_bytes)
        || limited != report.source.is_none()
        || report.partial
            != (limited || report.source.as_ref().is_some_and(|source| source.partial))
        || report
            .source
            .as_ref()
            .is_some_and(|source| !source.valid(analysis.examined_entries))
        || report
            .groups
            .iter()
            .chain(&report.largest_files)
            .any(|row| {
                !safe_path(row.path, row.path_truncated)
                    || logical_bytes(row.logical_bytes).is_none_or(|size| size > total)
            })
    {
        return None;
    }

    let output = serde_json::to_vec_pretty(value).ok()?;
    (output.len() <= MAX_REPORT_BYTES).then_some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report() -> Value {
        json!({
            "ok": true, "schemaVersion": 1, "material": "directory-usage-report",
            "partial": false, "logicalBytes": "18446744073709551615",
            "rootFilesLogicalBytes": "18446744073709551615",
            "fileCount": 1, "directoryCount": 0, "groupCount": 0, "groups": [],
            "largestFiles": [{"path":"报告.txt","logicalBytes":"18446744073709551615","pathTruncated":false}],
            "source": {"visitedEntries":1,"skippedLinks":0,"skippedDepth":0,"skippedNames":0,"unreadable":0,"limitReason":null,"partial":false},
            "analysis": {"examinedEntries":1,"inputBytes":200,"readBytes":200,"limitReason":null},
            "limits": LIMITS.iter().copied().collect::<BTreeMap<_,_>>()
        })
    }

    #[test]
    fn preserves_precision_and_shortened_relative_paths_in_json() {
        let mut value = report();
        let shortened = format!("{}/", "a".repeat(511));
        value["largestFiles"][0]["path"] = json!(shortened);
        value["largestFiles"][0]["pathTruncated"] = json!(true);
        let raw = encode(&value).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&raw).unwrap(), value);
    }

    #[test]
    fn excludes_unrecognized_material_and_unbounded_path_or_metadata() {
        let mut value = report();
        value["largestFiles"][0]["path"] = json!("/local/file");
        assert!(encode(&value).is_none());
        value = report();
        value["source"]["location"] = json!("/local");
        assert!(encode(&value).is_none());
        value = report();
        value["limits"]["extra"] = json!(20);
        assert!(encode(&value).is_none());
        value = report();
        value["analysis"]["limitReason"] = json!("unknown");
        assert!(encode(&value).is_none());
    }
}
