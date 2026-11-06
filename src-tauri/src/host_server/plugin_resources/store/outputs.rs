//! Atomic derived-resource admission, sharing the input store's total budget.
use super::*;
use crate::plugin_worker::resource_output::{Blob, Profile};
use std::sync::atomic::{AtomicBool, Ordering};

pub(in crate::host_server::plugin_resources) struct Pending {
    sources: Vec<Access>,
    proof: String,
    total: usize,
    records: Vec<(String, Record)>,
    descriptors: Value,
    profile: Profile,
    host_report: Option<Value>,
    host_report_bytes: usize,
}

impl Pending {
    pub(in crate::host_server::plugin_resources) fn prepare(
        sources: &[Access],
        proof: &str,
        blobs: Vec<Blob>,
    ) -> Result<Self, ApiError> {
        Self::prepare_with_profile(sources, proof, blobs, Profile::Draft1)
    }

    pub(in crate::host_server::plugin_resources) fn prepare_with_profile(
        sources: &[Access], proof: &str, blobs: Vec<Blob>, profile: Profile,
    ) -> Result<Self, ApiError> {
        let Some(source) = sources.first() else {
            return Err(rejected("resource_metadata_invalid"));
        };
        let unique: std::collections::HashSet<_> = sources.iter().map(|s| &s.resource_id).collect();
        if sources.len() > 4
            || unique.len() != sources.len()
            || sources.iter().any(|s| s.owner != source.owner)
        {
            return Err(rejected("resource_metadata_invalid"));
        }
        let total = blobs
            .iter()
            .try_fold(0usize, |total, blob| total.checked_add(blob.bytes.len()))
            .filter(|n| *n <= profile.max_bytes())
            .ok_or_else(|| rejected("resource_budget_exceeded"))?;
        if blobs.len() > profile.max_records() || blobs.iter().any(|blob|blob.bytes.len()>profile.max_file() || !profile.permits_mime(&blob.mime_type)) {
            return Err(rejected("resource_budget_exceeded"));
        }
        if blobs
            .iter()
            .any(|b| crate::plugin_output_types::extension(&b.mime_type).is_none())
        {
            return Err(rejected("resource_metadata_invalid"));
        }
        // Build every record before mutation. No fallible validation after first insertion.
        let mut pending = Vec::with_capacity(blobs.len());
        let mut descriptors = Vec::with_capacity(blobs.len());
        for (index, blob) in blobs.into_iter().enumerate() {
            let id = uuid::Uuid::new_v4().to_string();
            let version = sha256_hex(&blob.bytes);
            let length = blob.bytes.len();
            let lineage = sources
                .iter()
                .map(|s| {
                    json!({"resourceId":s.resource_id,
                "contentVersion":s.content_version})
                })
                .collect::<Vec<_>>();
            let mut descriptor = json!({"index":index,"resourceId":id,"contentVersion":version,
                "mimeType":blob.mime_type,"byteLength":length,"expiresInSeconds":900,
                "origin":"worker-output","saved":false,
                "derivedFrom":{"resourceId":source.resource_id,"contentVersion":source.content_version}});
            if sources.len() > 1 {
                descriptor["derivedFromAll"] = json!(lineage);
            }
            descriptors.push(descriptor);
            pending.push((
                id,
                Record {
                    output_profile: profile,
                    owner: source.owner.clone(),
                    proof: proof.into(),
                    mime: blob.mime_type,
                    expected: length,
                    version,
                    chunks: vec![blob.bytes.into()],
                    uploaded: length,
                    confirmed: true,
                    expires: Instant::now() + Duration::from_secs(900),
                    parents: sources
                        .iter()
                        .map(|s| Ancestor {
                            access: s.clone(),
                            proof: proof.into(),
                        })
                        .collect(),
                },
            ));
        }
        Ok(Self {
            sources: sources.to_vec(),
            proof: proof.into(),
            total,
            records: pending,
            descriptors: Value::Array(descriptors),
            profile,
            host_report: None,
            host_report_bytes: 0,
        })
    }

