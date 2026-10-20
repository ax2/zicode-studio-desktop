//! Constraints in the Host's existing input-schema subset; not a full JSON Schema engine.
use super::{invalid_parameter, CapabilityError};
use serde_json::Value;

pub(crate) fn validate_declaration(schema: &Value) -> Result<(), String> {
    declaration(schema, 0)
}

fn declaration(schema: &Value, depth: usize) -> Result<(), String> {
    if depth > 32 {
        return Err("Plugin inputSchema constraints are too deeply nested".into());
    }
    let object = schema
        .as_object()
        .ok_or_else(|| "Plugin inputSchema declaration must be an object".to_string())?;
    for keyword in object.keys() {
        if ![
            "$schema",
            "$id",
            "title",
            "description",
            "default",
            "type",
            "properties",
            "required",
            "additionalProperties",
            "items",
            "minItems",
            "maxItems",
            "minProperties",
            "maxProperties",
            "minLength",
            "maxLength",
            "minimum",
            "maximum",
            "enum",
            "const",
        ]
        .contains(&keyword.as_str())
        {
            return Err(format!(
                "Plugin inputSchema keyword {keyword} is not supported"
            ));
        }
    }
    if object.get("type").is_some_and(|value| {
        !matches!(
            value.as_str(),
            Some("object" | "array" | "string" | "integer" | "number" | "boolean" | "null")
        )
    }) {
        return Err("Plugin inputSchema type is not supported".into());
    }
    for keyword in ["$schema", "$id", "title", "description"] {
        if object.get(keyword).is_some_and(|value| !value.is_string()) {
            return Err(format!("Plugin inputSchema {keyword} must be a string"));
        }
    }
    if object
        .get("additionalProperties")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("Plugin inputSchema additionalProperties must be a boolean".into());
    }
    if let Some(required) = object.get("required") {
        let required = required
            .as_array()
            .ok_or_else(|| "Plugin inputSchema required must be an array".to_string())?;
        let mut names = std::collections::HashSet::new();
        for name in required {
            let name = name
                .as_str()
                .ok_or_else(|| "Plugin inputSchema required entries must be strings".to_string())?;
            if !names.insert(name) {
                return Err("Plugin inputSchema required entries must be unique".into());
            }
        }
    }
    for keyword in [
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minProperties",
        "maxProperties",
    ] {
        if object
            .get(keyword)
            .is_some_and(|value| value.as_u64().is_none())
        {
            return Err(format!(
                "Plugin inputSchema {keyword} must be a nonnegative integer"
            ));
        }
    }
    for (minimum, maximum) in [
        ("minLength", "maxLength"),
        ("minItems", "maxItems"),
        ("minProperties", "maxProperties"),
    ] {
        if let (Some(lower), Some(upper)) = (
            object.get(minimum).and_then(Value::as_u64),
            object.get(maximum).and_then(Value::as_u64),
        ) {
            if lower > upper {
                return Err(format!(
                    "Plugin inputSchema {minimum}/{maximum} are inconsistent"
                ));
            }
        }
    }
    for keyword in ["minimum", "maximum"] {
        if object.get(keyword).is_some_and(|value| !value.is_number()) {
            return Err(format!("Plugin inputSchema {keyword} must be a number"));
        }
    }
    if let (Some(minimum), Some(maximum)) = (
        object.get("minimum").and_then(Value::as_f64),
        object.get("maximum").and_then(Value::as_f64),
    ) {
        if minimum > maximum {
            return Err("Plugin inputSchema minimum/maximum are inconsistent".into());
        }
    }
    if let Some(values) = schema.get("enum") {
        if values.as_array().is_none_or(|values| values.is_empty()) {
            return Err("Plugin inputSchema enum must be a nonempty array".into());
        }
    }
    if let Some(properties) = object.get("properties") {
        let properties = properties
            .as_object()
            .ok_or_else(|| "Plugin inputSchema properties must be an object".to_string())?;
        for child in properties.values() {
            declaration(child, depth + 1)?;
        }
    }
    if let Some(items) = object.get("items") {
        declaration(items, depth + 1)?;
    }
    Ok(())
}

pub(super) fn validate_constraints(
    schema: &Value,
    value: &Value,
    path: &str,
) -> Result<(), CapabilityError> {
    if let Some(values) = schema.get("enum") {
        if !values
            .as_array()
            .is_some_and(|values| values.iter().any(|candidate| equivalent(candidate, value)))
        {
            return Err(invalid_parameter(path, "does not match the declared enum"));
        }
    }
    if schema
        .get("const")
        .is_some_and(|constant| !equivalent(constant, value))
    {
        return Err(invalid_parameter(
            path,
            "does not match the declared constant",
        ));
    }
    if let Some(items) = value.as_array() {
        let count = items.len() as u64;
        if schema
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| count < minimum)
            || schema
                .get("maxItems")
                .and_then(Value::as_u64)
                .is_some_and(|maximum| count > maximum)
        {
            return Err(invalid_parameter(path, "has an invalid number of items"));
        }
    }
    if let Some(object) = value.as_object() {
        let count = object.len() as u64;
        if schema
            .get("minProperties")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| count < minimum)
            || schema
                .get("maxProperties")
                .and_then(Value::as_u64)
                .is_some_and(|maximum| count > maximum)
        {
            return Err(invalid_parameter(
                path,
                "has an invalid number of properties",
            ));
        }
    }
    Ok(())
}

