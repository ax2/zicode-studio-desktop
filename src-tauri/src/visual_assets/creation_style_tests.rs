use super::super::creation_types::style::{Strength, Style};
use super::*;

fn styled(f: &Fixture) -> Plan {
    let mut input = f.plan.input.clone();
    input.description = "水墨：浓淡墨色、留白、保留主体".into();
    input.style = Some(Style {
        preset: "ink-wash".into(),
        revision: 1,
        strength: Strength::Balanced,
        preserve: "保留原图中的主体、位置和文字".into(),
    });
    Plan::prepare(&f.db, "workspace", "scene", f.plan.settings.clone(), input).unwrap()
}

#[test]
fn legacy_outfit_shape_and_digest_remain_valid_without_style() {
    let f = Fixture::new("https://images.example.com/v1");
    let encoded = serde_json::to_value(&f.plan).unwrap();
    assert_eq!(encoded["input"].as_object().unwrap().len(), 3);
    assert!(encoded["input"].get("style").is_none());
    let restored: Plan = serde_json::from_value(encoded.clone()).unwrap();
    restored.validate(&f.db).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(), encoded);
    let mut original_digest_input = encoded;
    original_digest_input
        .as_object_mut()
        .unwrap()
        .remove("digest");
    assert_eq!(
        hash(&serde_json::to_vec(&original_digest_input).unwrap()),
        f.plan.digest
    );
    f.clean();
}

#[test]
fn style_plan_binds_all_editable_controls_and_rejects_invalid_combinations() {
    let f = Fixture::new("https://images.example.com/v1");
    let plan = styled(&f);
    plan.validate(&f.db).unwrap();
    assert_eq!(plan.workflow, "style");
    assert_eq!(plan.references.len(), 1);
    assert!(plan.prompt.contains("not a numeric model control"));
    assert!(!plan.prompt.contains("change only the person's clothing"));
    for (field, value) in [
        ("preserve", json!("keep only the subject")),
        ("preset", json!("van-gogh")),
        ("strength", json!("bold")),
    ] {
        let mut modified = serde_json::to_value(&plan).unwrap();
        modified["input"]["style"][field] = value;
        let changed: Plan = serde_json::from_value(modified).unwrap();
        assert!(changed.validate(&f.db).is_err(), "{field}");
    }
    for (field, value) in [
        ("revision", json!(2)),
        ("preset", json!("missing")),
        ("preserve", json!(" ")),
    ] {
        let mut modified = serde_json::to_value(&plan.input).unwrap();
        modified["style"][field] = value;
        let input: Input = serde_json::from_value(modified).unwrap();
        assert!(Plan::prepare(&f.db, "workspace", "scene", plan.settings.clone(), input).is_err());
    }
    let mut input = plan.input.clone();
    input.clothing = Some(999);
    assert!(Plan::prepare(&f.db, "workspace", "scene", plan.settings.clone(), input).is_err());
    f.clean();
}

#[test]
fn style_attempt_and_approved_source_survive_reopen_and_offline_restore() {
    let mut f = Fixture::new("https://images.example.com/v1");
    let plan = styled(&f);
    let id = Uuid::new_v4();
    f.store.begin(id, &plan).unwrap();
    let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
    assert_eq!(
        reopened.get(&plan.library_id, id).unwrap().unwrap()["plan"],
        serde_json::to_value(&plan).unwrap()
    );
    assert!(reopened.begin(Uuid::new_v4(), &plan).is_err());
    let usage = json!({"imageInputTokens": 12, "cost": null});
    reopened.finish(id, &f.bytes, "thumbnail", &usage).unwrap();
    let saved = archive::save(
        &mut f.db,
        &f.library,
        id,
        &plan,
        &f.bytes,
        &hash(&f.bytes),
        &usage,
    )
    .unwrap();
    let destination = f.root.join("style-backup");
    std::fs::create_dir(&destination).unwrap();
    let backup = snapshot::create(
        &mut f.db,
        &f.library,
        &destination,
        None,
        &|_| Ok(()),
        &|_| Ok(()),
    )
    .unwrap();
    let restored = f.root.join("style-restored");
    snapshot::restore(
        &backup,
        &restored,
        |input, output| {
            std::fs::copy(input, output)?;
            Ok(())
        },
        &|_| Ok(()),
    )
    .unwrap();
    let restored_db = catalog::open(&restored).unwrap();
    assert_eq!(archive::get(&restored_db, id).unwrap().unwrap(), saved);
    assert_eq!(
        std::fs::read(restored.join(format!("{}.blob", plan.references[0].sha256))).unwrap(),
        f.bytes
    );
    drop(restored_db);
    f.clean();
}