    // The report is constructed only after the exact metadata profile and
    // schema were validated by the Host. Guest output types remain unchanged.
    pub(in crate::host_server::plugin_resources) fn attach_metadata_report(
        &mut self, report: &Value,
    ) -> Result<(), ApiError> {
        let bytes = serde_json::to_vec_pretty(report).map_err(|_| rejected("invalid_output"))?;
        if bytes.is_empty() || bytes.len() > 48 * 1024 || self.host_report.is_some() {
            return Err(rejected("invalid_output"));
        }
        let source = self.sources.first().ok_or_else(|| rejected("resource_metadata_invalid"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let version = sha256_hex(&bytes);
        let length = bytes.len();
        let descriptor = json!({"profile":"resource.host.image-metadata-report.draft1","index":0,"resourceId":id,"contentVersion":version,
            "mimeType":"application/json","byteLength":length,"expiresInSeconds":900,
            "origin":"host-report","saved":false,
            "derivedFrom":{"resourceId":source.resource_id,"contentVersion":source.content_version}});
        self.records.push((id, Record {
            output_profile: Profile::Draft1, owner: source.owner.clone(), proof: self.proof.clone(),
            mime:"application/json".into(), expected:length, version,
            chunks:vec![bytes.into()], uploaded:length, confirmed:true,
            expires:Instant::now()+Duration::from_secs(900),
            parents:self.sources.iter().map(|s|Ancestor{access:s.clone(),proof:self.proof.clone()}).collect(),
        }));
        self.total = self.total.checked_add(length).ok_or_else(|| rejected("resource_budget_exceeded"))?;
        self.host_report_bytes = length;
        self.host_report = Some(descriptor);
        Ok(())
    }
}

impl Store {
    pub(in crate::host_server::plugin_resources) fn publish_outputs(
        &mut self,
        pending: Pending,
        cancelled: &AtomicBool,
    ) -> Result<Value, ApiError> {
        self.publish_outputs_with_report(pending, cancelled).map(|(value, _)| value)
    }

    pub(in crate::host_server::plugin_resources) fn publish_outputs_with_report(
        &mut self,
        mut pending: Pending,
        cancelled: &AtomicBool,
    ) -> Result<(Value, Option<Value>), ApiError> {
        for source in &pending.sources {
            self.check(source, &pending.proof)?;
        }
        // A supplemental report must never make a previously valid image call
        // fail solely because the legacy pool or the last resource slot is full.
        let draft_used: usize = self.records.values().filter(|record|record.output_profile==Profile::Draft1).map(|record|record.expected).sum();
        let total_used: usize = self.records.values().map(|record|record.expected).sum();
        if pending.host_report.is_some() && (self.records.len() + pending.records.len() > MAX_RECORDS
            || pending.total > MAX_TOTAL_RESERVED.saturating_sub(total_used)
            || pending.host_report_bytes > MAX_RESERVED.saturating_sub(draft_used)) {
            pending.records.pop().ok_or_else(|| rejected("resource_metadata_invalid"))?;
            pending.total -= pending.host_report_bytes;
            pending.host_report_bytes = 0;
            pending.host_report = None;
        }
        if self.records.len() + pending.records.len() > MAX_RECORDS
            || pending.total
                > MAX_TOTAL_RESERVED.saturating_sub(self.records.values().map(|r| r.expected).sum())
            || (pending.profile==Profile::Draft1 && pending.total > MAX_RESERVED.saturating_sub(self.records.values().filter(|record|record.output_profile==Profile::Draft1).map(|record|record.expected).sum()))
            || (pending.profile!=Profile::Draft1 && pending.host_report_bytes > MAX_RESERVED.saturating_sub(self.records.values().filter(|record|record.output_profile==Profile::Draft1).map(|record|record.expected).sum()))
        {
            return Err(rejected("resource_budget_exceeded"));
        }
        // All hashes/copies are prepared before this final admission check.
        if cancelled.load(Ordering::Acquire) {
            return Err(rejected("worker_cancelled"));
        }
        self.records.extend(pending.records);
        Ok((pending.descriptors, pending.host_report))
    }

    #[cfg(test)]
    pub(in crate::host_server::plugin_resources) fn register_outputs(
        &mut self,
        source: &Access,
        proof: &str,
        blobs: Vec<Blob>,
    ) -> Result<Value, ApiError> {
        self.publish_outputs(
            Pending::prepare(std::slice::from_ref(source), proof, blobs)?,
            &AtomicBool::new(false),
        )
    }
}

#[cfg(test)]
#[path = "outputs_tests.rs"]
mod tests;
