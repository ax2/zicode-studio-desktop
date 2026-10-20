//! Host-owned, one-use archive page cursors. Provider cursors stay inside the Host.
//! This is an internal precursor: it grants no native execution or file access.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_PENDING: usize = 128;
const MAX_PER_PLUGIN: usize = 16;
const LIFETIME: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Binding {
    pub plugin_id: String,
    pub package_version: String,
    pub capability_id: String,
    pub scene_id: String,
    pub runtime_id: String,
    pub session_id: String,
    pub resource_id: String,
    pub content_version: String,
    pub query: String,
    pub page_size: u16,
}

impl Binding {
    pub(crate) fn valid(&self) -> bool {
        [
            &self.plugin_id,
            &self.package_version,
            &self.capability_id,
            &self.scene_id,
            &self.runtime_id,
            &self.session_id,
            &self.resource_id,
            &self.content_version,
        ]
        .iter()
        .all(|value| !value.is_empty() && value.len() <= 256)
            && self.query.len() <= 256
            && (1..=200).contains(&self.page_size)
    }
}

struct Pending {
    binding: Binding,
    provider_cursor: String,
    expires: Instant,
}

#[derive(Default)]
pub(crate) struct ArchivePageCursors {
    pending: Mutex<HashMap<String, Pending>>,
}

