use super::*;
use serde_json::value::RawValue;

const MAX_RESULTS: usize = 64;
const MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_TABLE_EXPORT_BYTES: usize = 48 * 1024;
const RESULT_TTL: Duration = Duration::from_secs(900);
const GRANT_TTL: Duration = Duration::from_secs(120);

#[derive(Clone)]
pub(super) struct Record {
    pub id: String,
    pub scope: Scope,
    pub proof: String,
    pub package_version: String,
    pub text: String,
    pub mime_type: &'static str,
    pub json_value: Option<Value>,
    pub qr_png: Option<Arc<[u8]>>,
    pub table: TableExports,
    pub whole_json_export: bool,
    expires: Instant,
}

impl Record {
    fn payload_bytes(&self) -> usize {
        self.text.len()
            + self.qr_png.as_ref().map_or(0, |png| png.len())
            + self.table.payload_bytes()
    }
}

#[derive(Clone, Default)]
pub(super) struct TableExports {
    pub csv: Option<Arc<str>>,
    pub tsv: Option<Arc<str>>,
    pub json: Option<Arc<str>>,
}

impl TableExports {
    fn payload_bytes(&self) -> usize {
        self.csv.as_ref().map_or(0, |csv| csv.len())
            + self.tsv.as_ref().map_or(0, |tsv| tsv.len())
            + self.json.as_ref().map_or(0, |json| json.len())
    }
}

fn table_exports(scope: &Scope, text: &str) -> Option<TableExports> {
    if let Some(operation) = scope.workbench_export_operation() {
        return workbench_exports(operation, text);
    }
    scope.table_export_stem()?;
    #[derive(Deserialize)]
    struct Output<'a> {
        #[serde(borrow)]
        csv: Option<&'a RawValue>,
        #[serde(borrow)]
        data: Option<&'a RawValue>,
    }
    let Output { csv, data } = serde_json::from_str(text).ok()?;
    let csv = csv
        .and_then(|raw| serde_json::from_str::<String>(raw.get()).ok())
        .filter(|csv| !csv.is_empty() && csv.len() <= MAX_TABLE_EXPORT_BYTES)
        .map(Arc::from);
    let json = data
        .map(RawValue::get)
        .filter(|raw| raw.len() <= MAX_TABLE_EXPORT_BYTES && is_columnar_table(raw))
        .map(Arc::from);
    Some(TableExports {
        csv,
        json,
        tsv: None,
    })
}

fn workbench_exports(operation: &str, output: &str) -> Option<TableExports> {
    #[derive(Deserialize)]
    struct Output<'a> {
        format: &'a str,
        text: String,
    }
    let Output { format, text } = serde_json::from_str(output).ok()?;
    if (operation != "query" && operation != format)
        || text.is_empty()
        || text.len() > MAX_TABLE_EXPORT_BYTES
    {
        return None;
    }
    let mut exports = TableExports::default();
    match format {
        "csv" => exports.csv = Some(text.into()),
        "tsv" => exports.tsv = Some(text.into()),
        "json"
            if serde_json::from_str::<Vec<&RawValue>>(&text)
                .is_ok_and(|rows| rows.iter().all(|row| row.get().starts_with('{'))) =>
        {
            exports.json = Some(text.into())
        }
        _ => return None,
    }
    Some(exports)
}

fn is_json_diff_report(text: &str, order: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let Some(changes) = value.get("changes").and_then(Value::as_array) else {
        return false;
    };
    value.get("arrayOrder").and_then(Value::as_str) == Some(order)
        && value.get("equal").and_then(Value::as_bool) == Some(changes.is_empty())
}

fn is_quality_report_json(text: &str) -> bool {
    let Ok(report) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let rows = report.get("rows").and_then(Value::as_u64);
    let duplicates = report
        .get("duplicateRowsAfterFirst")
        .and_then(Value::as_u64);
    rows.zip(duplicates)
        .is_some_and(|(rows, duplicates)| duplicates <= rows)
        && report.get("columns").is_some_and(Value::is_array)
        && report.get("notes").is_some_and(Value::is_string)
}

fn is_columnar_table(raw: &str) -> bool {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Table<'a> {
        headers: Vec<String>,
        // Check the row shape without converting numbers or building cell objects.
        #[serde(borrow)]
        rows: Vec<Vec<&'a RawValue>>,
    }
    let Ok(Table { headers, rows }) = serde_json::from_str(raw) else {
        return false;
    };
    !headers.is_empty()
        && headers.len() <= 128
        && headers.iter().all(|header| !header.trim().is_empty())
        && headers
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            == headers.len()
        && rows.len() <= 10_000
        && rows.iter().all(|row| row.len() == headers.len())
}

