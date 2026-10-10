use super::*;
use wasmtime::{Engine, Module, Store};

#[test]
fn output_record_count_reservation_sealing_and_attempts_are_bounded() {
    let mut writes = Writes::default();
    assert_eq!(writes.create(-1, 1), -1);
    assert_eq!(writes.create(0, -1), -1);
    assert_eq!(writes.create(0, MAX_BYTES as i64), 0);
    assert_eq!(writes.create(0, 1), -3);
    assert_eq!(writes.seal(0), -1);
    assert!(writes.finish().is_err());
    let mut writes = Writes::default();
    for index in 0..4 {
        assert_eq!(writes.create(4, 0), index);
        assert_eq!(writes.seal(index), 0);
    }
    assert_eq!(writes.create(0, 0), -3);
    assert_eq!(writes.append(0, b"a"), -1);
    assert_eq!(writes.finish().unwrap().len(), 4);
    let mut writes = Writes {
        calls: 0,
        ..Writes::default()
    };
    assert_eq!(writes.create(0, 0), -3);
    assert_eq!(writes.seal(0), -3);
}

#[test]
fn actual_guest_output_checks_memory_append_ranges_and_sealed_buffers() {
    let engine = Engine::default();
    let module=Module::new(&engine,r#"(module
      (import "zicode_resource_output_draft1" "create" (func $create (param i32 i64) (result i32)))
      (import "zicode_resource_output_draft1" "write" (func $write (param i32 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "finish" (func $finish (param i32) (result i32)))
      (memory (export "memory") 1) (data (i32.const 0) "binary")
      (func (export "create") (param i32 i64) (result i32) local.get 0 local.get 1 call $create)
      (func (export "write") (param i32 i32 i32) (result i32) local.get 0 local.get 1 local.get 2 call $write)
      (func (export "finish") (param i32) (result i32) local.get 0 call $finish))"#).unwrap();
    let mut store = Store::new(&engine, Writes::default());
    let mut linker = Linker::new(&engine);
    link(&mut linker, |s| s).unwrap();
    let instance = linker.instantiate(&mut store, &module).unwrap();
    let create = instance
        .get_typed_func::<(i32, i64), i32>(&mut store, "create")
        .unwrap();
    let write = instance
        .get_typed_func::<(i32, i32, i32), i32>(&mut store, "write")
        .unwrap();
    let finish = instance
        .get_typed_func::<i32, i32>(&mut store, "finish")
        .unwrap();
    assert_eq!(create.call(&mut store, (4, 6)).unwrap(), 0);
    for (args, expected) in [
        ((0, -1, 1), -2),
        ((0, 65536, 1), -2),
        ((0, 0, 65537), -1),
        ((0, 0, 0), -1),
        ((1, 0, 1), -1),
        ((0, 0, 7), -1),
    ] {
        assert_eq!(write.call(&mut store, args).unwrap(), expected);
    }
    assert!(store.data().records[0].blob.bytes.is_empty());
    assert_eq!(write.call(&mut store, (0, 0, 6)).unwrap(), 6);
    assert_eq!(finish.call(&mut store, 0).unwrap(), 0);
    assert_eq!(finish.call(&mut store, 0).unwrap(), 0);
    assert_eq!(write.call(&mut store, (0, 0, 1)).unwrap(), -1);
    store.data_mut().calls = 0;
    assert_eq!(write.call(&mut store, (0, 0, 1)).unwrap(), -3);
    let blobs = store.into_data().finish().unwrap();
    assert_eq!(blobs[0].bytes, b"binary");
}
