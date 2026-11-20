use super::*;
use crate::plugin_worker::resource_output::Blob;
use serde_json::json;

fn declaration() -> (Value,Value,Value) {
    let requirements=json!({PROFILE:"=1.0.0-preview.1",Profile::METADATA_NAME:"=1.0.0-preview.1",Profile::METADATA_SAVE:"=1.0.0-preview.1","output.schema.v1":"=1.0.0-rc.1","resource.output.types.v1":"=1.0.0-preview.1"});
    let runtime=json!({"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2","resourceOutputProfile":Profile::METADATA_NAME});
    let capabilities=[INSPECT,CLEAN].iter().map(|id|json!({"id":id,"executionProfile":PROFILE,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"},"resourceInputMimeTypes":["image/png","image/jpeg","image/webp"]})).collect::<Vec<_>>();
    (requirements,runtime,json!({"capabilities":capabilities,"commands":[]}))
}
#[test]
fn metadata_declaration_requires_exact_profiles_single_input_and_both_operations(){
    let (required,runtime,contributes)=declaration();
    assert!(validate_declaration(2,required.as_object().unwrap(),&runtime,&contributes,true).is_ok());
    for key in [PROFILE,Profile::METADATA_NAME,Profile::METADATA_SAVE,"output.schema.v1","resource.output.types.v1"] {
        let mut changed=required.clone();changed.as_object_mut().unwrap().remove(key);
        assert!(validate_declaration(2,changed.as_object().unwrap(),&runtime,&contributes,true).is_err());
    }
    for value in [json!("*"),json!("=1.0.0-preview.2")] {
        let mut changed=required.clone();changed[PROFILE]=value;
        assert!(validate_declaration(2,changed.as_object().unwrap(),&runtime,&contributes,true).is_err());
    }
    assert!(validate_declaration(2,required.as_object().unwrap(),&runtime,&contributes,false).is_err());
    assert!(validate_declaration(1,required.as_object().unwrap(),&runtime,&contributes,true).is_err());
    for field in ["resourceInputMax","resourceInputMin"] {
        let mut changed=contributes.clone();changed["capabilities"][0][field]=json!(1);
        assert!(validate_declaration(2,required.as_object().unwrap(),&runtime,&changed,true).is_err());
    }
    let mut changed=runtime.clone();changed["resourceOutputProfile"]=json!(crate::plugin_worker::resource_output::PROFILE);
    assert!(validate_declaration(2,required.as_object().unwrap(),&changed,&contributes,true).is_err());
}
fn summary() -> Value {
    json!({"format":"PNG","exif":0,"hasExifGpsDirectory":false,"icc":0,"xmp":0,"text":0,"iptc":0,"other":0,"animation":false,"hasRecognizedMetadata":false})
}
fn success()->Bundle {
    use sha2::{Digest,Sha256};
    let mut png=std::io::Cursor::new(Vec::new());image::DynamicImage::new_rgba8(2,3).write_to(&mut png,image::ImageFormat::Png).unwrap();let bytes=png.into_inner();
    let fingerprint=format!("{:x}",Sha256::digest(b"ZiDevTools runtime environment v1\x000.82.0\0wasi\0wasm32\0release"));
    let result=json!({"ok":true,"operation":"clean","previewIndex":1,"report":{
        "schemaVersion":2,"material":"image-metadata-report","notes":NOTES,
        "generatedBy":{"toolId":"image-metadata","toolVersion":"1.4.1","runtimeFingerprint":{"schema":1,"appVersion":"0.82.0","os":"wasi","architecture":"wasm32","buildProfile":"release","sha256":fingerprint}},
        "origin":{"toolId":"image-metadata","version":"1.4.1","utc":"2026-10-29T00:00:00.000Z"},
        "source":{"bytes":100,"displayWidth":2,"displayHeight":3,"metadata":summary()},
        "cleanedPreview":{"bytes":bytes.len(),"metadata":summary(),"jpegQuality":null,"kind":"encoded-preview","saved":null}
    }});
    Bundle{profile:Profile::ImageMetadata2,binary:true,result,resources:vec![Blob{mime_type:"image/png".into(),bytes:bytes.clone()},Blob{mime_type:"image/png".into(),bytes}]}
}
#[test]
fn metadata_reports_reject_private_fields_fake_roles_and_stale_orientation(){
    assert!(validate_outputs(&success(),CLEAN).is_ok());
    for pointer in ["/report/source/metadata/privateExifValue","/report/privatePath"] {
        let mut bundle=success();
        if pointer.starts_with("/report/source") {bundle.result["report"]["source"]["metadata"]["privateExifValue"]=json!("fixture-private");}
        else {bundle.result["report"]["privatePath"]=json!("fixture-private");}
        assert!(validate_outputs(&bundle,CLEAN).is_err());
    }
    for (pointer,value) in [
        ("/previewIndex",json!(0)),("/operation",json!("inspect")),("/report/source/displayWidth",json!(3)),
        ("/report/cleanedPreview/metadata/exif",json!(1)),("/report/cleanedPreview/saved",json!(true)),
        ("/report/generatedBy/runtimeFingerprint/sha256",json!("f".repeat(64))),
        ("/report/notes",json!("fixture private values")),("/report/origin/utc",json!("private")),
    ] {
        let mut bundle=success();*bundle.result.pointer_mut(pointer).unwrap()=value;
        assert!(validate_outputs(&bundle,CLEAN).is_err(),"accepted {pointer}");
    }
    let mut bundle=success();bundle.profile=Profile::Draft1;assert!(validate_outputs(&bundle,CLEAN).is_err());
    let mut bundle=success();bundle.resources.pop();assert!(validate_outputs(&bundle,CLEAN).is_err());
}
#[test]
fn metadata_inspection_is_one_thumbnail_and_failure_has_no_registered_resources(){
    let mut bundle=success();bundle.result["operation"]=json!("inspect");bundle.result["previewIndex"]=json!(0);bundle.result["report"]["cleanedPreview"]=Value::Null;bundle.resources.remove(0);
    assert!(validate_outputs(&bundle,INSPECT).is_ok());assert!(validate_outputs(&bundle,CLEAN).is_err());
    bundle.result=json!({"ok":false,"error":{"code":"IMAGE_METADATA_FAILED","message":"private guest diagnostics"}});
    assert!(validate_outputs(&bundle,INSPECT).is_err());bundle.resources.clear();assert!(validate_outputs(&bundle,INSPECT).is_ok());
}
