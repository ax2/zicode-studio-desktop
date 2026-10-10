//! Read-only imports for the internal resource-input candidate, without filesystem access.
use super::resource_input::Resource;
use wasmtime::{Caller, Linker};

pub(super) struct Reads {
    pub resources: Vec<Resource>,
    remaining_bytes: usize,
    remaining_calls: usize,
}

impl Reads {
    pub fn new(resources: Vec<Resource>) -> Self {
        Self {
            resources,
            remaining_bytes: 64 * 1024 * 1024,
            remaining_calls: 4096,
        }
    }
}

pub(super) fn link<T: 'static>(
    linker: &mut Linker<T>,
    state: fn(&mut T) -> &mut Reads,
) -> Result<(), String> {
    linker
        .func_wrap(
            "zicode_resource_input_draft1",
            "size",
            move |mut caller: Caller<'_, T>, index: i32| -> i64 {
                state(caller.data_mut())
                    .resources
                    .get(index as usize)
                    .map(|r| r.bytes.len() as i64)
                    .unwrap_or(-1)
            },
        )
        .map_err(|_| "Cannot link resource input size".to_string())?;
    linker
        .func_wrap(
            "zicode_resource_input_draft1",
            "read",
            move |mut caller: Caller<'_, T>,
                  index: i32,
                  offset: i64,
                  destination: i32,
                  length: i32|
                  -> i32 {
                let reads = state(caller.data_mut());
                if reads.remaining_calls == 0 {
                    return -3;
                }
                reads.remaining_calls -= 1;
                let Ok(offset) = usize::try_from(offset) else {
                    return -1;
                };
                let Ok(length) = usize::try_from(length) else {
                    return -1;
                };
                let Ok(destination) = usize::try_from(destination) else {
                    return -2;
                };
                let Some(resource) = reads.resources.get(index as usize) else {
                    return -1;
                };
                if length > 64 * 1024 || offset > resource.bytes.len() {
                    return -1;
                }
                let end = offset.saturating_add(length).min(resource.bytes.len());
                let actual = end - offset;
                if actual > reads.remaining_bytes {
                    return -3;
                }
                // A single bounded copy avoids holding a Store borrow while writing guest memory.
                let bytes = resource.bytes[offset..end].to_vec();
                let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) else {
                    return -2;
                };
                if memory.write(&mut caller, destination, &bytes).is_err() {
                    return -2;
                }
                state(caller.data_mut()).remaining_bytes -= actual;
                actual as i32
            },
        )
        .map_err(|_| "Cannot link resource input read".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_worker::resource_input::Descriptor;
    use wasmtime::{Engine, Module, Store};

    #[test]
    fn actual_guest_memory_reads_enforce_ranges_and_work_budgets() {
        let engine = Engine::default();
        let module = Module::new(&engine, r#"(module
            (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
            (memory (export "memory") 1)
            (func (export "probe") (param i32 i64 i32 i32) (result i32)
                local.get 0 local.get 1 local.get 2 local.get 3 call $read))"#).unwrap();
        let descriptor: Descriptor = serde_json::from_value(serde_json::json!({
            "resourceId":"a34cce57-e87d-45b3-b2d1-8f456a9e1aa8", "contentVersion":"0".repeat(64),
            "mimeType":"text/plain", "byteLength":8
        }))
        .unwrap();
        let mut store = Store::new(
            &engine,
            Reads::new(vec![Resource {
                descriptor,
                bytes: b"resource".to_vec(),
            }]),
        );
        let mut linker = Linker::new(&engine);
        link(&mut linker, |s| s).unwrap();
        let instance = linker.instantiate(&mut store, &module).unwrap();
        let probe = instance
            .get_typed_func::<(i32, i64, i32, i32), i32>(&mut store, "probe")
            .unwrap();
        assert_eq!(probe.call(&mut store, (0, 2, 64, 64)).unwrap(), 6);
        let memory = instance.get_memory(&mut store, "memory").unwrap();
        assert_eq!(&memory.data(&store)[64..70], b"source");
        for (arguments, error) in [
            ((1, 0, 0, 1), -1),
            ((0, -1, 0, 1), -1),
            ((0, 0, -1, 1), -2),
            ((0, 0, 65536, 1), -2),
            ((0, 0, 0, 65537), -1),
        ] {
            assert_eq!(probe.call(&mut store, arguments).unwrap(), error);
        }
        assert_eq!(probe.call(&mut store, (0, 8, 0, 64)).unwrap(), 0);
        store.data_mut().remaining_bytes = 0;
        assert_eq!(probe.call(&mut store, (0, 0, 0, 1)).unwrap(), -3);
        store.data_mut().remaining_calls = 0;
        assert_eq!(probe.call(&mut store, (0, 8, 0, 1)).unwrap(), -3);
    }
}
