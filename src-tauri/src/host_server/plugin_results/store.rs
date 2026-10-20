use super::*;

const MAX_RESULTS: usize = 64;
const MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 64 * 1024;
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
    expires: Instant,
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
    records: HashMap<String, Record>,
    grants: HashMap<String, Grant>,
}

impl Store {
    pub(in crate::host_server) fn invalidate_workspace(&mut self, workspace_id: &str) {
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
        if text.len() > MAX_TEXT_BYTES
            || self.records.len() >= MAX_RESULTS
            || self
                .records
                .values()
                .map(|record| record.text.len())
                .sum::<usize>()
                + text.len()
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
        let descriptor = json!({"schemaVersion":if json_value.is_some() { 2 } else { 1 },"resultId":id,"mimeType":mime_type,
            "byteLength":text.len(),"contentVersion":sha256_hex(text.as_bytes()),"packageVersion":package_version});
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
