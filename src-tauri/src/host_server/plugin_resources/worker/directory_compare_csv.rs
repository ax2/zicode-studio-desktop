//! CSV projection of the bounded, confirmed Directory Compare report.
use serde::Deserialize;
use serde_json::Value;

pub(super) const PROFILE: &str = "resource.host.directory-compare-csv.v1";
const MAX_BYTES: usize = 128 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    ok: bool,
    schema_version: u32,
    material: String,
    partial: bool,
    coverage_complete: bool,
    projection_truncated: bool,
    difference_count: u64,
    unassessed_one_side: u64,
    rows: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    path: String,
    difference: String,
    left: Option<Entry>,
    right: Option<Entry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    kind: String,
    logical_bytes: Option<String>,
    sha256: Option<String>,
}

impl Entry {
    fn valid(&self) -> bool {
        match self.kind.as_str() {
            "directory" => self.logical_bytes.is_none() && self.sha256.is_none(),
            "file" => {
                self.logical_bytes
                    .as_deref()
                    .is_none_or(|value| value.parse::<u64>().is_ok_and(|n| n.to_string() == value))
                    && self.sha256.as_deref().is_none_or(|value| {
                        value.len() == 64
                            && value
                                .bytes()
                                .all(|c| c.is_ascii_digit() || matches!(c, b'a'..=b'f'))
                    })
            }
            _ => false,
        }
    }

    fn fields(entry: Option<&Self>) -> [&str; 3] {
        entry.map_or(["", "", ""], |entry| {
            [
                &entry.kind,
                entry.logical_bytes.as_deref().unwrap_or(""),
                entry.sha256.as_deref().unwrap_or(""),
            ]
        })
    }
}

fn safe_relative_path(path: &str) -> bool {
    path.len() <= 2048
        && !path
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '\\'))
        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
}

fn write_line(csv: &mut String, fields: &[&str]) {
    for (index, field) in fields.iter().enumerate() {
        if index != 0 {
            csv.push(',');
        }
        if field.contains([',', '"']) {
            csv.push('"');
            csv.push_str(&field.replace('"', "\"\""));
            csv.push('"');
        } else {
            csv.push_str(field);
        }
    }
    csv.push_str("\r\n");
}

pub(super) fn encode(result: &Value) -> Option<Vec<u8>> {
    let report = Report::deserialize(result).ok()?;
    let exported = report.rows.len();
    if !report.ok
        || report.schema_version != 1
        || report.material != "directory-compare-report"
        || exported > 256
        || exported as u64 > report.difference_count
        || (!report.coverage_complete && !report.partial)
        || (report.coverage_complete && report.unassessed_one_side != 0)
        || (!report.projection_truncated && (exported as u64) < report.difference_count)
    {
        return None;
    }
    let mut csv = String::from("\u{feff}");
    write_line(
        &mut csv,
        &[
            "row_type",
            "relative_path",
            "difference",
            "left_type",
            "right_type",
            "left_size",
            "right_size",
            "left_sha256",
            "right_sha256",
            "coverage",
            "projection_truncated",
            "total_differences",
            "exported_rows",
            "unassessed_one_side",
        ],
    );
    let coverage = if report.partial {
        "partial"
    } else {
        "complete"
    };
    write_line(
        &mut csv,
        &[
            "summary",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            coverage,
            if report.projection_truncated {
                "true"
            } else {
                "false"
            },
            &report.difference_count.to_string(),
            &exported.to_string(),
            &report.unassessed_one_side.to_string(),
        ],
    );
    let mut paths = std::collections::HashSet::new();
    for row in &report.rows {
        let left = row.left.as_ref();
        let right = row.right.as_ref();
        let valid_sides = match row.difference.as_str() {
            "onlyLeft" => report.coverage_complete && left.is_some() && right.is_none(),
            "onlyRight" => report.coverage_complete && right.is_some() && left.is_none(),
            "typeMismatch" | "sizeMismatch" | "contentMismatch" | "unverified" | "changed"
            | "readError" => left.is_some() && right.is_some(),
            _ => false,
        };
        if !valid_sides
            || !safe_relative_path(&row.path)
            || !paths.insert(&row.path)
            || left.is_some_and(|entry| !entry.valid())
            || right.is_some_and(|entry| !entry.valid())
        {
            return None;
        }
        let path = if row
            .path
            .trim_start()
            .starts_with(['=', '+', '-', '@', '＝', '＋', '－', '＠'])
        {
            format!("'{}", row.path)
        } else {
            row.path.clone()
        };
        let [left_type, left_size, left_sha256] = Entry::fields(left);
        let [right_type, right_size, right_sha256] = Entry::fields(right);
        write_line(
            &mut csv,
            &[
                "difference",
                &path,
                &row.difference,
                left_type,
                right_type,
                left_size,
                right_size,
                left_sha256,
                right_sha256,
                "",
                "",
                "",
                "",
                "",
            ],
        );
        if csv.len() > MAX_BYTES {
            return None;
        }
    }
    Some(csv.into_bytes())
}