pub(super) struct Grant {
    pub result_id: String,
    pub title: String,
    pub artifact: Option<ArtifactDocument>,
    expires: Instant,
}

#[derive(Default)]
pub(crate) struct Store {
    pub(super) transfers: super::transfer::Transfers,
    pub(super) exports: super::export::Grants,
    records: HashMap<String, Record>,
    grants: HashMap<String, Grant>,
}

impl Store {
    pub(in crate::host_server) fn invalidate_workspace(&mut self, workspace_id: &str) {
        self.exports.invalidate_workspace(workspace_id);
        self.records
            .retain(|_, record| record.scope.workspace_id != workspace_id);
        self.grants
            .retain(|_, grant| self.records.contains_key(&grant.result_id));
        self.transfers.invalidate_workspace(workspace_id);
    }

    fn prune(&mut self) {
        let now = Instant::now();
        self.records.retain(|_, record| record.expires > now);
        self.grants
            .retain(|_, grant| grant.expires > now && self.records.contains_key(&grant.result_id));
    }

    pub(super) fn capture(
        &mut self,
        scope: Scope,
        proof: String,
        package_version: String,
        output: &Value,
    ) -> Result<Value, ApiError> {
        let text = output
            .get("data")
            .and_then(|data| data.get("text"))
            .and_then(Value::as_str)
            .filter(|_| output.get("ok") == Some(&Value::Bool(true)))
            .ok_or_else(|| rejected("result_not_successful_text"))?;
        self.capture_payload(scope, proof, package_version, text.to_owned(), None)
    }

    pub(super) fn capture_json(
        &mut self,
        scope: Scope,
        proof: String,
        package_version: String,
        output: &Value,
    ) -> Result<Value, ApiError> {
        let value = output
            .get("data")
            .filter(|data| data.is_object() && output.get("ok") == Some(&Value::Bool(true)))
            .ok_or_else(|| rejected("result_not_successful_json"))?;
        let text =
            serde_json::to_string(value).map_err(|_| rejected("result_not_successful_json"))?;
        self.capture_payload(scope, proof, package_version, text, Some(value.clone()))
    }

