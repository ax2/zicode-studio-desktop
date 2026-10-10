//! Cache hits retain the original authority and never turn into implicit retries.
use super::*;

#[derive(Clone, PartialEq)]
pub(super) struct Authority {
    revision: (uuid::Uuid, uuid::Uuid),
    capability: String,
    module_hash: Option<String>,
}

impl Authority {
    pub(super) fn new(
        revision: (uuid::Uuid, uuid::Uuid),
        capability: &PluginCapabilityDescriptor,
        module_hash: Option<String>,
    ) -> Self {
        Self {
            revision,
            capability: hex_sha256(
                &serde_json::to_vec(capability).expect("Capability is serializable"),
            ),
            module_hash,
        }
    }

    fn current(
        registry: &PluginRegistry,
        request: &CapabilityInvocation,
        capability: &PluginCapabilityDescriptor,
    ) -> Result<Self, CapabilityError> {
        let external = registry.list(&request.scene_id).iter().any(|plugin| {
            plugin.manifest.id == request.plugin_id
                && plugin.origin != crate::plugin_registry::PluginOrigin::BuiltIn
        });
        Ok(Self::new(
            registry.execution_revision(&request.scene_id, &request.plugin_id),
            capability,
            if external {
                Some(detached_worker::module_hash(registry, request)?)
            } else {
                None
            },
        ))
    }
}

impl CapabilityBroker {
    pub(super) fn invoke_cached(
        &mut self,
        registry: &PluginRegistry,
        request: &CapabilityInvocation,
        key: &str,
        request_hash: &str,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        let capability = self.current_capability(registry, request)?;
        if let Some(cached) = self.idempotency.get(key) {
            if cached.request_hash != request_hash {
                return Err(CapabilityError::new(
                    "idempotency_conflict",
                    "toolCallId was already used for a different invocation",
                ));
            }
            validate_value(&capability.input_schema, &request.input, "$")?;
            let authority = Authority::current(registry, request, &capability)?;
            if authority != cached.authority {
                return Err(CapabilityError::new("idempotency_authority_changed", "Previous call cannot be replayed after plugin or permission changes; review its effect before a new call"));
            }
            output_contract::validate_result(&capability, &cached.result)?;
            return Ok(cached.result.clone());
        }
        let authority = Authority::current(registry, request, &capability)?;
        let result = self.invoke_uncached(registry, request, cancelled)?;
        let current = self.current_capability(registry, request)?;
        if Authority::current(registry, request, &current)? != authority {
            return Err(CapabilityError::new(
                "capability_changed",
                "Plugin changed during execution; review its effect before a new call",
            ));
        }
        self.insert_idempotency(
            key.to_string(),
            CachedInvocation {
                request_hash: request_hash.to_string(),
                authority,
                result: result.clone(),
            },
        );
        Ok(result)
    }
}
