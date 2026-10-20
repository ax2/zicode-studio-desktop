//! Bounded output.schema.v1 preview subset; unknown validation keywords fail closed.
use super::{validate_value, CapabilityError, MAX_CAPABILITY_OUTPUT_BYTES};
use crate::plugin_registry::PluginCapabilityDescriptor;
use serde_json::{json, Map, Value};

fn protocol_error() -> CapabilityError {
    CapabilityError::new(
        "worker_protocol_error",
        "Plugin result does not satisfy its output contract",
    )
}

pub(crate) fn validate_contribution(
    version: u32,
    profiles: &Value,
    item: &Value,
) -> Result<(), String> {
    if item.get("outputSchema").is_none() && item.get("maxResultBytes").is_none() {
        return Ok(());
    }
    if version != 2 || profiles.get("output.schema.v1").is_none() {
        return Err("Output contracts require schemaVersion 2 and output.schema.v1".into());
    }
    if let Some(limit) = item.get("maxResultBytes") {
        if !limit
            .as_u64()
            .is_some_and(|n| n > 0 && n <= MAX_CAPABILITY_OUTPUT_BYTES as u64)
        {
            return Err("Invalid maxResultBytes declaration".into());
        }
    }
    if let Some(schema) = item.get("outputSchema") {
        validate_declaration(schema)?;
    }
    Ok(())
}

pub(crate) fn validate_declaration(schema: &Value) -> Result<(), String> {
    if serde_json::to_vec(schema)
        .map_err(|_| "Invalid output schema")?
        .len()
        > 32768
    {
        return Err("Output schema exceeds its byte budget".into());
    }
    let mut nodes = 512;
    shape(schema, 0, &mut nodes)?;
    declaration(schema)
}