fn equivalent(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => {
            let integer = |n: &serde_json::Number| {
                n.as_i64()
                    .map(i128::from)
                    .or_else(|| n.as_u64().map(i128::from))
            };
            match (integer(a), integer(b)) {
                (Some(a), Some(b)) => a == b,
                (Some(integer), None) | (None, Some(integer)) => {
                    let float = if a.is_f64() { a.as_f64() } else { b.as_f64() };
                    float.is_some_and(|float| {
                        float.fract() == 0.0
                            && float >= i64::MIN as f64
                            && float < 18446744073709551616.0
                            && float as i128 == integer
                    })
                }
                (None, None) => a.as_f64() == b.as_f64(),
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| equivalent(value, other)))
        }
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn object_property_bounds_are_declared_and_checked_at_every_depth() {
        let schema = json!({"type":"object","properties":{"value":{
            "type":"object","minProperties":1,"maxProperties":2}},
            "required":["value"],"additionalProperties":false});
        validate_declaration(&schema).unwrap();
        for input in [json!({"value":{}}), json!({"value":{"a":1,"b":2,"c":3}})] {
            let error = super::super::validate_value(&schema, &input, "input").unwrap_err();
            assert_eq!(error.code, "invalid_parameters");
            assert!(error.message.contains("input.value"));
        }
        super::super::validate_value(&schema, &json!({"value":{"a":1,"b":2}}), "input").unwrap();
        assert!(validate_declaration(&json!({"type":"object","maxProperties":-1})).is_err());
        assert!(
            validate_declaration(&json!({"type":"object","minProperties":3,
            "maxProperties":2}))
            .is_err()
        );
    }

    #[test]
    fn numeric_literals_compare_without_rounding_large_integers() {
        for (left, right, expected) in [
            (json!(1), json!(1.0), true),
            (json!(-1), json!(-1.0), true),
            (
                json!(9007199254740993_u64),
                json!(9007199254740992.0),
                false,
            ),
            (json!(u64::MAX), json!(18446744073709551616.0), false),
            (json!(i64::MIN), json!(-9223372036854775808.0), true),
            (json!({"n":[1]}), json!({"n":[1.0]}), true),
        ] {
            assert_eq!(equivalent(&left, &right), expected);
            assert_eq!(equivalent(&right, &left), expected);
        }
    }

    #[test]
    fn registry_and_broker_reject_bad_inputs_before_worker_dispatch() {
        use super::super::{CapabilityBroker, CapabilityInvocation};
        use crate::plugin_registry::PluginRegistry;
        use std::{fs, path::PathBuf};
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("input-contract-{}", uuid::Uuid::new_v4()));
        let package = root.join("package");
        fs::create_dir_all(&package).unwrap();
        fs::write(root.join("owner.json"), json!({"purpose":"bounded input-contract regression evidence","pid":std::process::id(),"lifetime":"retain tiny fixture and hash-only audit"}).to_string()).unwrap();
        let mut manifest = json!({"schemaVersion":1,"id":"com.example.input-contract","name":"Input contract",
            "description":"fixture","version":"0.1.0","publisher":"example",
            "contributes":{"capabilities":[{"id":"fixture.report","inputSchema":{"type":"object","additionalProperties":false,
            "required":["operation","version","reports"],"properties":{"operation":{"type":"string","enum":[]},
            "version":{"type":"string","const":"1.0.0-rc.1"},"reports":{"type":"array","minItems":1,"maxItems":2}}}}]}});
        let mut registry = PluginRegistry::open(root.join("registry")).unwrap();
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        assert!(registry
            .install_developer(&package)
            .unwrap_err()
            .contains("enum"));
        manifest["contributes"]["capabilities"][0]["inputSchema"]["properties"]["operation"]
            ["enum"] = json!(["report"]);
        manifest["contributes"]["capabilities"][0]["inputSchema"]["properties"]["version"]
            ["pattern"] = json!("^1\\.0\\.0-rc\\.1$");
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        assert!(registry
            .install_developer(&package)
            .unwrap_err()
            .contains("pattern"));
        manifest["contributes"]["capabilities"][0]["inputSchema"]["properties"]["version"]
            .as_object_mut()
            .unwrap()
            .remove("pattern");
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", "com.example.input-contract", true)
            .unwrap();
        let mut broker = CapabilityBroker::new(root.join("registry")).unwrap();
        for input in [
            json!({"operation":"synthetic-sensitive-input","version":"1.0.0-rc.1","reports":[1]}),
            json!({"operation":"report","version":"wrong","reports":[1]}),
            json!({"operation":"report","version":"1.0.0-rc.1","reports":[]}),
        ] {
            let error = broker
                .invoke(
                    &registry,
                    CapabilityInvocation {
                        caller: "view".into(),
                        scene_id: "programming".into(),
                        workspace_id: "fixture".into(),
                        plugin_id: "com.example.input-contract".into(),
                        capability_id: "fixture.report".into(),
                        tool_call_id: None,
                        idempotency_scope: None,
                        input,
                    },
                )
                .unwrap_err();
            assert_eq!(error.code, "invalid_parameters");
            assert!(!error.message.contains("synthetic-sensitive-input"));
        }
        let audit = fs::read_to_string(root.join("registry/audit/capabilities.jsonl")).unwrap();
        assert!(!audit.contains("synthetic-sensitive-input"));
        assert!(audit.contains("invalid_parameters"));
    }

    #[test]
    fn enum_and_const_are_checked_without_echoing_values() {
        let schema = json!({"type":"object","additionalProperties":false,
            "properties":{"operation":{"type":"string","enum":["report"]},
            "version":{"type":"string","const":"1.0.0-rc.1"}}});
        super::super::validate_value(
            &schema,
            &json!({"operation":"report","version":"1.0.0-rc.1"}),
            "$",
        )
        .unwrap();
        for input in [
            json!({"operation":"synthetic-sensitive-input"}),
            json!({"version":"synthetic-sensitive-input"}),
        ] {
            let error = super::super::validate_value(&schema, &input, "$").unwrap_err();
            assert_eq!(error.code, "invalid_parameters");
            assert!(!error.message.contains("synthetic-sensitive-input"));
        }
        for constant in [Value::Null, json!({"literal":"value"}), json!([1, 2])] {
            let schema = json!({"const":constant});
            assert!(super::super::validate_value(&schema, &constant, "$").is_ok());
            assert!(super::super::validate_value(&schema, &json!(false), "$").is_err());
        }
    }

    #[test]
    fn nested_array_bounds_are_enforced() {
        let schema = json!({"type":"object","properties":{"reports":{"type":"array",
            "minItems":1,"maxItems":2,"items":{"type":"string","enum":["safe"]}}}});
        for input in [
            json!({"reports":[]}),
            json!({"reports":["safe","safe","safe"]}),
            json!({"reports":["private"]}),
        ] {
            assert!(super::super::validate_value(&schema, &input, "$").is_err());
        }
        assert!(
            super::super::validate_value(&schema, &json!({"reports":["safe","safe"]}), "$").is_ok()
        );
    }

    #[test]
    fn invalid_declarations_are_rejected_and_literal_payloads_are_not_schemas() {
        for schema in [
            json!({"enum":[]}),
            json!({"enum":"x"}),
            json!({"minItems":-1}),
            json!({"maxItems":1.5}),
            json!({"minItems":2,"maxItems":1}),
            json!({"type":"string","pattern":"^safe$"}),
            json!({"type":["string","null"]}),
            json!({"type":"unsupported"}),
            json!({"type":"object","additionalProperties":{"type":"string"}}),
            json!({"type":"object","required":["value","value"]}),
            json!({"type":"object","properties":[]}),
            json!({"type":"string","minLength":-1}),
            json!({"type":"string","minLength":2,"maxLength":1}),
            json!({"type":"number","minimum":"0"}),
            json!({"type":"number","minimum":2,"maximum":1}),
            json!({"properties":{"nested":{"enum":[]}}}),
            json!({"properties":{"nested":{"type":"string","format":"uri"}}}),
            json!({"items":{"enum":[]}}),
            json!({"items":true}),
        ] {
            assert!(validate_declaration(&schema).is_err());
        }
        validate_declaration(&json!({"const":{"enum":"literal"},"enum":[{"enum":"literal"}]}))
            .unwrap();
        validate_declaration(
            &json!({"type":"object","properties":{"items":{"type":"array",
            "minItems":1,"maxItems":2,"items":{"type":"string","minLength":1}}}}),
        )
        .unwrap();
    }

    #[test]
    fn unknown_input_property_names_are_not_in_error_messages() {
        let schema = json!({"type":"object","additionalProperties":false});
        let error = super::super::validate_value(
            &schema,
            &json!({"synthetic-sensitive-key":"private"}),
            "$",
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_parameters");
        assert_eq!(error.message, "$ contains an undeclared property");
    }
}
