//! Native COM callbacks may retire a window while its browser map is borrowed.
//! Queue that retirement, then drop native views outside the map borrow.
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};

pub(super) struct WindowRegistry<T> {
    values: RefCell<HashMap<String, T>>,
    retired: RefCell<HashSet<String>>,
}
impl<T> Default for WindowRegistry<T> {
    fn default() -> Self {
        Self {
            values: RefCell::new(HashMap::new()),
            retired: RefCell::new(HashSet::new()),
        }
    }
}
impl<T> WindowRegistry<T> {
    pub(super) fn with_mut<R>(
        &self,
        action: impl FnOnce(&mut HashMap<String, T>) -> Result<R, String>,
    ) -> Result<R, String> {
        let _cleanup = Cleanup(self);
        let mut values = self
            .values
            .try_borrow_mut()
            .map_err(|_| "Browser is busy; retry after the current operation")?;
        action(&mut values)
    }
    pub(super) fn retire(&self, owner: &str) {
        self.retired.borrow_mut().insert(owner.to_owned());
        self.sweep();
    }
    fn sweep(&self) {
        let Ok(mut values) = self.values.try_borrow_mut() else {
            return;
        };
        let pending = std::mem::take(&mut *self.retired.borrow_mut());
        let removed: Vec<_> = pending
            .into_iter()
            .filter_map(|owner| values.remove(&owner))
            .collect();
        drop(values);
        // Destructors can synchronously trigger more native callbacks.
        drop(removed);
    }
}
struct Cleanup<'a, T>(&'a WindowRegistry<T>);
impl<T> Drop for Cleanup<'_, T> {
    fn drop(&mut self) {
        self.0.sweep();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;
    struct NativeDrop(Box<dyn Fn()>);
    impl Drop for NativeDrop {
        fn drop(&mut self) {
            (self.0)();
        }
    }

    #[test]
    fn reentrant_close_is_released_even_when_operation_fails() {
        let registry = WindowRegistry::default();
        let dropped = Rc::new(RefCell::new(Vec::new()));
        registry
            .with_mut(|windows| {
                for owner in ["closing", "peer"] {
                    let result = dropped.clone();
                    windows.insert(
                        owner.into(),
                        NativeDrop(Box::new(move || result.borrow_mut().push(owner))),
                    );
                }
                Ok(())
            })
            .unwrap();
        let result: Result<(), String> = registry.with_mut(|windows| {
            registry.retire("closing");
            registry.retire("closing");
            assert!(windows.contains_key("closing"));
            assert!(registry.with_mut(|_| Ok(())).is_err());
            Err("native navigation failed".into())
        });
        assert!(result.is_err());
        assert_eq!(*dropped.borrow(), ["closing"]);
        registry
            .with_mut(|windows| {
                assert_eq!(windows.len(), 1);
                assert!(windows.contains_key("peer"));
                Ok(())
            })
            .unwrap();
        registry.retire("peer");
        assert_eq!(*dropped.borrow(), ["closing", "peer"]);
    }

    #[test]
    fn native_destructor_can_close_another_owner_without_borrowing_panic() {
        let registry = Rc::new(WindowRegistry::default());
        let weak = Rc::downgrade(&registry);
        let dropped = Rc::new(RefCell::new(Vec::new()));
        let result = dropped.clone();
        registry
            .with_mut(|windows| {
                windows.insert(
                    "first".into(),
                    NativeDrop(Box::new(move || {
                        result.borrow_mut().push("first");
                        weak.upgrade().unwrap().retire("second");
                    })),
                );
                let result = dropped.clone();
                windows.insert(
                    "second".into(),
                    NativeDrop(Box::new(move || result.borrow_mut().push("second"))),
                );
                Ok(())
            })
            .unwrap();
        registry.retire("first");
        assert_eq!(*dropped.borrow(), ["first", "second"]);
        registry
            .with_mut(|windows| {
                assert!(windows.is_empty());
                Ok(())
            })
            .unwrap();
    }
}
