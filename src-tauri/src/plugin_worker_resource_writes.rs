//! Bounded append-only guest output buffers. No filesystem, network or grant access.
use super::resource_output::{Blob, MIMES, Profile};
#[cfg(test)]
use super::resource_output::MAX_BYTES;
use wasmtime::{Caller, Linker};

struct Record {
    blob: Blob,
    expected: usize,
    sealed: bool,
}
pub(super) struct Writes {
    profile: Profile,
    records: Vec<Record>,
    reserved: usize,
    calls: usize,
}
impl Default for Writes {
    fn default() -> Self {
        Self {
            profile: Profile::Draft1,
            records: Vec::new(),
            reserved: 0,
            calls: 4096,
        }
    }
}
impl Writes {
    pub(super) fn for_profile(profile: Profile) -> Self {
        Self { profile, ..Self::default() }
    }
    fn attempt(&mut self) -> bool {
        if self.calls == 0 {
            false
        } else {
            self.calls -= 1;
            true
        }
    }
    fn create(&mut self, mime: i32, length: i64) -> i32 {
        if !self.attempt() {
            return -3;
        }
        let Some(mime) = MIMES.get(mime as usize) else {
            return -1;
        };
        if !self.profile.permits_mime(mime) { return -1; }
        let Ok(length) = usize::try_from(length) else {
            return -1;
        };
        if self.records.len() == self.profile.max_records()
            || length > self.profile.max_file()
            || length > self.profile.max_bytes().saturating_sub(self.reserved) {
            return -3;
        }
        let mut bytes = Vec::new();
        if bytes.try_reserve_exact(length).is_err() {
            return -4;
        }
        let index = self.records.len();
        self.records.push(Record {
            blob: Blob {
                mime_type: (*mime).into(),
                bytes,
            },
            expected: length,
            sealed: false,
        });
        self.reserved += length;
        index as i32
    }
    fn append(&mut self, index: i32, bytes: &[u8]) -> i32 {
        let Some(record) = self.records.get_mut(index as usize) else {
            return -1;
        };
        if record.sealed
            || bytes.is_empty()
            || bytes.len() > 65536
            || bytes.len() > record.expected - record.blob.bytes.len()
        {
            return -1;
        }
        record.blob.bytes.extend_from_slice(bytes);
        bytes.len() as i32
    }
    fn seal(&mut self, index: i32) -> i32 {
        if !self.attempt() {
            return -3;
        }
        let Some(record) = self.records.get_mut(index as usize) else {
            return -1;
        };
        if record.blob.bytes.len() != record.expected {
            return -1;
        }
        record.sealed = true;
        0
    }
    pub(super) fn finish(self) -> Result<Vec<Blob>, String> {
        if self.records.iter().any(|record| !record.sealed) {
            return Err("Resource output is incomplete".into());
        }
        Ok(self.records.into_iter().map(|record| record.blob).collect())
    }
}

pub(super) fn link<T: 'static>(
    linker: &mut Linker<T>,
    state: fn(&mut T) -> &mut Writes,
) -> Result<(), String> {
    link_with_profile(linker, state, Profile::Draft1)
}

pub(super) fn link_with_profile<T: 'static>(
    linker: &mut Linker<T>,
    state: fn(&mut T) -> &mut Writes,
    profile: Profile,
) -> Result<(), String> {
    let namespace = profile.namespace();
    linker
        .func_wrap(
            namespace,
            "create",
            move |mut caller: Caller<'_, T>, mime: i32, length: i64| -> i32 {
                state(caller.data_mut()).create(mime, length)
            },
        )
        .map_err(|_| "Cannot link resource output create".to_string())?;
    linker
        .func_wrap(
            namespace,
            "write",
            move |mut caller: Caller<'_, T>, index: i32, source: i32, length: i32| -> i32 {
                if !state(caller.data_mut()).attempt() {
                    return -3;
                }
                if length <= 0 || length > 65536 {
                    return -1;
                }
                let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) else {
                    return -2;
                };
                let mut bytes = vec![0; length as usize];
                if memory.read(&caller, source as usize, &mut bytes).is_err() {
                    return -2;
                }
                state(caller.data_mut()).append(index, &bytes)
            },
        )
        .map_err(|_| "Cannot link resource output write".to_string())?;
    linker
        .func_wrap(
            namespace,
            "finish",
            move |mut caller: Caller<'_, T>, index: i32| -> i32 {
                state(caller.data_mut()).seal(index)
            },
        )
        .map_err(|_| "Cannot link resource output finish".to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "plugin_worker_resource_writes_tests.rs"]
mod tests;
