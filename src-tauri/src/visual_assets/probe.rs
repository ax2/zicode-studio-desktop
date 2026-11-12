#[path = "worker.rs"]
mod worker;

use rusqlite::TransactionBehavior;

use std::{env, error::Error, fs, path::Path};
#[path = "animation.rs"]
mod animation;
#[path = "animation_export.rs"]
mod animation_export;
#[path = "animation_install.rs"]
mod animation_install;
#[path = "animation_preview.rs"]
mod animation_preview;
#[path = "animation_request.rs"]
mod animation_request;
#[path = "animation_stage.rs"]
mod animation_stage;
#[path = "backup_destination.rs"]
mod backup_destination;
#[path = "backup_jobs.rs"]
#[cfg_attr(not(test), allow(dead_code))]
mod backup_jobs;
#[path = "catalog.rs"]
mod catalog;
#[path = "character_commands.rs"]
mod character_commands;
#[path = "characters.rs"]
mod characters;
#[path = "collections.rs"]
mod collections;
#[path = "comfyui.rs"]
mod comfyui;
#[path = "duplicates.rs"]
mod duplicates;
#[path = "generation_attempts.rs"]
mod generation_attempts;
#[path = "generation_dispatch.rs"]
mod generation_dispatch;
#[path = "generation_outputs.rs"]
mod generation_outputs;
#[path = "generation_recipes.rs"]
mod generation_recipes;
#[path = "generation_usage.rs"]
mod generation_usage;
#[path = "generation_workflow.rs"]
mod generation_workflow;
#[path = "import_batch.rs"]
mod import_batch;
#[path = "import.rs"]
mod imports;
#[path = "name_search.rs"]
mod name_search;
#[path = "novel_drafts.rs"]
mod novel_drafts;
#[path = "novel_model_archive.rs"]
mod novel_model_archive;
#[path = "novel_model_source.rs"]
mod novel_model_source;
#[path = "preview.rs"]
mod preview;
#[path = "probe_animation.rs"]
mod probe_animation;
#[path = "probe_generation.rs"]
mod probe_generation;
#[path = "probe_listing.rs"]
mod probe_listing;
#[path = "probe_novel_drafts.rs"]
mod probe_novel_drafts;
#[path = "probe_preview.rs"]
mod probe_preview;
#[path = "reference_catalog.rs"]
mod reference_catalog;
#[path = "reference_grants.rs"]
mod reference_grants;
#[path = "reference_import.rs"]
mod reference_import;
#[path = "reference_source.rs"]
mod reference_source;
#[path = "restore_library.rs"]
mod restore_library;
#[path = "snapshot.rs"]
mod snapshot;
#[path = "snapshot_references.rs"]
mod snapshot_references;
#[path = "tags.rs"]
mod tags;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub fn run() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if let Some(result) = animation::run_if_requested(&args) {
        return result;
    }
    if let [command, stage] = args.as_slice() {
        if command == "--zicode-visual-assets-restore-worker" {
            return worker::decode_batch(Path::new(stage));
        }
    }
    if let [command, input, output] = args.as_slice() {
        if command == "--zicode-visual-assets-worker" {
            return worker::decode(Path::new(input), Path::new(output));
        }
    }
    let [root, operation, rest @ ..] = args.as_slice() else {
        return Err(
            "usage: visual-assets-probe <isolated-directory> import <file> | import-batch <file>... | list [after] [query] | tag-list <after> <tag> [query] | tag <asset-id> [tag...] | backup <empty-directory> | backup-default <parent> | restore <snapshot> | restore-default <snapshot> | job-status | animation-export <asset-id> <revision> <recipe.json> <new-directory> | animation-export-sequence <recipe.json> <new-directory>".into(),
        );
    };
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err("an absolute isolated directory is required".into());
    }
    let root = fs::canonicalize(root)?;
    let marker = root.join(".visual-assets-probe");
    if !marker.is_file() && fs::read_dir(&root)?.next().is_some() {
        return Err("use an empty dedicated acceptance directory".into());
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(marker)?;
    if let (Some("reference-read"), [picked, relative]) = (operation.to_str(), rest) {
        let source = reference_source::Root::approve(Path::new(picked))?;
        let (bytes, fingerprint) = source.read(Path::new(relative), None)?;
        println!(
            "{}",
            serde_json::json!({"bytes": bytes.len(), "sha256": fingerprint.sha256})
        );
        return Ok(());
    }
    let library = root.join("visual-assets");
    if let (Some("restore"), [snapshot]) = (operation.to_str(), rest) {
        let manifest = snapshot::restore(
            Path::new(snapshot),
            &library,
            worker::restore_thumbnails(),
            &|phase| {
                interrupt_at(phase);
                Ok(())
            },
        )?;
        println!("{}", serde_json::to_string(&manifest)?);
        return Ok(());
    }
    let store = backup_jobs::Store::open(&root.join("visual-assets-jobs"), &library)?;
    if let (Some(action @ ("animation-retry-plan" | "animation-retry")), [id, parent]) =
        (operation.to_str(), rest)
    {
        let (parent, _handles) = backup_destination::hold(Path::new(parent))?;
        let retry = store.retry_animation(id.to_str().ok_or("invalid animation task id")?)?;
        retry.check_target(&parent)?;
        if action == "animation-retry-plan" {
            println!("{}", serde_json::to_string(&retry)?);
        } else {
            let job = store.begin_animation_retry(&retry)?;
            store.run_animation(&job, &library, &std::sync::Mutex::new(()), &interrupt_at)?;
            println!("{}", serde_json::to_string(&store.latest()?)?);
        }
        return Ok(());
    }
    if let (Some("animation-install-plan"), [parent, name]) = (operation.to_str(), rest) {
        let (parent, _handles) = backup_destination::hold(Path::new(parent))?;
        let plan =
            animation_install::plan(&parent, name.to_str().ok_or("invalid animation name")?)?;
        println!("{}", serde_json::to_string(&plan)?);
        return Ok(());
    }
    if let (Some("animation-install"), [parent, name, intent, previous]) =
        (operation.to_str(), rest)
    {
        let (parent, _handles) = backup_destination::hold(Path::new(parent))?;
        let plan =
            animation_install::plan(&parent, name.to_str().ok_or("invalid animation name")?)?;
        if previous.to_str() != Some(plan.previous.as_deref().unwrap_or("new")) {
            return Err("Godot animation changed after the plan".into());
        }
        let intent = serde_json::from_slice(&animation::read_recipe(Path::new(intent))?)?;
        let job = store.begin_animation_install(&plan, &intent)?;
        store.run_animation(&job, &library, &std::sync::Mutex::new(()), &interrupt_at)?;
        println!("{}", serde_json::to_string(&store.latest()?)?);
        return Ok(());
    }
    if let (Some("animation-preview"), [intent]) = (operation.to_str(), rest) {
        let intent = serde_json::from_slice(&animation::read_recipe(Path::new(intent))?)?;
        let preview =
            animation_preview::render(&library, &intent, &std::sync::Mutex::new(()), &|| Ok(()))?;
        println!("{preview}");
        return Ok(());
    }
    if let (Some("animation-job" | "animation-job-cancel"), [parent, intent]) =
        (operation.to_str(), rest)
    {
        let (parent, _handles) = backup_destination::hold(Path::new(parent))?;
        let intent = serde_json::from_slice(&animation::read_recipe(Path::new(intent))?)?;
        let job = store.begin_animation(&parent, &intent)?;
        let cancel = operation == "animation-job-cancel";
        let outcome = store.run_animation(&job, &library, &std::sync::Mutex::new(()), &|phase| {
            if cancel && phase == "animation-rendering" {
                store.cancel(&job.id).expect("cancel animation job");
            } else {
                interrupt_at(phase);
            }
        });
        if !cancel {
            outcome?;
        }
        println!("{}", serde_json::to_string(&store.latest()?)?);
        return Ok(());
    }
    if let (Some("job-status"), []) = (operation.to_str(), rest) {
        println!("{}", serde_json::to_string(&store.latest_for_display()?)?);
        return Ok(());
    }
    if let (Some("backup-default" | "backup-with-references"), [parent]) =
        (operation.to_str(), rest)
    {
        let (parent, _handles) = backup_destination::hold(Path::new(parent))?;
        let job = store.begin(&parent, operation == "backup-with-references")?;
        store.run(&job, &library, &interrupt_at)?;
        println!("{}", serde_json::to_string(&store.latest()?)?);
        return Ok(());
    }
    if let (Some("restore-default"), [source]) = (operation.to_str(), rest) {
        let (source, _handles) = backup_destination::hold(Path::new(source))?;
        let job = store.begin_restore(&library)?;
        store.run_restore(&job, &source, &interrupt_at)?;
        println!("{}", serde_json::to_string(&store.latest()?)?);
        return Ok(());
    }
    if !library.try_exists()? {
        for entry in fs::read_dir(&root)? {
            if entry?
                .file_name()
                .to_string_lossy()
                .starts_with("pending-restore-")
            {
                return Err("incomplete restore: retry restore before opening this library".into());
            }
        }
    }
    fs::create_dir_all(&library)?;
    let mut db = catalog::open(&library)?;
    if let Some(result) =
        probe_generation::run(&mut db, &library, operation.to_str(), rest, &interrupt_at)
    {
        println!("{}", result?);
        return Ok(());
    }
    if let Some(result) =
        probe_novel_drafts::run(&mut db, &library, operation.to_str(), rest, &interrupt_at)
    {
        println!("{}", result?);
        return Ok(());
    }
    if let (Some("character-action"), [library_id, action]) = (operation.to_str(), rest) {
        let action = serde_json::from_slice(&animation::read_recipe(Path::new(action))?)?;
        let library_id = library_id.to_str().ok_or("invalid library id")?;
        let result =
            character_commands::apply(&mut db, &library, library_id, action, &interrupt_at)?;
        println!("{result}");
        return Ok(());
    }
    if let (Some("reference-import"), [picked, files @ ..]) = (operation.to_str(), rest) {
        let files: Vec<_> = files.iter().map(std::path::PathBuf::from).collect();
        let source = reference_source::Root::approve(Path::new(picked))?;
        let items = reference_import::import_selected(
            &mut db,
            &library,
            &root,
            &source,
            &files,
            &interrupt_at,
        )?;
        println!("{}", serde_json::to_string(&items)?);
        return Ok(());
    }
    if operation == "import-batch" {
        let sources: Vec<_> = rest.iter().map(std::path::PathBuf::from).collect();
        let items = import_batch::import_selected(&mut db, &library, &sources, &interrupt_at)?;
        println!("{}", serde_json::to_string(&items)?);
        return Ok(());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, &library)?;
    match (operation.to_str(), rest) {
        (Some("library-id"), []) => {
            let id: String = tx.query_row("SELECT id FROM library", [], |row| row.get(0))?;
            tx.commit()?;
            println!("{id}");
        }
        (Some("animation-export"), [asset, revision, recipe, destination]) => {
            let asset = asset.to_str().ok_or("invalid asset id")?.parse()?;
            let revision = revision.to_str().ok_or("invalid revision")?.parse()?;
            let atlas = imports::read_original(&tx, &library, asset, revision)?;
            tx.commit()?;
            let manifest =
                probe_animation::export(&atlas, Path::new(recipe), Path::new(destination))?;
            println!("{manifest}");
        }
        (Some("animation-export-sequence"), [recipe, destination]) => {
            let manifest = probe_animation::export_sequence(
                tx,
                &library,
                Path::new(recipe),
                Path::new(destination),
            )?;
            println!("{manifest}");
        }
        (Some("reference-status"), [asset]) => {
            let asset = asset.to_str().ok_or("invalid asset id")?.parse()?;
            let (bytes, fingerprint) = reference_import::read(&tx, &root, asset, 1)?;
            println!(
                "{}",
                serde_json::json!({"bytes": bytes.len(), "sha256": fingerprint.sha256})
            );
            tx.commit()?;
        }
        (Some("list-timing"), [after, query]) => {
            let after = after.to_str().ok_or("invalid cursor")?.parse()?;
            let query = query.to_str().ok_or("invalid query")?;
            println!("{}", probe_listing::measure(&tx, after, query)?);
            tx.commit()?;
        }
        (Some("list-scan"), []) => {
            use std::io::{self, Write};
            let mut output = io::BufWriter::new(io::stdout().lock());
            probe_listing::scan(&tx, &mut output)?;
            writeln!(output)?;
            output.flush()?;
            tx.commit()?;
        }
        (Some("reference-preview" | "reference-preview-repeat"), [asset]) => {
            let asset = asset.to_str().ok_or("invalid asset id")?.parse()?;
            println!(
                "{}",
                probe_preview::render(
                    &tx,
                    &library,
                    asset,
                    operation == "reference-preview-repeat"
                )?
            );
            tx.commit()?;
        }
        (Some("reference-reauthorize"), [asset, picked]) => {
            let asset = asset.to_str().ok_or("invalid asset id")?.parse()?;
            let source = reference_source::Root::approve(Path::new(picked))?;
            reference_import::reauthorize(&tx, &root, asset, 1, &source)?;
            tx.commit()?;
        }
        (Some("import"), [source]) => {
            let id = imports::import(&tx, &library, Path::new(source), &interrupt_at)?;
            tx.commit()?;
            interrupt_at("committed");
            println!("{id}");
        }
        (Some("list"), [] | [_] | [_, _]) => {
            let after: i64 = rest
                .first()
                .map_or("0", |value| value.to_str().unwrap_or(""))
                .parse()?;
            let page = match rest.get(1).and_then(|query| query.to_str()) {
                Some(query)
                    if !query.is_empty()
                        && query.chars().count() <= name_search::MAX_QUERY_CHARS =>
                {
                    catalog::listing(&tx, after, query, "", None, false)?
                }
                Some(_) => return Err("invalid search term".into()),
                None => catalog::listing(&tx, after, "", "", None, false)?,
            };
            println!("{}", serde_json::to_string(&page)?);
            tx.commit()?;
        }
        (Some("duplicates-list"), [after] | [after, _, _, _]) => {
            let after: i64 = after.to_str().ok_or("invalid cursor")?.parse()?;
            let query = rest.get(1).and_then(|value| value.to_str()).unwrap_or("");
            let tag = rest.get(2).and_then(|value| value.to_str()).unwrap_or("");
            let collection = rest
                .get(3)
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty());
            if query.chars().count() > name_search::MAX_QUERY_CHARS
                || (!tag.is_empty() && !tags::valid(tag))
            {
                return Err("invalid search filters".into());
            }
            let page = catalog::listing(&tx, after, query, tag, collection, true)?;
            println!("{}", serde_json::to_string(&page)?);
            tx.commit()?;
        }
        (Some("tag-list"), [after, tag] | [after, tag, _]) => {
            let after = after.to_str().ok_or("invalid cursor")?.parse()?;
            let tag = tag
                .to_str()
                .filter(|tag| tags::valid(tag))
                .ok_or("invalid tag")?;
            let query = rest.get(2).and_then(|query| query.to_str()).unwrap_or("");
            if query.chars().count() > name_search::MAX_QUERY_CHARS {
                return Err("invalid search term".into());
            }
            let page = catalog::listing(&tx, after, query, tag, None, false)?;
            println!("{}", serde_json::to_string(&page)?);
            tx.commit()?;
        }
        (Some("tag"), [asset, labels @ ..]) => {
            let asset = asset.to_str().ok_or("invalid asset id")?.parse()?;
            let previous = tags::read(&tx, asset)?;
            let labels: Vec<_> = labels
                .iter()
                .map(|label| label.to_string_lossy().into_owned())
                .collect();
            let updated = tags::replace(&tx, asset, &previous, &labels)?;
            tx.commit()?;
            println!("{}", serde_json::to_string(&updated)?);
        }
        (Some("collections"), []) => {
            println!("{}", serde_json::to_string(&collections::list(&tx)?)?);
        }
        (Some("collection-edit"), [edit]) => {
            let edit = serde_json::from_str(edit.to_str().ok_or("invalid collection edit")?)?;
            let id = collections::apply(&tx, edit)?;
            tx.commit()?;
            println!("{}", serde_json::json!({ "id": id }));
        }
        (Some("collection-list"), [after, id, filters @ ..]) if filters.len() <= 2 => {
            let after = after.to_str().ok_or("invalid cursor")?.parse()?;
            let id = id.to_str().ok_or("invalid collection ID")?;
            let query = filters
                .first()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let tag = filters
                .get(1)
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let page = catalog::listing(&tx, after, query, tag, Some(id), false)?;
            println!("{}", serde_json::to_string(&page)?);
            tx.commit()?;
        }
        (Some("backup"), [destination]) => {
            tx.commit()?;
            let snapshot = snapshot::create(
                &mut db,
                &library,
                Path::new(destination),
                None,
                &|phase| {
                    interrupt_at(phase);
                    Ok(())
                },
                &|_| Ok(()),
            )?;
            println!("{}", snapshot.display());
        }
        _ => return Err("expected import, list, backup or restore".into()),
    }
    Ok(())
}

fn interrupt_at(phase: &str) {
    if env::var("ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT").as_deref() == Ok(phase) {
        std::process::exit(86);
    }
}
