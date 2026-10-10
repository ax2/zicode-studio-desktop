//! Check every delegated ancestor outside the resource-store lock.
use super::*;

pub(super) fn identity_access(
    state: &HostState,
    access: &Access,
    generation: Option<&str>,
    module: Option<&[u8]>,
) -> Result<String, ApiError> {
    let proof = identity_module(state, &access.owner, generation, module)?;
    check_ancestors(state, access, &proof)?;
    Ok(proof)
}

pub(super) fn check_ancestors(
    state: &HostState,
    access: &Access,
    proof: &str,
) -> Result<(), ApiError> {
    let ancestors = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .lineage(access, proof)?;
    let mut checked = vec![(access.owner.clone(), proof.to_string())];
    for (source, expected) in ancestors {
        let current =
            if let Some((_, current)) = checked.iter().find(|(owner, _)| *owner == source.owner) {
                current.clone()
            } else {
                let current = identity(state, &source.owner, None)?;
                checked.push((source.owner.clone(), current.clone()));
                current
            };
        if current != expected {
            return Err(rejected("resource_authorization_changed"));
        }
    }
    Ok(())
}