fn shape(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    if depth > 16 || *nodes == 0 {
        return Err("Output schema exceeds its structural budget".into());
    }
    *nodes -= 1;
    match value {
        Value::Object(items) => {
            for item in items.values() {
                shape(item, depth + 1, nodes)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                shape(item, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn known_type(name: &str) -> bool {
    matches!(
        name,
        "object" | "array" | "string" | "integer" | "number" | "boolean" | "null"
    )
}

fn declaration(schema: &Value) -> Result<(), String> {
    let object = schema.as_object().ok_or("Output schemas must be objects")?;
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "type"
                | "const"
                | "enum"
                | "properties"
                | "required"
                | "additionalProperties"
                | "items"
                | "minLength"
                | "maxLength"
                | "minimum"
                | "maximum"
                | "minItems"
                | "maxItems"
                | "minProperties"
                | "maxProperties"
                | "oneOf"
                | "$schema"
                | "$id"
                | "title"
                | "description"
                | "default"
                | "examples"
        ) {
            return Err("Unsupported output schema keyword".into());
        }
    }
    if let Some(kind) = schema.get("type") {
        let valid = kind.as_str().is_some_and(known_type)
            || kind.as_array().is_some_and(|types| {
                let mut names = std::collections::HashSet::new();
                !types.is_empty()
                    && types.len() <= 7
                    && types.iter().all(|t| {
                        t.as_str()
                            .is_some_and(|name| known_type(name) && names.insert(name))
                    })
            });
        if !valid {
            return Err("Invalid output schema type".into());
        }
    }
    for keyword in ["$schema", "$id", "title", "description"] {
        if object.get(keyword).is_some_and(|value| !value.is_string()) {
            return Err(format!("Output schema {keyword} must be a string"));
        }
    }
    if object
        .get("examples")
        .is_some_and(|value| !value.is_array())
    {
        return Err("Output schema examples must be an array".into());
    }
    for (low, high) in [
        ("minLength", "maxLength"),
        ("minItems", "maxItems"),
        ("minProperties", "maxProperties"),
    ] {
        for key in [low, high] {
            if schema
                .get(key)
                .is_some_and(|value| value.as_u64().is_none())
            {
                return Err("Invalid output schema bound".into());
            }
        }
        if schema
            .get(low)
            .and_then(Value::as_u64)
            .zip(schema.get(high).and_then(Value::as_u64))
            .is_some_and(|(low, high)| low > high)
        {
            return Err("Inverted output schema bounds".into());
        }
    }
    for key in ["minimum", "maximum"] {
        if schema
            .get(key)
            .is_some_and(|value| value.as_f64().is_none())
        {
            return Err("Invalid output numeric bound".into());
        }
    }
    if schema
        .get("minimum")
        .and_then(Value::as_f64)
        .zip(schema.get("maximum").and_then(Value::as_f64))
        .is_some_and(|(low, high)| low > high)
    {
        return Err("Inverted output numeric bounds".into());
    }
    if let Some(additional) = schema.get("additionalProperties") {
        if additional.is_object() {
            declaration(additional)?;
        } else if !additional.is_boolean() {
            return Err("additionalProperties must be boolean or a schema".into());
        }
    }
    if let Some(required) = schema.get("required") {
        let items = required.as_array().ok_or("Invalid required declaration")?;
        let mut names = std::collections::HashSet::new();
        for item in items {
            let name = item.as_str().ok_or("Invalid required declaration")?;
            if !names.insert(name) {
                return Err("Duplicate required output property".into());
            }
        }
    }
    if schema
        .get("enum")
        .is_some_and(|value| value.as_array().is_none_or(|items| items.is_empty()))
    {
        return Err("Output schema enum must be a nonempty array".into());
    }
    if let Some(properties) = schema.get("properties") {
        for child in properties
            .as_object()
            .ok_or("Invalid output properties")?
            .values()
        {
            declaration(child)?;
        }
    }
    if let Some(items) = schema.get("items") {
        declaration(items)?;
    }
    if let Some(branches) = schema.get("oneOf") {
        let branches = branches
            .as_array()
            .filter(|items| !items.is_empty() && items.len() <= 8)
            .ok_or("Invalid output oneOf branches")?;
        for branch in branches {
            declaration(branch)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_result(
    capability: &PluginCapabilityDescriptor,
    result: &Value,
) -> Result<(), CapabilityError> {
    let bytes = serde_json::to_vec(result).map_err(|_| protocol_error())?;
    if bytes.len()
        > capability
            .max_result_bytes
            .unwrap_or(MAX_CAPABILITY_OUTPUT_BYTES)
            .min(MAX_CAPABILITY_OUTPUT_BYTES)
    {
        return Err(CapabilityError::new(
            "result_too_large",
            "Plugin result exceeds its declared byte budget",
        ));
    }
    if let Some(schema) = &capability.output_schema {
        let mut budget = 65536;
        if !matches_value(schema, result, &mut budget)? {
            return Err(protocol_error());
        }
    }
    Ok(())
}

fn type_matches(name: &str, value: &Value) -> bool {
    match name {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "integer" => {
            value.as_i64().is_some()
                || value.as_u64().is_some()
                || value.as_f64().is_some_and(|n| n.fract() == 0.0)
        }
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => false,
    }
}

fn matches_value(
    schema: &Value,
    value: &Value,
    budget: &mut usize,
) -> Result<bool, CapabilityError> {
    if *budget == 0 {
        return Err(protocol_error());
    }
    *budget -= 1;
    if let Some(kind) = schema.get("type") {
        let valid = kind.as_str().is_some_and(|name| type_matches(name, value))
            || kind.as_array().is_some_and(|types| {
                types
                    .iter()
                    .any(|t| t.as_str().is_some_and(|name| type_matches(name, value)))
            });
        if !valid {
            return Ok(false);
        }
    }
    let mut base = schema.as_object().cloned().ok_or_else(protocol_error)?;
    for key in ["type", "oneOf", "items"] {
        base.remove(key);
    }
    if schema
        .get("additionalProperties")
        .is_some_and(Value::is_object)
    {
        base.remove("additionalProperties");
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        base.insert(
            "properties".into(),
            Value::Object(
                properties
                    .keys()
                    .map(|key| (key.clone(), json!({})))
                    .collect::<Map<_, _>>(),
            ),
        );
    }
    if validate_value(&Value::Object(base), value, "$").is_err() {
        return Ok(false);
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        for (key, child) in properties {
            if let Some(item) = value.get(key) {
                if !matches_value(child, item, budget)? {
                    return Ok(false);
                }
            }
        }
    }
    if let (Some(additional), Some(items)) = (
        schema
            .get("additionalProperties")
            .filter(|item| item.is_object()),
        value.as_object(),
    ) {
        let declared = schema.get("properties").and_then(Value::as_object);
        for (key, item) in items {
            if declared.is_none_or(|properties| !properties.contains_key(key))
                && !matches_value(additional, item, budget)?
            {
                return Ok(false);
            }
        }
    }
    if let Some(items) = schema.get("items") {
        if let Some(values) = value.as_array() {
            for item in values {
                if !matches_value(items, item, budget)? {
                    return Ok(false);
                }
            }
        }
    }
    if let Some(branches) = schema.get("oneOf").and_then(Value::as_array) {
        let mut count = 0;
        for branch in branches {
            if matches_value(branch, value, budget)? {
                count += 1;
            }
        }
        if count != 1 {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
#[path = "plugin_output_contract_tests.rs"]
mod tests;
