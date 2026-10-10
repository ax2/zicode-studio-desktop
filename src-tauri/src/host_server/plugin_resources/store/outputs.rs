//! Atomic derived-resource admission, sharing the input store's total budget.
use super::*;
use crate::plugin_worker::resource_output::{Blob, MAX_BYTES};
use std::sync::atomic::{AtomicBool, Ordering};

pub(in crate::host_server::plugin_resources) struct Pending {
    source: Access,
    proof: String,
    total: usize,
    records: Vec<(String, Record)>,
    descriptors: Value,
}

impl Pending {
    pub(in crate::host_server::plugin_resources) fn prepare(
        source: &Access,
        proof: &str,
        blobs: Vec<Blob>,
    ) -> Result<Self, ApiError> {
        let total = blobs
            .iter()
            .try_fold(0usize, |total, blob| total.checked_add(blob.bytes.len()))
            .filter(|n| *n <= MAX_BYTES)
            .ok_or_else(|| rejected("resource_budget_exceeded"))?;
        if blobs.len() > 4 {
            return Err(rejected("resource_budget_exceeded"));
        }
        if blobs.iter().any(|b| {
            !matches!(
                b.mime_type.as_str(),
                "application/octet-stream"
                    | "text/plain"
                    | "image/png"
                    | "image/jpeg"
                    | "image/webp"
            )
        }) {
            return Err(rejected("resource_metadata_invalid"));
        }
        // Build every record before mutation. No fallible validation after first insertion.
        let mut pending = Vec::with_capacity(blobs.len());
        let mut descriptors = Vec::with_capacity(blobs.len());
        for (index, blob) in blobs.into_iter().enumerate() {
            let id = uuid::Uuid::new_v4().to_string();
            let version = sha256_hex(&blob.bytes);
            let length = blob.bytes.len();
            descriptors.push(json!({"index":index,"resourceId":id,"contentVersion":version,
                "mimeType":blob.mime_type,"byteLength":length,"expiresInSeconds":900,
                "origin":"worker-output","saved":false,
                "derivedFrom":{"resourceId":source.resource_id,"contentVersion":source.content_version}}));
            pending.push((
                id,
                Record {
                    owner: source.owner.clone(),
                    proof: proof.into(),
                    mime: blob.mime_type,
                    expected: length,
                    version,
                    chunks: vec![blob.bytes.into()],
                    uploaded: length,
                    confirmed: true,
                    expires: Instant::now() + Duration::from_secs(900),
                    parent: Some(Ancestor { access: source.clone(), proof: proof.into() }),
                },
            ));
        }
        Ok(Self {
            source: source.clone(),
            proof: proof.into(),
            total,
            records: pending,
            descriptors: Value::Array(descriptors),
        })
    }
}

impl Store {
    pub(in crate::host_server::plugin_resources) fn publish_outputs(
        &mut self,
        pending: Pending,
        cancelled: &AtomicBool,
    ) -> Result<Value, ApiError> {
        self.check(&pending.source, &pending.proof)?;
        if self.records.len() + pending.records.len() > MAX_RECORDS
            || pending.total
                > MAX_RESERVED.saturating_sub(self.records.values().map(|r| r.expected).sum())
        {
            return Err(rejected("resource_budget_exceeded"));
        }
        // All hashes/copies are prepared before this final admission check.
        if cancelled.load(Ordering::Acquire) {
            return Err(rejected("worker_cancelled"));
        }
        self.records.extend(pending.records);
        Ok(pending.descriptors)
    }

    #[cfg(test)]
    pub(in crate::host_server::plugin_resources) fn register_outputs(
        &mut self,
        source: &Access,
        proof: &str,
        blobs: Vec<Blob>,
    ) -> Result<Value, ApiError> {
        self.publish_outputs(
            Pending::prepare(source, proof, blobs)?,
            &AtomicBool::new(false),
        )
    }
}

#[cfg(test)]
#[path = "outputs_tests.rs"]
mod tests;