impl ArchivePageCursors {
    /// Return only a random Host handle to the caller, never the provider token.
    pub(crate) fn seal(
        &self,
        binding: Binding,
        provider_cursor: &str,
    ) -> Result<String, &'static str> {
        self.seal_at(binding, provider_cursor, Instant::now())
    }

    fn seal_at(
        &self,
        binding: Binding,
        provider_cursor: &str,
        now: Instant,
    ) -> Result<String, &'static str> {
        if !binding.valid() || !valid_provider_cursor(provider_cursor) {
            return Err("archive_cursor_invalid");
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "archive_cursor_unavailable")?;
        pending.retain(|_, entry| entry.expires > now);
        if pending
            .values()
            .filter(|entry| entry.binding.plugin_id == binding.plugin_id)
            .count()
            >= MAX_PER_PLUGIN
        {
            return Err("archive_cursor_capacity");
        }
        if pending.len() >= MAX_PENDING {
            return Err("archive_cursor_capacity");
        }
        let expires = now
            .checked_add(LIFETIME)
            .ok_or("archive_cursor_unavailable")?;
        for _ in 0..4 {
            let handle = uuid::Uuid::new_v4().simple().to_string();
            if let std::collections::hash_map::Entry::Vacant(entry) = pending.entry(handle.clone())
            {
                entry.insert(Pending {
                    binding,
                    provider_cursor: provider_cursor.into(),
                    expires,
                });
                return Ok(handle);
            }
        }
        Err("archive_cursor_unavailable")
    }

    /// An exact binding match consumes the handle. Wrong identity leaves it inaccessible.
    pub(crate) fn take(&self, handle: &str, binding: &Binding) -> Result<String, &'static str> {
        self.take_at(handle, binding, Instant::now())
    }

    fn take_at(
        &self,
        handle: &str,
        binding: &Binding,
        now: Instant,
    ) -> Result<String, &'static str> {
        if handle.len() != 32
            || !handle.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !binding.valid()
        {
            return Err("archive_cursor_invalid");
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "archive_cursor_unavailable")?;
        pending.retain(|_, entry| entry.expires > now);
        if pending
            .get(handle)
            .is_none_or(|entry| entry.binding != *binding)
        {
            return Err("archive_cursor_invalid");
        }
        pending
            .remove(handle)
            .map(|entry| entry.provider_cursor)
            .ok_or("archive_cursor_invalid")
    }

    pub(crate) fn invalidate_resource(&self, resource_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, entry| entry.binding.resource_id != resource_id);
        }
    }

    pub(crate) fn invalidate_plugin(&self, plugin_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, entry| entry.binding.plugin_id != plugin_id);
        }
    }

    pub(crate) fn invalidate_runtime(&self, runtime_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, entry| entry.binding.runtime_id != runtime_id);
        }
    }

    pub(crate) fn invalidate_all(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

pub(crate) fn valid_provider_cursor(cursor: &str) -> bool {
    (16..=512).contains(&cursor.len())
        && cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> Binding {
        Binding {
            plugin_id: "com.zicode.zifile.archive".into(),
            package_version: "1.0.0".into(),
            capability_id: "archive.list".into(),
            scene_id: "programming".into(),
            runtime_id: "runtime-a".into(),
            session_id: "session-a".into(),
            resource_id: "resource-a".into(),
            content_version: "sha256:a".into(),
            query: "notes".into(),
            page_size: 50,
        }
    }

    #[test]
    fn binds_and_consumes_without_exposing_provider_token() {
        let store = ArchivePageCursors::default();
        let provider = "abcdefghijklmnop0123456789";
        let handle = store.seal(binding(), provider).unwrap();
        assert_eq!(handle.len(), 32);
        assert!(!handle.contains(provider));
        let mut wrong = binding();
        wrong.package_version = "2.0.0".into();
        assert_eq!(store.take(&handle, &wrong), Err("archive_cursor_invalid"));
        wrong = binding();
        wrong.content_version = "sha256:b".into();
        assert_eq!(store.take(&handle, &wrong), Err("archive_cursor_invalid"));
        assert_eq!(store.take(&handle, &binding()), Ok(provider.into()));
        assert_eq!(
            store.take(&handle, &binding()),
            Err("archive_cursor_invalid")
        );
    }

    #[test]
    fn rejects_expired_invalid_and_revoked_cursors() {
        let store = ArchivePageCursors::default();
        let now = Instant::now();
        let provider = "abcdefghijklmnop";
        assert_eq!(store.seal(binding(), "bad"), Err("archive_cursor_invalid"));
        let handle = store.seal_at(binding(), provider, now).unwrap();
        assert_eq!(
            store.take_at(&handle, &binding(), now + LIFETIME),
            Err("archive_cursor_invalid")
        );
        let second = store.seal(binding(), provider).unwrap();
        store.invalidate_resource("resource-a");
        assert_eq!(
            store.take(&second, &binding()),
            Err("archive_cursor_invalid")
        );
    }

    #[test]
    fn limits_each_plugin_without_starving_other_plugins() {
        let store = ArchivePageCursors::default();
        for _ in 0..MAX_PER_PLUGIN {
            store.seal(binding(), "abcdefghijklmnop").unwrap();
        }
        assert_eq!(
            store.seal(binding(), "abcdefghijklmnop"),
            Err("archive_cursor_capacity")
        );
        let mut other = binding();
        other.plugin_id = "com.example.other".into();
        let handle = store.seal(other.clone(), "ponmlkjihgfedcba").unwrap();
        assert_eq!(store.take(&handle, &other), Ok("ponmlkjihgfedcba".into()));
    }

    #[test]
    fn preserves_global_capacity_across_plugins() {
        let store = ArchivePageCursors::default();
        for plugin in 0..(MAX_PENDING / MAX_PER_PLUGIN) {
            let mut owner = binding();
            owner.plugin_id = format!("com.example.plugin-{plugin}");
            for _ in 0..MAX_PER_PLUGIN {
                store.seal(owner.clone(), "abcdefghijklmnop").unwrap();
            }
        }
        let mut ninth = binding();
        ninth.plugin_id = "com.example.ninth".into();
        assert_eq!(
            store.seal(ninth, "abcdefghijklmnop"),
            Err("archive_cursor_capacity")
        );
    }

    #[test]
    fn plugin_lifecycle_releases_only_its_pending_cursors() {
        let store = ArchivePageCursors::default();
        let original = binding();
        let first = store.seal(original.clone(), "abcdefghijklmnop").unwrap();
        let mut other = original.clone();
        other.plugin_id = "com.example.other".into();
        let second = store.seal(other.clone(), "ponmlkjihgfedcba").unwrap();
        store.invalidate_plugin(&original.plugin_id);
        assert_eq!(store.take(&first, &original), Err("archive_cursor_invalid"));
        assert_eq!(store.take(&second, &other), Ok("ponmlkjihgfedcba".into()));
        let third = store.seal(other.clone(), "ponmlkjihgfedcba").unwrap();
        store.invalidate_all();
        assert_eq!(store.take(&third, &other), Err("archive_cursor_invalid"));
    }
}
