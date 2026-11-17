//! Bounded, volatile two-step grants. Preparing shares no bytes or target resource.
use super::*;
const MAX_GRANTS: usize = 16;
const TTL: Duration = Duration::from_secs(60);

pub(super) struct Grant {
    pub(super) source: Access,
    source_proof: String,
    pub(super) target: Owner,
    target_proof: String,
    expires: Instant,
    result: Option<Access>,
    original: Option<Arc<file_reference::OriginalFile>>,
}

impl Store {
    pub(in crate::host_server::plugin_resources) fn lineage(
        &mut self,
        access: &Access,
        proof: &str,
    ) -> Result<Vec<(Access, String)>, ApiError> {
        self.check(access, proof)?;
        let mut ancestors = Vec::new();
        let mut pending = self
            .records
            .get(&access.resource_id)
            .map(|r| r.parents.clone())
            .unwrap_or_default();
        let mut seen = std::collections::HashSet::new();
        while let Some(parent) = pending.pop() {
            if !seen.insert(parent.access.resource_id.clone()) {
                continue;
            }
            if ancestors.len() >= MAX_RECORDS {
                return Err(rejected("resource_unavailable"));
            }
            self.check(&parent.access, &parent.proof)?;
            pending.extend(
                self.records
                    .get(&parent.access.resource_id)
                    .map(|r| r.parents.clone())
                    .unwrap_or_default(),
            );
            ancestors.push((parent.access, parent.proof));
        }
        Ok(ancestors)
    }

    pub(in crate::host_server::plugin_resources) fn prepare_transfer(
        &mut self,
        source: &Access,
        source_proof: &str,
        target: Owner,
        target_proof: String,
        original_file: bool,
    ) -> Result<Value, ApiError> {
        self.check(source, source_proof)?;
        if target.runtime_id != source.owner.runtime_id
            || target.session_id != source.owner.session_id
            || target == source.owner
        {
            return Err(rejected("resource_transfer_scope_invalid"));
        }
        self.transfers.retain(|_, g| g.expires > Instant::now());
        if self.transfers.len() >= MAX_GRANTS {
            return Err(rejected("resource_transfer_busy"));
        }
        let record = &self.records[&source.resource_id];
        let original = if record.is_file_reference() {
            return Err(rejected("resource_file_reference_requires_run"));
        } else if original_file {
            Some(file_reference::checked_source(record.original.as_ref(), record.expected, &source.owner, &target)?)
        } else {
            None
        };
        let id = uuid::Uuid::new_v4().to_string();
        let mut result = json!({"schemaVersion":1,"profile":file_reference::transfer_profile(original.is_some()),"grantId":id,"expiresInSeconds":60,
            "source":{"pluginId":source.owner.plugin_id,"capabilityId":source.owner.capability_id,"resourceId":source.resource_id,"contentVersion":source.content_version},
            "target":{"pluginId":target.plugin_id,"capabilityId":target.capability_id},
            "mimeType":file_reference::transfer_mime(original.is_some(), &record.mime),"byteLength":record.expected,"requiresConfirmation":true,"saved":false});
        if let Some(file) = &original {
            result["fileName"] = json!(file.name());
            result["contentRead"] = json!(false);
        }
        self.transfers.insert(
            id,
            Grant {
                source: source.clone(),
                source_proof: source_proof.into(),
                target,
                target_proof,
                expires: Instant::now() + TTL,
                result: None,
                original,
            },
        );
        Ok(result)
    }

    pub(in crate::host_server::plugin_resources) fn transfer_target(
        &mut self,
        source: &Access,
        id: &str,
    ) -> Result<file_reference::TransferTarget, ApiError> {
        self.transfers.retain(|_, g| g.expires > Instant::now());
        let grant = self
            .transfers
            .get(id)
            .filter(|g| {
                g.source.owner == source.owner
                    && g.source.resource_id == source.resource_id
                    && g.source.content_version == source.content_version
            })
            .ok_or_else(|| rejected("resource_transfer_unavailable"))?;
        let mime = self
            .records
            .get(&source.resource_id)
            .filter(|record| record.confirmed && record.version == source.content_version)
            .map(|record| file_reference::transfer_mime(grant.original.is_some(), &record.mime).to_owned())
            .ok_or_else(|| rejected("resource_unavailable"))?;
        Ok(file_reference::TransferTarget {
            owner: grant.target.clone(), mime, original: grant.original.clone(),
        })
    }

    pub(in crate::host_server::plugin_resources) fn commit_transfer(
        &mut self,
        source: &Access,
        id: &str,
        source_proof: &str,
        target_proof: &str,
    ) -> Result<Value, ApiError> {
        let target = self.transfer_target(source, id)?.owner;
        self.check(source, source_proof)?;
        let grant = &self.transfers[id];
        if grant.source_proof != source_proof || grant.target_proof != target_proof {
            return Err(rejected("resource_authorization_changed"));
        }
        let original = grant.original.clone();
        let (access, replayed) = if let Some(existing) = &grant.result {
            let access = existing.clone();
            self.check(&access, target_proof)?;
            (access, true)
        } else {
            let record = &self.records[&source.resource_id];
            if self.records.len() >= MAX_RECORDS
                || record.expected
                    > MAX_RESERVED.saturating_sub(self.records.values().map(|r| r.expected).sum())
            {
                return Err(rejected("resource_budget_exceeded"));
            }
            let access = Access {
                schema_version: 1,
                owner: target,
                resource_id: uuid::Uuid::new_v4().to_string(),
                content_version: source.content_version.clone(),
            };
            // Immutable Arc chunks avoid a full byte copy while holding the store lock.
            let delegated = Record {
                output_profile: record.output_profile,
                owner: access.owner.clone(),
                proof: target_proof.into(),
                mime: file_reference::transfer_mime(original.is_some(), &record.mime).into(),
                expected: record.expected,
                version: record.version.clone(),
                chunks: if original.is_some() { Vec::new() } else { record.chunks.clone() },
                original: original.clone().map(file_reference::FileBinding::AwaitingRead),
                uploaded: record.uploaded,
                confirmed: true,
                expires: record
                    .expires
                    .min(Instant::now() + Duration::from_secs(900)),
                parents: vec![Ancestor {
                    access: source.clone(),
                    proof: source_proof.into(),
                }],
            };
            self.records.insert(access.resource_id.clone(), delegated);
            self.transfers.get_mut(id).unwrap().result = Some(access.clone());
            (access, false)
        };
        let mut result = json!({"schemaVersion":1,"profile":file_reference::transfer_profile(original.is_some()),"status":"committed","replayed":replayed,
            "reference":{"capabilityId":access.owner.capability_id,"resourceId":access.resource_id,"contentVersion":access.content_version},"saved":false});
        if original.is_some() {
            result["contentRead"] = json!(false);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
