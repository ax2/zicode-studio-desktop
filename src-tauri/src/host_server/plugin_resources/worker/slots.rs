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
        self.try_acquire_with_limit(plugin_id, PER_PLUGIN)
    }

    pub(super) fn try_acquire_with_limit(
        &self,
        plugin_id: &str,
        maximum: usize,
    ) -> Result<Lease, &'static str> {
        let mut active = self.0.lock().map_err(|_| "resource_worker_busy")?;
        let count = active.entry(plugin_id.to_owned()).or_default();
        if *count >= maximum {
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

    #[test]
    fn image_resize_reservations_limit_global_and_per_plugin_concurrency() {
        let global = Arc::new(tokio::sync::Semaphore::new(
            crate::plugin_resource_execution::IMAGE_RESIZE_MAX_CALLS,
        ));
        let plugins = PluginSlots::default();

        let first_global = global.clone().try_acquire_owned().unwrap();
        let first_plugin = plugins.try_acquire_with_limit("images", 1).unwrap();
        assert!(plugins.try_acquire_with_limit("images", 1).is_err());

        let second_global = global.clone().try_acquire_owned().unwrap();
        let second_plugin = plugins.try_acquire_with_limit("other-images", 1).unwrap();
        assert!(global.clone().try_acquire_owned().is_err());

        drop(first_global);
        drop(first_plugin);
        assert!(global.clone().try_acquire_owned().is_ok());
        assert!(plugins.try_acquire_with_limit("images", 1).is_ok());
        drop(second_global);
        drop(second_plugin);
    }
}
