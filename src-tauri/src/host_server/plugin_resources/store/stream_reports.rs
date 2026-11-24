//! A verified native digest report owns lazy, metadata-only original-file references.
use super::*;
use crate::host_server::plugin_resources::export::Context;
use crate::plugin_worker::resource_output::Profile;
use file_reference::{FileBinding, OriginalFile};

pub(in crate::host_server::plugin_resources) const PROFILE: &str =
    "resource.host.file-digest-stream-report.draft1";
const MAX_REPORT: usize = 128 * 1024;

pub(in crate::host_server::plugin_resources) struct StreamOriginal {
    pub file: Arc<OriginalFile>,
    pub length: usize,
    pub sha256: String,
}

pub(super) struct StreamReport {
    context: Context,
    originals: Vec<Option<StreamOriginal>>,
    current_original: Option<(usize, Access)>,
}

impl Store {
    fn reserve_stream_record(&self, bytes: usize) -> Result<(), ApiError> {
        if self.records.len() >= MAX_RECORDS
            || bytes
                > MAX_RESERVED.saturating_sub(
                    self.records
                        .values()
                        .filter(|r| r.output_profile.uses_shared_store_budget())
                        .map(|r| r.expected)
                        .sum(),
                )
            || bytes
                > MAX_TOTAL_RESERVED.saturating_sub(self.records.values().map(|r| r.expected).sum())
        {
            return Err(rejected("resource_budget_exceeded"));
        }
        Ok(())
    }

    pub(in crate::host_server::plugin_resources) fn publish_stream_report(
        &mut self,
        owner: &Owner,
        proof: &str,
        context: Context,
        report: &Value,
        originals: Vec<Option<StreamOriginal>>,
    ) -> Result<(Access, Value), ApiError> {
        self.prune();
        let bytes = serde_json::to_vec_pretty(report).map_err(|_| rejected("invalid_output"))?;
        let length = bytes.len();
        if length == 0 || length > MAX_REPORT {
            return Err(rejected("invalid_output"));
        }
        self.reserve_stream_record(length)?;
        let id = uuid::Uuid::new_v4().to_string();
        let version = sha256_hex(&bytes);
        let access = Access {
            schema_version: 1,
            owner: owner.clone(),
            resource_id: id.clone(),
            content_version: version.clone(),
        };
        let descriptor = json!({"profile":PROFILE,"index":0,"resourceId":id,"contentVersion":version,"mimeType":"application/json",
            "byteLength":length,"expiresInSeconds":900,"origin":"host-report","saved":false});
        self.records.insert(
            id.clone(),
            Record {
                output_profile: Profile::Draft1,
                owner: owner.clone(),
                proof: proof.into(),
                mime: "application/json".into(),
                expected: length,
                version,
                chunks: vec![bytes.into()],
                uploaded: length,
                confirmed: true,
                expires: Instant::now() + Duration::from_secs(900),
                parents: Vec::new(),
                original: None,
                digest_name: None,
                import_profile: None,
            },
        );
        self.stream_reports.insert(
            id,
            StreamReport {
                context,
                originals,
                current_original: None,
            },
        );
        Ok((access, descriptor))
    }

    pub(in crate::host_server::plugin_resources) fn stream_original(
        &mut self,
        context: &Context,
        report: &Access,
        proof: &str,
        index: usize,
    ) -> Result<Value, ApiError> {
        self.check(report, proof)?;
        let registration = self
            .stream_reports
            .get_mut(&report.resource_id)
            .filter(|entry| &entry.context == context)
            .ok_or_else(|| rejected("resource_file_reference_unavailable"))?;
        let original = registration
            .originals
            .get(index)
            .and_then(Option::as_ref)
            .ok_or_else(|| rejected("resource_file_reference_unavailable"))?;
        let (file, expected, version) = (
            original.file.clone(),
            original.length,
            original.sha256.clone(),
        );
        let previous = registration.current_original.take();
        if let Some((old_index, old)) = &previous {
            if *old_index == index && self.records.contains_key(&old.resource_id) {
                self.stream_reports
                    .get_mut(&report.resource_id)
                    .unwrap()
                    .current_original = previous.clone();
                return Ok(original_view(old, &file, expected));
            }
            self.records.remove(&old.resource_id);
            self.prune();
            self.check(report, proof)?;
        }
        self.reserve_stream_record(expected)?;
        let access = Access {
            schema_version: 1,
            owner: report.owner.clone(),
            resource_id: uuid::Uuid::new_v4().to_string(),
            content_version: version.clone(),
        };
        let expires = self.records[&report.resource_id].expires;
        self.records.insert(
            access.resource_id.clone(),
            Record {
                output_profile: Profile::Draft1,
                owner: report.owner.clone(),
                proof: proof.into(),
                mime: "application/octet-stream".into(),
                expected,
                version,
                chunks: Vec::new(),
                uploaded: expected,
                confirmed: true,
                expires,
                parents: vec![Ancestor {
                    access: report.clone(),
                    proof: proof.into(),
                }],
                original: Some(FileBinding::VerifiedStream(file.clone())),
                digest_name: None,
                import_profile: None,
            },
        );
        self.stream_reports
            .get_mut(&report.resource_id)
            .unwrap()
            .current_original = Some((index, access.clone()));
        Ok(original_view(&access, &file, expected))
    }
}

fn original_view(access: &Access, file: &OriginalFile, length: usize) -> Value {
    json!({"schemaVersion":1,"contentRead":false,"access":access,"fileName":file.display_name(),"byteLength":length,
        "mimeType":"application/octet-stream"})
}