    fn capture_payload(
        &mut self,
        scope: Scope,
        proof: String,
        package_version: String,
        text: String,
        json_value: Option<Value>,
    ) -> Result<Value, ApiError> {
        self.prune();
        if text.len() > MAX_TEXT_BYTES || self.records.len() >= MAX_RESULTS {
            return Err(rejected("result_budget_exceeded"));
        }
        let qr_png = if json_value.is_none() && super::qr_png::matches(&scope) {
            super::qr_png::decode(&text)
        } else {
            None
        };
        let table_exports = json_value
            .is_none()
            .then(|| table_exports(&scope, &text))
            .flatten()
            .unwrap_or_default();
        let whole_json_export = json_value.is_none()
            && text.len() <= MAX_TABLE_EXPORT_BYTES
            && ((scope.is_quality_report() && is_quality_report_json(&text))
                || (scope.is_json_path()
                    && serde_json::from_str::<&RawValue>(&text)
                        .is_ok_and(|array| array.get().starts_with('[')))
                || scope
                    .json_diff_array_order()
                    .is_some_and(|order| is_json_diff_report(&text, order)));
        let bytes_added =
            text.len() + qr_png.as_ref().map_or(0, |png| png.len()) + table_exports.payload_bytes();
        if self
            .records
            .values()
            .map(Record::payload_bytes)
            .sum::<usize>()
            + bytes_added
            > MAX_TOTAL_BYTES
        {
            return Err(rejected("result_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mime_type = if json_value.is_some() {
            "application/json"
        } else {
            "text/plain"
        };
        let mut descriptor = json!({"schemaVersion":if json_value.is_some() { 2 } else { 1 },"resultId":id,"mimeType":mime_type,
            "byteLength":text.len(),"contentVersion":sha256_hex(text.as_bytes()),"packageVersion":package_version});
        if let Some(bytes) = &qr_png {
            descriptor["pngExport"] = json!({
                "mimeType": "image/png",
                "byteLength": bytes.len(),
                "contentVersion": sha256_hex(bytes),
            });
        }
        let json = table_exports
            .json
            .as_deref()
            .or(whole_json_export.then_some(text.as_str()));
        for (name, mime, content) in [
            ("csvExport", "text/csv", table_exports.csv.as_deref()),
            (
                "tsvExport",
                "text/tab-separated-values",
                table_exports.tsv.as_deref(),
            ),
            ("jsonExport", "application/json", json),
        ] {
            if let Some(content) = content {
                descriptor[name] = json!({
                    "mimeType": mime,
                    "byteLength": content.len(),
                    "contentVersion": sha256_hex(content.as_bytes()),
                });
            }
        }
        self.records.insert(
            id.clone(),
            Record {
                id,
                scope,
                proof,
                package_version,
                text,
                mime_type,
                json_value,
                qr_png,
                table: table_exports,
                whole_json_export,
                expires: Instant::now() + RESULT_TTL,
            },
        );
        Ok(descriptor)
    }

    pub(super) fn record(&mut self, scope: &Scope, id: &str) -> Result<Record, ApiError> {
        self.prune();
        self.records
            .get(id)
            .filter(|record| &record.scope == scope)
            .cloned()
            .ok_or_else(|| rejected("result_unavailable"))
    }

    #[cfg(test)]
    pub(in crate::host_server) fn record_count(&self) -> usize {
        self.records.len()
    }

    pub(super) fn prepare(&mut self, result_id: String, title: String) -> Result<String, ApiError> {
        self.prune();
        if self.grants.len() >= MAX_RESULTS {
            return Err(rejected("result_grant_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.grants.insert(
            id.clone(),
            Grant {
                result_id,
                title,
                artifact: None,
                expires: Instant::now() + GRANT_TTL,
            },
        );
        Ok(id)
    }

    pub(super) fn grant(&mut self, id: &str) -> Result<&mut Grant, ApiError> {
        self.prune();
        self.grants
            .get_mut(id)
            .ok_or_else(|| rejected("result_grant_unavailable"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_successful_compute_transform_text_gets_a_csv_export_descriptor() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "com.zicode.devtools.compute".into(),
            capability_id: "devtools.compute.transform.trim".into(),
        };
        let capture = |input: Value| -> Value {
            Store::default()
                .capture(scope.clone(), "proof".into(), "1".into(), &input)
                .unwrap()
        };
        let csv = "name,count\r\n\"甲,乙\",9223372036854775807\r\n";
        let text = json!({"csv":csv}).to_string();
        let descriptor = capture(json!({"ok":true,"data":{"text":text}}));
        assert_eq!(descriptor["mimeType"], "text/plain");
        assert_eq!(
            descriptor["csvExport"],
            json!({"mimeType":"text/csv","byteLength":csv.len(),"contentVersion":sha256_hex(csv.as_bytes())})
        );
        for text in ["not-json", r#"{"csv":""}"#, r#"{"csv":42}"#] {
            assert!(capture(json!({"ok":true,"data":{"text":text}}))["csvExport"].is_null());
        }
        let unrelated = Scope {
            capability_id: "devtools.compute.qr.png".into(),
            ..scope
        };
        let descriptor = Store::default()
            .capture(
                unrelated,
                "proof".into(),
                "1".into(),
                &json!({"ok":true,"data":{"text":text}}),
            )
            .unwrap();
        assert!(descriptor["csvExport"].is_null());
    }

    #[test]
    fn transform_json_preserves_json_tokens_and_rejects_non_columnar_data() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "com.zicode.devtools.compute".into(),
            capability_id: "devtools.compute.transform.trim".into(),
        };
        let table = r#"{"headers":["名称","值"], "rows":[["甲\n乙",{"n":18446744073709551615,"f":1.2300e-7,"b":true}]]}"#;
        let text = format!(r#"{{"data":{table},"csv":42}}"#);
        let result = table_exports(&scope, &text).unwrap();
        assert_eq!(result.json.as_deref(), Some(table));
        assert!(result.csv.is_none());

        for data in [
            r#"{"headers":["x","x"],"rows":[[1,2]]}"#,
            r#"{"headers":["x"],"rows":[[1,2]]}"#,
            r#"{"headers":[""],"rows":[]}"#,
            r#"{"headers":["x"],"rows":[],"report":"not a table"}"#,
            r#"[{"x":1}]"#,
        ] {
            let text = format!(r#"{{"data":{data},"csv":"x\n1\n"}}"#);
            let result = table_exports(&scope, &text).unwrap();
            assert!(result.json.is_none());
            assert_eq!(result.csv.as_deref(), Some("x\n1\n"));
        }
        let empty = r#"{"headers":["x"],"rows":[]}"#;
        let text = format!(r#"{{"data":{empty}}}"#);
        assert_eq!(
            table_exports(&scope, &text).unwrap().json.as_deref(),
            Some(empty)
        );
    }

    #[test]
    fn workbench_exports_are_exact_and_bound_to_output_format() {
        let table = r#" [ {"i": 18446744073709551615, "f": 1.2300e-7} ] "#;
        let report = |format: &str, text: &str| json!({"format":format,"text":text}).to_string();
        let exported = workbench_exports("json", &report("json", table)).unwrap();
        assert_eq!(exported.json.as_deref(), Some(table));
        assert_eq!(exported.payload_bytes(), table.len());
        assert!(exported.csv.is_none() && exported.tsv.is_none());
        assert!(workbench_exports("csv", &report("json", table)).is_none());
        assert!(workbench_exports("json", &report("json", r#"[42]"#)).is_none());
        assert!(workbench_exports("query", &report("json", r#"{"x":1}"#)).is_none());
        assert!(workbench_exports("query", &report("plain", "unsupported")).is_none());
        assert!(workbench_exports("query", &report("tsv", "")).is_none());
        let tsv = "甲\t乙\r\n1\t2\r\n";
        let exported = workbench_exports("query", &report("tsv", tsv)).unwrap();
        assert_eq!(exported.tsv.as_deref(), Some(tsv));
        assert_eq!(exported.payload_bytes(), tsv.len());
        assert!(exported.csv.is_none() && exported.json.is_none());
        let limit = "x".repeat(MAX_TABLE_EXPORT_BYTES);
        assert!(workbench_exports("csv", &report("csv", &limit)).is_some());
        assert!(workbench_exports("csv", &report("csv", &format!("{limit}x"))).is_none());
    }

    #[test]
    fn quality_json_exports_original_bytes_once_and_rejects_other_documents() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "com.zicode.devtools.compute".into(),
            capability_id: "devtools.compute.quality.json".into(),
        };
        let mut store = Store::default();
        let report =
            r#" { "notes" : "本地报告", "columns": [], "rows": 0, "duplicateRowsAfterFirst": 0 } "#;
        let padded = format!(
            "{report}{}",
            " ".repeat(MAX_TABLE_EXPORT_BYTES - report.len())
        );
        let capture = |store: &mut Store, scope: Scope, text: &str| {
            store
                .capture(
                    scope,
                    "proof".into(),
                    "1".into(),
                    &json!({"ok":true,"data":{"text":text}}),
                )
                .unwrap()
        };
        for text in [report, &padded] {
            let descriptor = capture(&mut store, scope.clone(), text);
            assert_eq!(descriptor["jsonExport"]["byteLength"], text.len());
            assert_eq!(
                descriptor["jsonExport"]["contentVersion"],
                sha256_hex(text.as_bytes())
            );
            assert!(descriptor["csvExport"].is_null());
            let record = store
                .record(&scope, descriptor["resultId"].as_str().unwrap())
                .unwrap();
            assert!(record.whole_json_export);
            assert_eq!(record.payload_bytes(), text.len());
            assert_eq!(record.text, text);
        }
        for text in ["not-json", "[]", r#"{"csv":"a,b"}"#, &format!("{padded} ")] {
            assert!(capture(&mut store, scope.clone(), text)["jsonExport"].is_null());
        }
        let unrelated = Scope {
            capability_id: "devtools.compute.quality.unknown".into(),
            ..scope
        };
        assert!(capture(&mut store, unrelated, report)["jsonExport"].is_null());
    }

    #[test]
    fn json_diff_export_requires_the_declared_mode_and_consistent_report() {
        let report = r#" { "arrayOrder":"by index","changes":[],"equal":true } "#;
        assert!(is_json_diff_report(report, "by index"));
        assert!(!is_json_diff_report(report, "ignored (duplicates retained)"));
        assert!(!is_json_diff_report(&report.replace("true", "false"), "by index"));
        assert!(!is_json_diff_report("[]", "by index"));
    }

    #[test]
    fn json_path_capture_keeps_array_bytes_and_ignores_other_results() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "com.zicode.devtools.compare".into(),
            capability_id: "devtools.compare.json.path".into(),
        };
        let mut store = Store::default();
        let capture = |store: &mut Store, scope: Scope, text: &str| {
            store
                .capture(
                    scope,
                    "proof".into(),
                    "1".into(),
                    &json!({"ok":true,"data":{"text":text}}),
                )
                .unwrap()
        };
        let raw = r#" [18446744073709551615, -9223372036854775808, 1.2300e-7, {"字":true}] "#;
        for text in [raw, "[]"] {
            let descriptor = capture(&mut store, scope.clone(), text);
            assert_eq!(
                descriptor["jsonExport"],
                json!({
                    "mimeType": "application/json",
                    "byteLength": text.len(),
                    "contentVersion": sha256_hex(text.as_bytes()),
                })
            );
            let record = store
                .record(&scope, descriptor["resultId"].as_str().unwrap())
                .unwrap();
            assert!(record.whole_json_export);
            assert_eq!(record.payload_bytes(), text.len());
            assert_eq!(record.text, text);
        }
        for text in [
            r#"{"x":1}"#,
            "[",
            "null",
            &format!("[]{}", " ".repeat(MAX_TABLE_EXPORT_BYTES - 1)),
        ] {
            assert!(capture(&mut store, scope.clone(), text)["jsonExport"].is_null());
        }
        let wrong_plugin = Scope {
            plugin_id: "fixture".into(),
            ..scope
        };
        assert!(capture(&mut store, wrong_plugin, raw)["jsonExport"].is_null());
    }

    #[test]
    fn utf8_and_total_text_byte_limits_are_exact() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "fixture".into(),
            capability_id: "text".into(),
        };
        let mut store = Store::default();
        let oversized = json!({"ok":true,"data":{"text":"中".repeat(MAX_TEXT_BYTES / 3 + 1)}});
        assert!(store
            .capture(scope.clone(), "proof".into(), "1".into(), &oversized)
            .is_err());
        let exact = json!({"ok":true,"data":{"text":"x".repeat(MAX_TEXT_BYTES)}});
        for _ in 0..(MAX_TOTAL_BYTES / MAX_TEXT_BYTES) {
            store
                .capture(scope.clone(), "proof".into(), "1".into(), &exact)
                .unwrap();
        }
        assert!(store
            .capture(
                scope,
                "proof".into(),
                "1".into(),
                &json!({"ok":true,"data":{"text":"x"}})
            )
            .is_err());
    }

    #[test]
    fn failed_outputs_scope_budget_and_expiration_are_enforced() {
        let mut store = Store::default();
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "fixture".into(),
            capability_id: "text".into(),
        };
        assert!(store
            .capture(
                scope.clone(),
                "proof".into(),
                "1".into(),
                &json!({"ok":false,"data":{"text":"failure"}})
            )
            .is_err());
        let output = json!({"ok":true,"data":{"text":""}});
        let reference = store
            .capture(scope.clone(), "proof".into(), "1".into(), &output)
            .unwrap();
        let id = reference["resultId"].as_str().unwrap();
        assert_eq!(store.record(&scope, id).unwrap().text, "");
        let mut other = scope.clone();
        other.workspace_id = "other".into();
        assert!(store.record(&other, id).is_err());
        let grant = store.prepare(id.into(), "Saved output".into()).unwrap();
        store.grants.get_mut(&grant).unwrap().expires = Instant::now();
        assert!(store.grant(&grant).is_err());
        for _ in 1..MAX_RESULTS {
            store
                .capture(scope.clone(), "p".into(), "1".into(), &output)
                .unwrap();
        }
        assert!(store
            .capture(scope, "p".into(), "1".into(), &output)
            .is_err());
    }

    #[test]
    fn explicit_json_capture_keeps_object_type_and_bounds() {
        let scope = Scope {
            workspace_id: "workspace".into(),
            scene_id: "programming".into(),
            plugin_id: "fixture".into(),
            capability_id: "json".into(),
        };
        let mut store = Store::default();
        let output =
            json!({"ok":true,"data":{"rows":[{"count":2}],"text":"a field, not a text result"}});
        let reference = store
            .capture_json(scope.clone(), "proof".into(), "1".into(), &output)
            .unwrap();
        assert_eq!(reference["schemaVersion"], 2);
        assert_eq!(reference["mimeType"], "application/json");
        let record = store
            .record(&scope, reference["resultId"].as_str().unwrap())
            .unwrap();
        assert_eq!(record.json_value, Some(output["data"].clone()));
        assert_eq!(record.mime_type, "application/json");
        assert!(store
            .capture_json(
                scope.clone(),
                "proof".into(),
                "1".into(),
                &json!({"ok":false,"data":{"rows":[]}})
            )
            .is_err());
        assert!(store
            .capture_json(
                scope.clone(),
                "proof".into(),
                "1".into(),
                &json!({"ok":true,"data":"serialized"})
            )
            .is_err());
        assert!(store
            .capture_json(
                scope,
                "proof".into(),
                "1".into(),
                &json!({"ok":true,"data":{"rows":"x".repeat(MAX_TEXT_BYTES)}})
            )
            .is_err());
    }
}
