use super::*;

#[test]
fn access_refreshes_recency_and_partitions_by_library() {
    let mut cache = Thumbnails::default();
    for index in 0..MAX_ENTRIES {
        cache
            .get_or_generate("first", &index.to_string(), || Ok("old".into()))
            .unwrap();
    }
    assert_eq!(
        cache
            .get_or_generate("first", "0", || panic!("hit"))
            .unwrap(),
        "old"
    );
    cache
        .get_or_generate("second", "0", || Ok("other library".into()))
        .unwrap();
    assert_eq!(cache.entries.len(), MAX_ENTRIES);
    assert_eq!(
        cache
            .get_or_generate("first", "0", || panic!("recent hit"))
            .unwrap(),
        "old"
    );
    assert_eq!(
        cache
            .get_or_generate("first", "1", || Ok("evicted".into()))
            .unwrap(),
        "evicted"
    );
    assert_eq!(
        cache
            .get_or_generate("second", "0", || panic!("other hit"))
            .unwrap(),
        "other library"
    );
}

#[test]
fn caps_encoded_bytes_and_retries_failed_generation() {
    let mut cache = Thumbnails::default();
    assert_eq!(
        cache.get_or_generate("library", "failed", || Err("worker failed".into())),
        Err("worker failed".into())
    );
    assert!(cache.entries.is_empty());
    for index in 0..3 {
        cache
            .get_or_generate("library", &index.to_string(), || {
                Ok("a".repeat(MAX_ENCODED_BYTES / 2))
            })
            .unwrap();
    }
    assert_eq!(cache.bytes, MAX_ENCODED_BYTES);
    assert_eq!(cache.entries.len(), 2);
    assert!(cache.entries.iter().all(|entry| entry.digest != "0"));
    assert_eq!(
        cache
            .get_or_generate("library", "failed", || Ok("retry".into()))
            .unwrap(),
        "retry"
    );
    assert!(cache.bytes <= MAX_ENCODED_BYTES);
}
