//! Deterministic metadata-only ranking shared by manual and Pi tool catalogs.
use crate::plugin_registry::directory_metadata::normalize;

pub(crate) fn normalize_query(query: &str) -> String {
    normalize(query).split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn relevance(
    terms: &[String],
    capability_id: &str,
    title: &str,
    aliases: &[&str],
    description: &str,
    source: &str,
) -> Option<u16> {
    if terms.is_empty() {
        return Some(0);
    }
    let primary = [normalize(capability_id), normalize(title)];
    let aliases: Vec<_> = aliases.iter().map(|alias| normalize(alias)).collect();
    let description = normalize(description);
    let source = normalize(source);
    terms.iter().try_fold(0_u16, |total, term| {
        let primary_rank = primary
            .iter()
            .chain(&aliases)
            .filter_map(|value| {
                if value == term {
                    Some(0)
                } else if value.starts_with(term) {
                    Some(1)
                } else if value.contains(term) {
                    Some(2)
                } else {
                    None
                }
            })
            .min();
        let rank = primary_rank
            .or_else(|| description.contains(term).then_some(3))
            .or_else(|| source.contains(term).then_some(4))?;
        Some(total.saturating_add(rank))
    })
}
