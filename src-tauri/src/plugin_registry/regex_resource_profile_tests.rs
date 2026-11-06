#[test]
fn regex_resource_profile_requires_exact_negotiation_ordered_inputs_and_permission() {
    let mut value = manifest(json!({
        "resource.wasi.regex.replace.v1":"=1.0.0-preview.1",
        "output.schema.v1":"=1.0.0-rc.1",
        "resource.output.types.v1":"=1.0.0-preview.1"
    }));
    value.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    value.runtime["resourceOutputProfile"] = json!("resource.wasi.output.draft1");
    value.permissions.required = serde_json::from_value(
        json!([{"name":"resource.read","reason":"Read confirmed text inputs"}]),
    )
    .unwrap();
    value.contributes = json!({"capabilities":[{
        "id":"devtools.regex.replace.resources","inputSchema":{"type":"object"},
        "outputSchema":{"type":"object"},"executionProfile":"resource.wasi.regex.replace.v1","resourceInputMax":2
    }]});
    super::super::validate_manifest(&value, None).unwrap();
    for field in ["resourceInputProfile", "resourceOutputProfile"] {
        let mut invalid = value.clone();
        invalid.runtime.as_object_mut().unwrap().remove(field);
        assert!(super::super::validate_manifest(&invalid, None).is_err());
    }
    for key in [
        "resource.wasi.regex.replace.v1",
        "output.schema.v1",
        "resource.output.types.v1",
    ] {
        let mut invalid = value.clone();
        invalid
            .required_profiles
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(super::super::validate_manifest(&invalid, None).is_err());
    }
    for maximum in [1, 3, 4] {
        let mut invalid = value.clone();
        invalid.contributes["capabilities"][0]["resourceInputMax"] = json!(maximum);
        assert!(super::super::validate_manifest(&invalid, None).is_err());
    }
    let mut invalid = value.clone();
    invalid.permissions.required.clear();
    assert!(super::super::validate_manifest(&invalid, None).is_err());
    let mut invalid = value.clone();
    invalid.required_profiles["resource.wasi.regex.replace.v1"] = json!(">=1.0.0-preview.1");
    assert!(super::super::validate_manifest(&invalid, None).is_err());
    let mut invalid = value.clone();
    invalid.contributes["capabilities"][0]
        .as_object_mut()
        .unwrap()
        .remove("outputSchema");
    assert!(super::super::validate_manifest(&invalid, None).is_err());
    let mut invalid = value.clone();
    let other = invalid.contributes["capabilities"][0].clone();
    invalid.contributes["capabilities"]
        .as_array_mut()
        .unwrap()
        .push(other);
    assert!(super::super::validate_manifest(&invalid, None).is_err());
}

#[test]
fn regex_review_is_separately_negotiated_and_requires_bounded_text_metadata() {
    let mut value = manifest(json!({
        "resource.wasi.regex.review.v1":"=1.0.0-preview.1",
        "resource.input.types.v1":"=1.0.0-preview.1",
        "output.schema.v1":"=1.0.0-rc.1",
        "resource.output.types.v1":"=1.0.0-preview.1"
    }));
    value.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    value.runtime["resourceOutputProfile"] = json!("resource.wasi.output.draft1");
    value.permissions.required = serde_json::from_value(json!([{"name":"resource.read","reason":"Confirmed text snapshots"}])).unwrap();
    value.contributes=json!({"capabilities":[{
        "id":"devtools.regex.replace.resources","inputSchema":{"type":"object"},
        "outputSchema":{"type":"object"},"executionProfile":"resource.wasi.regex.review.v1",
        "resourceInputMax":2,"resourceInputMimeTypes":["text/plain"],"maxResultBytes":262144
    }]});
    super::super::validate_manifest(&value,None).unwrap();
    for maximum in [0,262145] {
        let mut invalid=value.clone();invalid.contributes["capabilities"][0]["maxResultBytes"]=json!(maximum);
        assert!(super::super::validate_manifest(&invalid,None).is_err());
    }
    for key in ["resource.wasi.regex.review.v1","resource.input.types.v1"] {
        let mut invalid=value.clone();invalid.required_profiles.as_object_mut().unwrap().remove(key);
        assert!(super::super::validate_manifest(&invalid,None).is_err());
    }
    for mime in [json!([]),json!(["text/plain","text/html"])] {
        let mut invalid=value.clone();invalid.contributes["capabilities"][0]["resourceInputMimeTypes"]=mime;
        assert!(super::super::validate_manifest(&invalid,None).is_err());
    }
    let mut invalid=value.clone();invalid.required_profiles["resource.wasi.regex.replace.v1"]=json!("=1.0.0-preview.1");
    assert!(super::super::validate_manifest(&invalid,None).is_err());
    let mut invalid=value.clone();invalid.required_profiles["resource.wasi.regex.review.v1"]=json!(">=1.0.0-preview.1");
    assert!(super::super::validate_manifest(&invalid,None).is_err());
    let mut invalid=value;invalid.contributes["capabilities"][0]["executionProfile"]=json!("resource.wasi.regex.replace.v1");
    assert!(super::super::validate_manifest(&invalid,None).is_err());
}
