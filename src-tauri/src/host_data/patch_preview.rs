//! Shared UTF-8, whole-line limits for Git text previews.
pub(super) fn limit(patch: &str) -> (String, bool) {
    let mut end = 0;
    for line in patch.split_inclusive('\n').take(2000) {
        if end + line.len() > 256 * 1024 {
            break;
        }
        end += line.len();
    }
    (patch[..end].to_owned(), end < patch.len())
}
