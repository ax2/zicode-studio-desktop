use super::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Reference {
    pub(super) asset_id: i64,
    pub(super) revision: i64,
    name: String,
    pub(super) sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Settings {
    pub(super) checkpoint: String,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) steps: u32,
    pub(super) cfg: f64,
    pub(super) seed: String,
    pub(super) denoise: f64,
}

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Options {
    checkpoint: String,
    width: u32,
    height: u32,
    steps: u32,
    cfg: f64,
    seed: u64,
    denoise: Option<f64>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            checkpoint: String::new(),
            width: 512,
            height: 512,
            steps: 20,
            cfg: 7.,
            seed: 0,
            denoise: None,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Inputs {
    pub(super) settings: Settings,
    pub(super) references: Vec<Reference>,
    pub(super) positive: String,
    pub(super) negative: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeInputs {
    recipe: Recipe,
    identity: String,
    appearance: Option<String>,
    style: Option<String>,
    reference_set: Option<ReferenceSet>,
}

#[derive(Deserialize)]
struct Recipe {
    draft: Draft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Draft {
    prompt: String,
    negative_prompt: String,
    settings_json: String,
}

#[derive(Deserialize)]
struct ReferenceSet {
    references: Vec<Reference>,
}

pub(super) fn inputs(saved: Value) -> Result<Inputs> {
    let saved: RecipeInputs = serde_json::from_value(saved)?;
    let references = saved
        .reference_set
        .map_or_else(Vec::new, |set| set.references);
    let draft = saved.recipe.draft;
    let options: Options = serde_json::from_str(&draft.settings_json)
        .map_err(|_| "visual_assets_comfy_settings_invalid")?;
    let denoise = options
        .denoise
        .unwrap_or(if references.is_empty() { 1. } else { 0.75 });
    let edge = |value: u32| (64..=2048).contains(&value) && value.is_multiple_of(8);
    if options.checkpoint.trim().is_empty()
        || options.checkpoint.len() > 512
        || options.checkpoint.chars().any(char::is_control)
        || !edge(options.width)
        || !edge(options.height)
        || !(1..=100).contains(&options.steps)
        || !(0.0..=30.).contains(&options.cfg)
        || !(0.0..=1.).contains(&denoise)
        || options.width * options.height * (references.len().max(1) as u32) > 8_388_608
    {
        return Err("visual_assets_comfy_settings_invalid".into());
    }
    let positive = [
        Some(saved.identity),
        saved.appearance,
        saved.style,
        Some(draft.prompt),
    ]
    .into_iter()
    .flatten()
    .filter(|text| !text.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    Ok(Inputs {
        settings: Settings {
            checkpoint: options.checkpoint,
            width: options.width,
            height: options.height,
            steps: options.steps,
            cfg: options.cfg,
            seed: options.seed.to_string(),
            denoise,
        },
        references,
        positive,
        negative: draft.negative_prompt,
    })
}

pub(super) fn graph(inputs: &Inputs, files: &[String], id: &str) -> Result<Map<String, Value>> {
    let mut graph = Map::new();
    let mut add = |name: &str, inputs: Value| {
        let id = (graph.len() + 1).to_string();
        graph.insert(id.clone(), json!({"class_type":name,"inputs":inputs}));
        id
    };
    let s = &inputs.settings;
    let checkpoint = add("CheckpointLoaderSimple", json!({"ckpt_name":s.checkpoint}));
    let positive = add(
        "CLIPTextEncode",
        json!({"clip":[checkpoint,1],"text":inputs.positive}),
    );
    let negative = add(
        "CLIPTextEncode",
        json!({"clip":[checkpoint,1],"text":inputs.negative}),
    );
    let mut batch: Option<String> = None;
    for file in files {
        let image = add("LoadImage", json!({"image":file}));
        let scaled = add(
            "ImageScale",
            json!({"image":[image,0],"upscale_method":"lanczos","width":s.width,"height":s.height,"crop":"center"}),
        );
        batch = Some(if let Some(prior) = batch {
            add(
                "ImageBatch",
                json!({"image1":[prior,0],"image2":[scaled,0]}),
            )
        } else {
            scaled
        });
    }
    let latent = if let Some(batch) = batch {
        add(
            "VAEEncode",
            json!({"pixels":[batch,0],"vae":[checkpoint,2]}),
        )
    } else {
        add(
            "EmptyLatentImage",
            json!({"width":s.width,"height":s.height,"batch_size":1}),
        )
    };
    let seed: u64 = s.seed.parse()?;
    let sample = add(
        "KSampler",
        json!({"model":[checkpoint,0],"positive":[positive,0],"negative":[negative,0],"latent_image":[latent,0],
        "seed":seed,"steps":s.steps,"cfg":s.cfg,"sampler_name":"euler","scheduler":"normal","denoise":s.denoise}),
    );
    let decoded = add(
        "VAEDecode",
        json!({"samples":[sample,0],"vae":[checkpoint,2]}),
    );
    add(
        "SaveImage",
        json!({"images":[decoded,0],"filename_prefix":format!("zicode/{id}")}),
    );
    Ok(graph)
}
