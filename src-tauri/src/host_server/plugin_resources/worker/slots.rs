//! Bound one plugin so it cannot occupy every resource Worker slot.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(super) struct PluginSlots(Arc<Mutex<HashMap<String, usize>>>);

const PER_PLUGIN: usize = 2;

pub(super) struct Lease {
    slots: PluginSlots,
    plugin_id: String,
}

impl PluginSlots {
    pub(super) fn try_acquire(&self, plugin_id: &str) -> Result<Lease, &'static str> {
        let mut active = self.0.lock().map_err(|_| "resource_worker_busy")?;
        let count = active.entry(plugin_id.to_owned()).or_default();
        if *count >= PER_PLUGIN {
            return Err("resource_worker_busy");
        }
        *count += 1;
        Ok(Lease {
            slots: self.clone(),
            plugin_id: plugin_id.to_owned(),
        })
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        let mut active = self
            .slots
            .0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(count) = active.get_mut(&self.plugin_id) {
            *count -= 1;
            if *count == 0 {
                active.remove(&self.plugin_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_plugin_does_not_occupy_another_plugins_slot() {
        let slots = PluginSlots::default();
        let first = slots.try_acquire("first").unwrap();
        let second = slots.try_acquire("first").unwrap();
        assert_eq!(
            slots.try_acquire("first").err().unwrap(),
            "resource_worker_busy"
        );
        let independent = slots.try_acquire("second").unwrap();
        drop(first);
        assert!(slots.try_acquire("first").is_ok());
        drop(second);
        drop(independent);
        assert!(slots.0.lock().unwrap().is_empty());
    }
}
