use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Key = (String, String, String);
const CAPACITY: usize = 2048;
const PER_RUNTIME: usize = 128;
const ACTIVE_LIMIT: usize = 64;
const RETENTION: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    PendingCancel,
    Active,
    Finished,
}
struct Entry {
    flag: Arc<AtomicBool>,
    phase: Phase,
    changed: Instant,
}
#[derive(Clone, Default)]
pub(super) struct Calls(Arc<Mutex<HashMap<Key, Entry>>>);
pub(super) struct Lease {
    calls: Calls,
    key: Key,
    pub flag: Arc<AtomicBool>,
}

impl Calls {
    // A read never reserves a cancellation tombstone or refreshes retention.
    // Unknown is deliberately not evidence that a delayed request cannot start.
    pub fn snapshot(
        &self,
        runtime: &str,
        session: &str,
        call: &str,
    ) -> Result<(&'static str, bool, bool), &'static str> {
        let mut entries = self.0.lock().map_err(|_| "plugin_calls_unavailable")?;
        Self::prune(&mut entries);
        Ok(match entries.get(&(runtime.into(), session.into(), call.into())) {
            None => ("unknown", false, false),
            Some(entry) => (
                match entry.phase {
                    Phase::PendingCancel => "cancel_pending",
                    Phase::Active => "active",
                    Phase::Finished => "finished",
                },
                entry.phase == Phase::Finished,
                entry.flag.load(Ordering::Acquire),
            ),
        })
    }
    fn prune(entries: &mut HashMap<Key, Entry>) {
        entries
            .retain(|_, entry| entry.phase == Phase::Active || entry.changed.elapsed() < RETENTION);
    }
    fn reserve(entries: &mut HashMap<Key, Entry>, key: &Key) -> Result<(), &'static str> {
        if entries.contains_key(key) {
            return Ok(());
        }
        let scoped = entries.keys().filter(|item| item.0 == key.0).count() >= PER_RUNTIME;
        if scoped || entries.len() >= CAPACITY {
            let victim = entries
                .iter()
                .filter(|(item, entry)| {
                    entry.phase == Phase::Finished && (!scoped || item.0 == key.0)
                })
                .min_by_key(|(_, entry)| entry.changed)
                .map(|(item, _)| item.clone());
            if let Some(victim) = victim {
                entries.remove(&victim);
            } else {
                return Err("plugin_call_budget_exceeded");
            }
        }
        Ok(())
    }
    pub fn begin(&self, runtime: &str, session: &str, call: &str) -> Result<Lease, &'static str> {
        let key = (runtime.into(), session.into(), call.into());
        let mut entries = self.0.lock().map_err(|_| "plugin_calls_unavailable")?;
        Self::prune(&mut entries);
        if entries
            .get(&key)
            .is_some_and(|entry| entry.phase == Phase::Active)
        {
            return Err("plugin_call_in_progress");
        }
        if entries
            .values()
            .filter(|entry| entry.phase == Phase::Active)
            .count()
            >= ACTIVE_LIMIT
        {
            return Err("plugin_call_budget_exceeded");
        }
        Self::reserve(&mut entries, &key)?;
        let flag = entries
            .get(&key)
            .filter(|entry| entry.phase == Phase::PendingCancel)
            .map(|entry| entry.flag.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        entries.insert(
            key.clone(),
            Entry {
                flag: flag.clone(),
                phase: Phase::Active,
                changed: Instant::now(),
            },
        );
        Ok(Lease {
            calls: self.clone(),
            key,
            flag,
        })
    }
    pub fn cancel(
        &self,
        runtime: &str,
        session: &str,
        call: &str,
    ) -> Result<(&'static str, bool), &'static str> {
        let key = (runtime.into(), session.into(), call.into());
        let mut entries = self.0.lock().map_err(|_| "plugin_calls_unavailable")?;
        Self::prune(&mut entries);
        Self::reserve(&mut entries, &key)?;
        let entry = entries.entry(key).or_insert_with(|| Entry {
            flag: Arc::new(AtomicBool::new(true)),
            phase: Phase::PendingCancel,
            changed: Instant::now(),
        });
        if entry.phase == Phase::Finished {
            return Ok(("finished", true));
        }
        entry.flag.store(true, Ordering::Release);
        Ok((
            if entry.phase == Phase::Active {
                "requested"
            } else {
                "pending"
            },
            false,
        ))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.calls.0.lock() {
            if let Some(entry) = entries.get_mut(&self.key) {
                entry.phase = Phase::Finished;
                entry.changed = Instant::now();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_are_scoped_read_only_and_never_extend_retention() {
        let calls = Calls::default();
        assert_eq!(calls.snapshot("r", "s", "c").unwrap(), ("unknown", false, false));
        assert!(calls.0.lock().unwrap().is_empty());
        calls.cancel("r", "s", "c").unwrap();
        assert_eq!(calls.snapshot("r", "s", "c").unwrap(), ("cancel_pending", false, true));
        let lease = calls.begin("r", "s", "c").unwrap();
        assert_eq!(calls.snapshot("r", "s", "c").unwrap(), ("active", false, true));
        assert_eq!(calls.snapshot("other", "s", "c").unwrap(), ("unknown", false, false));
        assert_eq!(calls.snapshot("r", "other", "c").unwrap(), ("unknown", false, false));
        // Active execution must not expire, even beyond terminal retention.
        calls.0.lock().unwrap().values_mut().next().unwrap().changed = Instant::now() - RETENTION;
        assert_eq!(calls.snapshot("r", "s", "c").unwrap().0, "active");
        drop(lease);
        assert_eq!(calls.snapshot("r", "s", "c").unwrap(), ("finished", true, true));
        let changed = calls.0.lock().unwrap().values().next().unwrap().changed;
        calls.snapshot("r", "s", "c").unwrap();
        assert_eq!(calls.0.lock().unwrap().values().next().unwrap().changed, changed);
        calls.0.lock().unwrap().values_mut().next().unwrap().changed = Instant::now() - RETENTION;
        assert_eq!(calls.snapshot("r", "s", "c").unwrap(), ("unknown", false, false));
        assert!(calls.0.lock().unwrap().is_empty());
    }
    #[test]
    fn global_and_active_budgets_release_slots_after_completion() {
        let calls = Calls::default();
        let mut leases = Vec::new();
        for index in 0..ACTIVE_LIMIT {
            leases.push(calls.begin(&index.to_string(), "s", "active").unwrap());
        }
        assert_eq!(
            calls.begin("extra", "s", "active").err().unwrap(),
            "plugin_call_budget_exceeded"
        );
        leases.pop();
        assert!(calls.begin("extra", "s", "active").is_ok());
        drop(leases);
        let calls = Calls::default();
        for index in 0..CAPACITY {
            calls
                .cancel(
                    &(index / PER_RUNTIME).to_string(),
                    "s",
                    &(index % PER_RUNTIME).to_string(),
                )
                .unwrap();
        }
        assert_eq!(
            calls.cancel("extra", "s", "pending").unwrap_err(),
            "plugin_call_budget_exceeded"
        );
        assert_eq!(calls.0.lock().unwrap().len(), CAPACITY);
    }
    #[test]
    fn cancellation_covers_pending_active_finished_and_scope_boundaries() {
        let calls = Calls::default();
        assert_eq!(calls.cancel("a", "s", "x").unwrap(), ("pending", false));
        let pending = calls.begin("a", "s", "x").unwrap();
        assert!(pending.flag.load(Ordering::Acquire));
        let other = calls.begin("b", "s", "x").unwrap();
        assert!(!other.flag.load(Ordering::Acquire));
        assert_eq!(
            calls.begin("b", "s", "x").err().unwrap(),
            "plugin_call_in_progress"
        );
        assert_eq!(calls.cancel("b", "s", "x").unwrap(), ("requested", false));
        assert!(other.flag.load(Ordering::Acquire));
        drop(other);
        assert_eq!(calls.cancel("b", "s", "x").unwrap(), ("finished", true));
        let retry = calls.begin("b", "s", "x").unwrap();
        assert!(!retry.flag.load(Ordering::Acquire));
    }
    #[test]
    fn budget_retention_and_completed_eviction_do_not_discard_pending_cancellation() {
        let calls = Calls::default();
        for index in 0..PER_RUNTIME {
            calls.cancel("a", "s", &index.to_string()).unwrap();
        }
        assert_eq!(
            calls.cancel("a", "s", "overflow").unwrap_err(),
            "plugin_call_budget_exceeded"
        );
        assert!(calls.cancel("b", "s", "independent").is_ok());
        drop(calls.begin("a", "s", "0").unwrap());
        assert!(calls.cancel("a", "s", "new").is_ok());
        let mut entries = calls.0.lock().unwrap();
        for entry in entries.values_mut() {
            entry.changed = Instant::now() - RETENTION;
        }
        drop(entries);
        assert!(calls.cancel("a", "s", "after-expiry").is_ok());
        assert_eq!(calls.0.lock().unwrap().len(), 1);
    }
}
