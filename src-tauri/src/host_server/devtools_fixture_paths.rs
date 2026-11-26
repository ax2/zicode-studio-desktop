use std::path::{Path, PathBuf};

pub(super) fn devtools_9c17_bundle_root(checkout: &Path) -> PathBuf {
    let mut locations = include_str!("../../../tests/fixtures/devtools-9c17-locations.txt").lines();
    let preferred = checkout.join(locations.next().expect("current DevTools bundle path"));
    let archived = checkout.join(locations.next().expect("archived DevTools bundle path"));
    if !preferred.exists() && archived.exists() {
        archived
    } else {
        preferred
    }
}
