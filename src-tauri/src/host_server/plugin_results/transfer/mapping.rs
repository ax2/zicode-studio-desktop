//! Explicit bounded string-field mapping. No schema defaults or hidden input values.
use super::*;

pub(super) fn request_budget(target: &Scope, input: &Value) -> Result<(), ApiError> {
    let envelope = json!({"pluginId":target.plugin_id,"sceneId":target.scene_id,
        "capabilityId":target.capability_id,"commandId":null,"input":input});
    if serde_json::to_vec(&envelope)
        .map(|bytes| bytes.len() > 48 * 1024)
        .unwrap_or(true)
    {
        return Err(rejected("result_mapping_inputs_invalid"));
    }
    Ok(())
}

pub(super) fn required_inputs(
    schema: &Value,
    field: &str,
    text: &str,
) -> Result<Vec<String>, ApiError> {
    let properties = schema["properties"]
        .as_object()
        .ok_or_else(|| rejected("result_mapping_unsupported"))?;
    if schema["type"] != "object"
        || field.is_empty()
        || field.len() > 128
        || properties.len() > 16
        || schema["properties"][field]["type"] != "string"
        || text.len() > 8192
    {
        return Err(rejected("result_mapping_unsupported"));
    }
    crate::plugin_capabilities::validate_value(&schema["properties"][field], &json!(text), "$")
        .map_err(capability_api_error)?;
    let mut inputs = Vec::new();
    for name in schema["required"].as_array().into_iter().flatten() {
        let name = name
            .as_str()
            .ok_or_else(|| rejected("result_mapping_unsupported"))?;
        if name.is_empty() || name.len() > 128 || schema["properties"][name]["type"] != "string" {
            return Err(rejected("result_mapping_unsupported"));
        }
        if name != field && !inputs.iter().any(|item| item == name) {
            inputs.push(name.to_string());
        }
    }
    inputs.sort();
    Ok(inputs)
}

pub(super) fn mapped_input(
    schema: &Value,
    field: &str,
    text: &str,
    values: &serde_json::Map<String, Value>,
) -> Result<Value, ApiError> {
    let required = required_inputs(schema, field, text)?;
    if values.len() != required.len()
        || values.keys().any(|name| !required.contains(name))
        || values
            .values()
            .any(|value| value.as_str().is_none_or(|text| text.len() > 8192))
    {
        return Err(rejected("result_mapping_inputs_invalid"));
    }
    let mut fields = values.clone();
    fields.insert(field.into(), json!(text));
    let mapped = Value::Object(fields);
    if serde_json::to_vec(&mapped)
        .map(|bytes| bytes.len() > 48 * 1024)
        .unwrap_or(true)
    {
        return Err(rejected("result_mapping_inputs_invalid"));
    }
    crate::plugin_capabilities::validate_value(schema, &mapped, "$")
        .map_err(capability_api_error)?;
    Ok(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schema() -> Value {
        json!({"type":"object","properties":{"left":{"type":"string"},"right":{"type":"string"}},"required":["left","right"],"additionalProperties":false})
    }
    #[test]
    fn request_limit_includes_identity_envelope_and_json_escaping() {
        let target = Scope {
            workspace_id: "unused".into(),
            scene_id: "programming".into(),
            plugin_id: "com.example.compare".into(),
            capability_id: "compare.lines".into(),
        };
        let input = json!({"left":"x".repeat(48 * 1024 - 20)});
        assert!(serde_json::to_vec(&input).unwrap().len() < 48 * 1024);
        assert!(request_budget(&target, &input).is_err());
        assert!(request_budget(&target, &json!({"left":"\n".repeat(8192),"right":"中"})).is_ok());
    }
    #[test]
    fn maps_either_side_without_overwriting_or_defaulting() {
        assert_eq!(
            required_inputs(&schema(), "left", "source").unwrap(),
            vec!["right"]
        );
        for (field, other) in [("left", "right"), ("right", "left")] {
            let values = json!({other:"unchanged\r\n"}).as_object().unwrap().clone();
            let result = mapped_input(&schema(), field, "source", &values).unwrap();
            assert_eq!(result[field], "source");
            assert_eq!(result[other], "unchanged\r\n");
        }
    }
    #[test]
    fn rejects_missing_overwrite_unknown_nonstring_and_byte_excess() {
        for values in [
            json!({}),
            json!({"right":"x","left":"overwrite"}),
            json!({"right":"x","extra":"x"}),
            json!({"right":7}),
            json!({"right":"中".repeat(2731)}),
        ] {
            assert!(
                mapped_input(&schema(), "left", "source", values.as_object().unwrap()).is_err()
            );
        }
        assert!(required_inputs(&schema(), "left", &"x".repeat(8193)).is_err());
        assert!(required_inputs(&schema(), "unknown", "x").is_err());
    }
    #[test]
    fn retains_schema_constraints_and_one_field_compatibility() {
        let single = json!({"type":"object","properties":{"text":{"type":"string","enum":["ok"]}},"required":["text"],"additionalProperties":false});
        assert!(mapped_input(&single, "text", "ok", &serde_json::Map::new()).is_ok());
        assert!(mapped_input(&single, "text", "bad", &serde_json::Map::new()).is_err());
        let mut multiple = schema();
        multiple["properties"]["right"]["type"] = json!("integer");
        assert!(required_inputs(&multiple, "left", "x").is_err());
    }
}
