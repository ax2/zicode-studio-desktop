use super::*;
const MAX_RESOURCE: usize = 32 * 1024 * 1024;
const MAX_RESERVED: usize = 128 * 1024 * 1024;
const MAX_RECORDS: usize = 32;
const MAX_CHUNKS: usize = MAX_RESOURCE.div_ceil(MAX_CHUNK);

struct Record {
    owner: Owner,
    proof: String,
    mime: String,
    expected: usize,
    version: String,
    chunks: Vec<Arc<[u8]>>,
    uploaded: usize,
    confirmed: bool,
    expires: Instant,
    parents: Vec<Ancestor>,
}

#[derive(Clone)]
struct Ancestor { access: Access, proof: String }

#[cfg(test)]
mod tests;

#[derive(Default)]
pub(crate) struct Store {
    pub(super) file_imports: local_file::Grants,
    records: HashMap<String, Record>,
    transfers: HashMap<String, transfer::Grant>,
    saves: HashMap<String, save::SaveGrant>,
}
mod outputs;
mod transfer;
mod save;
pub(in crate::host_server::plugin_resources) use outputs::Pending;

impl Store {
    pub(super) fn import_file(&mut self, owner: Owner, proof: String, bytes: Vec<u8>) -> Result<Value, ApiError> {
        let version = sha256_hex(&bytes);
        let prepared = self.prepare(Prepare { schema_version: 1, owner: owner.clone(), mime_type: "application/octet-stream".into(),
            byte_length: bytes.len(), content_version: version.clone(), catalog_revision: None }, proof.clone())?;
        let access = Access { schema_version: 1, owner, resource_id: prepared["resourceId"].as_str().unwrap().into(), content_version: version };
        let result = (|| {
            for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
                self.append(&access, &proof, index * MAX_CHUNK, chunk.to_vec())?;
            }
            let mut result = self.commit(&access, &proof)?;
            result["access"] = serde_json::to_value(&access).unwrap();
            result["profile"] = json!("resource.local-file.draft1");
            result["saved"] = json!(false);
            Ok(result)
        })();
        if result.is_err() { self.records.remove(&access.resource_id); }
        result
    }
    #[cfg(test)]
    pub(in crate::host_server::plugin_resources) fn record_count(&self) -> usize {
        self.records.len()
    }
    fn prune(&mut self) {
        self.records.retain(|_, r| r.expires > Instant::now());
        // Descendants cannot outlive a missing/expired/revoked ancestor.
        loop {
            let stale: Vec<_> = self
                .records
                .iter()
                .filter(|(_, r)| {
                    r.parents.iter().any(|ancestor| {
                        !self.records.get(&ancestor.access.resource_id).is_some_and(|p| {
                            p.confirmed
                                && p.version == ancestor.access.content_version
                                && p.owner == ancestor.access.owner
                                && p.proof == ancestor.proof
                        })
                    })
                })
                .map(|(id, _)| id.clone())
                .collect();
            if stale.is_empty() {
                break;
            }
            for id in stale {
                self.records.remove(&id);
            }
        }
    }

    pub(super) fn prepare(&mut self, request: Prepare, proof: String) -> Result<Value, ApiError> {
        self.prune();
        if !matches!(
            request.mime_type.as_str(),
            "application/octet-stream" | "text/plain" | "image/png" | "image/jpeg" | "image/webp"
        ) || request.content_version.len() != 64
            || !request
                .content_version
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(rejected("resource_metadata_invalid"));
        }
        if request.byte_length > MAX_RESOURCE
            || self.records.len() >= MAX_RECORDS
            || self.records.values().map(|r| r.expected).sum::<usize>() + request.byte_length
                > MAX_RESERVED
        {
            return Err(rejected("resource_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.records.insert(
            id.clone(),
            Record {
                owner: request.owner,
                proof,
                mime: request.mime_type,
                expected: request.byte_length,
                version: request.content_version,
                chunks: Vec::new(),
                uploaded: 0,
                confirmed: false,
                expires: Instant::now() + Duration::from_secs(120),
                parents: Vec::new(),
            },
        );
        Ok(
            json!({"schemaVersion":1,"resourceId":id,"expiresInSeconds":120,"maxChunkBytes":MAX_CHUNK,"maxChunks":MAX_CHUNKS,"confirmed":false}),
        )
    }

    fn record(&mut self, access: &Access, proof: &str) -> Result<&mut Record, ApiError> {
        self.prune();
        self.records
            .get_mut(&access.resource_id)
            .filter(|r| {
                r.owner == access.owner && r.proof == proof && r.version == access.content_version
            })
            .ok_or_else(|| rejected("resource_unavailable"))
    }

    pub(super) fn append(
        &mut self,
        access: &Access,
        proof: &str,
        offset: usize,
        data: Vec<u8>,
    ) -> Result<Value, ApiError> {
        let r = self.record(access, proof)?;
        if r.confirmed
            || r.chunks.len() >= MAX_CHUNKS
            || offset != r.uploaded
            || data.is_empty()
            || data.len() > MAX_CHUNK
            || data.len() > r.expected.saturating_sub(r.uploaded)
        {
            return Err(rejected("resource_upload_conflict"));
        }
        r.uploaded += data.len();
        r.chunks.push(data.into());
        Ok(json!({"schemaVersion":1,"uploadedBytes":r.uploaded}))
    }

    pub(super) fn commit(&mut self, access: &Access, proof: &str) -> Result<Value, ApiError> {
        let r = self.record(access, proof)?;
        if r.uploaded != r.expected {
            return Err(rejected("resource_upload_incomplete"));
        }
        if !r.confirmed {
            let mut hash = Sha256::new();
            for chunk in &r.chunks {
                hash.update(chunk);
            }
            if format!("{:x}", hash.finalize()) != r.version {
                return Err(rejected("resource_content_mismatch"));
            }
            r.confirmed = true;
            r.expires = Instant::now() + Duration::from_secs(900);
        }
        Ok(
            json!({"schemaVersion":1,"resourceId":access.resource_id,"mimeType":r.mime,
            "byteLength":r.expected,"contentVersion":r.version,"confirmed":true}),
        )
    }

    pub(super) fn read(
        &mut self,
        access: &Access,
        proof: &str,
        offset: usize,
        length: usize,
    ) -> Result<Value, ApiError> {
        let r = self.record(access, proof)?;
        if !r.confirmed {
            return Err(rejected("resource_confirmation_required"));
        }
        if offset > r.expected || length == 0 || length > MAX_CHUNK {
            return Err(rejected("resource_range_invalid"));
        }
        let end = offset.saturating_add(length).min(r.expected);
        let mut data = Vec::with_capacity(end - offset);
        let mut position = 0;
        for chunk in &r.chunks {
            let next = position + chunk.len();
            if next > offset && position < end {
                data.extend_from_slice(
                    &chunk[offset.saturating_sub(position)..(end - position).min(chunk.len())],
                );
            }
            position = next;
            if position >= end {
                break;
            }
        }
        Ok(
            json!({"schemaVersion":1,"resourceId":access.resource_id,"contentVersion":r.version,
            "offset":offset,"byteLength":data.len(),"eof":end == r.expected,
            "dataBase64":base64::engine::general_purpose::STANDARD.encode(data)}),
        )
    }

    pub(super) fn revoke(&mut self, access: &Access) -> Result<(), ApiError> {
        self.prune();
        if let Some(r) = self.records.get(&access.resource_id) {
            if r.owner != access.owner || r.version != access.content_version {
                return Err(rejected("resource_unavailable"));
            }
        }
        self.records.remove(&access.resource_id);
        self.prune();
        Ok(())
    }

    pub(super) fn snapshot(
        &mut self,
        access: &Access,
        proof: &str,
    ) -> Result<crate::plugin_worker::resource_input::Resource, ApiError> {
        let r = self.record(access, proof)?;
        if !r.confirmed {
            return Err(rejected("resource_confirmation_required"));
        }
        let mut bytes = Vec::with_capacity(r.expected);
        for chunk in &r.chunks {
            bytes.extend_from_slice(chunk);
        }
        Ok(crate::plugin_worker::resource_input::Resource {
            descriptor: crate::plugin_worker::resource_input::Descriptor {
                resource_id: access.resource_id.clone(),
                content_version: r.version.clone(),
                mime_type: r.mime.clone(),
                byte_length: r.expected,
            },
            bytes,
        })
    }

    pub(super) fn check(&mut self, access: &Access, proof: &str) -> Result<(), ApiError> {
        if !self.record(access, proof)?.confirmed {
            return Err(rejected("resource_confirmation_required"));
        }
        Ok(())
    }
}
