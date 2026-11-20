//! The local ComfyUI HTTP boundary. Network activity is restricted to the confirmed loopback port.
use super::{generation_usage::Execution, generation_workflow::Inputs, worker, Result};
use reqwest::blocking::{multipart, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{collections::BTreeSet, io::Read, time::Duration};
use uuid::Uuid;

const MAX_JSON: u64 = 4 * 1024 * 1024;

pub(super) struct Comfy {
    client: Client,
    base: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Output {
    pub(super) filename: String,
    subfolder: String,
}

impl Output {
    pub(super) fn matches(&self, attempt: Uuid, filename: &str) -> bool {
        self.filename == filename && self.subfolder == "zicode" && valid_filename(attempt, filename)
    }
}

pub(super) enum Submission {
    Accepted(Uuid),
    Rejected,
}

pub(super) struct Observed {
    pub(super) prompt_id: Uuid,
    pub(super) state: &'static str,
    pub(super) outputs: Vec<Output>,
    pub(super) execution_usage: Option<Execution>,
}

impl Comfy {
    pub(super) fn new(port: u16) -> Result<Self> {
        if port == 0 {
            return Err("visual_assets_comfy_endpoint_invalid".into());
        }
        let client = Client::builder()
            .no_proxy()
            .http1_only()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(15))
            .build()?;
        Ok(Self {
            client,
            base: format!("http://127.0.0.1:{port}"),
        })
    }

    pub(super) fn capabilities(&self, inputs: &Inputs, graph: &Map<String, Value>) -> Result<()> {
        let classes: BTreeSet<_> = graph
            .values()
            .filter_map(|node| node["class_type"].as_str())
            .collect();
        for class in classes {
            let result = self.get(&format!("/object_info/{class}"))?;
            let node = result
                .get(class)
                .filter(|node| node.is_object())
                .ok_or("visual_assets_comfy_missing_nodes")?;
            if class == "CheckpointLoaderSimple" {
                let choices = node
                    .pointer("/input/required/ckpt_name/0")
                    .and_then(Value::as_array)
                    .ok_or("visual_assets_comfy_checkpoint_unavailable")?;
                if !choices
                    .iter()
                    .any(|name| name.as_str() == Some(inputs.settings.checkpoint.as_str()))
                {
                    return Err("visual_assets_comfy_checkpoint_unavailable".into());
                }
            }
        }
        Ok(())
    }

    pub(super) fn upload(&self, filename: &str, bytes: Vec<u8>) -> Result<()> {
        let image = multipart::Part::bytes(bytes).file_name(filename.to_string());
        let body = multipart::Form::new()
            .part("image", image)
            .text("subfolder", "zicode")
            .text("type", "input");
        let response = self
            .client
            .post(format!("{}/upload/image", self.base))
            .multipart(body)
            .send()?;
        let result = checked(response)?;
        if result["name"].as_str() != Some(filename)
            || result["subfolder"].as_str() != Some("zicode")
            || result["type"].as_str() != Some("input")
        {
            return Err("visual_assets_comfy_upload_unverified".into());
        }
        Ok(())
    }

    pub(super) fn read_output(&self, attempt: Uuid, output: &Output) -> Result<Vec<u8>> {
        if !output.matches(attempt, &output.filename) {
            return Err("visual_assets_comfy_output_invalid".into());
        }
        let response = self
            .client
            .get(format!("{}/view", self.base))
            .query(&[
                ("filename", output.filename.as_str()),
                ("subfolder", "zicode"),
                ("type", "output"),
            ])
            .send()?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|len| len > worker::INPUT)
        {
            return Err("visual_assets_comfy_output_unavailable".into());
        }
        let mut bytes = Vec::new();
        response.take(worker::INPUT + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > worker::INPUT || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("visual_assets_comfy_output_invalid".into());
        }
        Ok(bytes)
    }

    pub(super) fn submit(&self, attempt: Uuid, graph: &Map<String, Value>) -> Result<Submission> {
        let attempt = attempt.to_string();
        let response = self
            .client
            .post(format!("{}/prompt", self.base))
            .json(&json!({
                "prompt":graph,"client_id":attempt,"extra_data":{"zicode_attempt":attempt},
            }))
            .send()?;
        if response.status() == reqwest::StatusCode::BAD_REQUEST {
            let result = read_json(response)?;
            if result["error"].is_object() && result["node_errors"].is_object() {
                return Ok(Submission::Rejected);
            }
            return Err("visual_assets_comfy_submission_unknown".into());
        }
        let result = checked(response)?;
        let id = result["prompt_id"]
            .as_str()
            .ok_or("visual_assets_comfy_submission_unknown")?;
        Ok(Submission::Accepted(Uuid::parse_str(id)?))
    }

    pub(super) fn history(&self, attempt: Uuid, known: Option<Uuid>) -> Result<Option<Observed>> {
        let history = match known {
            Some(id) => self.get(&format!("/history/{id}"))?,
            None => self.get("/history?max_items=32")?,
        };
        for (key, entry) in history
            .as_object()
            .ok_or("visual_assets_comfy_status_invalid")?
        {
            if let Some(id) =
                correlation(&entry["prompt"], attempt, known).filter(|id| key == &id.to_string())
            {
                return Ok(Some(finished(entry, attempt, id)));
            }
        }
        Ok(None)
    }

    pub(super) fn observe(&self, attempt: Uuid, known: Option<Uuid>) -> Result<Option<Observed>> {
        if let Some(observed) = self.history(attempt, known)? {
            return Ok(Some(observed));
        }
        let queue = self.get("/queue")?;
        for (key, state) in [("queue_running", "running"), ("queue_pending", "queued")] {
            let entries = queue[key]
                .as_array()
                .ok_or("visual_assets_comfy_status_invalid")?;
            if let Some(prompt_id) = entries
                .iter()
                .find_map(|entry| correlation(entry, attempt, known))
            {
                return Ok(Some(Observed {
                    prompt_id,
                    state,
                    outputs: Vec::new(),
                    execution_usage: None,
                }));
            }
        }
        Ok(None)
    }

    fn get(&self, path: &str) -> Result<Value> {
        checked(
            self.client
                .get(format!("{}{path}", self.base))
                .timeout(Duration::from_secs(3))
                .send()?,
        )
    }
}

fn correlation(prompt: &Value, attempt: Uuid, known: Option<Uuid>) -> Option<Uuid> {
    let id = Uuid::parse_str(prompt.get(1)?.as_str()?).ok()?;
    let observed = Uuid::parse_str(prompt.get(3)?.get("zicode_attempt")?.as_str()?).ok()?;
    (observed == attempt && known.is_none_or(|known| known == id)).then_some(id)
}

fn valid_filename(attempt: Uuid, filename: &str) -> bool {
    filename.starts_with(&format!("{attempt}_"))
        && filename.ends_with(".png")
        && filename.len() <= 100
        && filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn finished(entry: &Value, attempt: Uuid, prompt_id: Uuid) -> Observed {
    let mut outputs = Vec::new();
    let status = &entry["status"];
    let state = if status["status_str"].as_str() == Some("success")
        && status["completed"].as_bool() == Some(true)
    {
        if let Some(nodes) = entry["outputs"].as_object() {
            for image in nodes
                .values()
                .filter_map(|value| value["images"].as_array())
                .flatten()
                .take(9)
            {
                let Some(filename) = image["filename"]
                    .as_str()
                    .filter(|name| valid_filename(attempt, name))
                else {
                    continue;
                };
                if image["type"].as_str() == Some("output")
                    && image["subfolder"].as_str() == Some("zicode")
                    && !outputs
                        .iter()
                        .any(|existing: &Output| existing.filename == filename)
                {
                    outputs.push(Output {
                        filename: filename.to_string(),
                        subfolder: "zicode".to_string(),
                    });
                }
            }
        }
        if outputs.is_empty() || outputs.len() > 8 {
            outputs.clear();
            "no_output"
        } else {
            "ready"
        }
    } else if status["status_str"].as_str() == Some("error") {
        "failed"
    } else {
        "unknown"
    };
    Observed {
        prompt_id,
        state,
        outputs,
        execution_usage: Execution::from_history(status, prompt_id, state),
    }
}

fn checked(response: Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err("visual_assets_comfy_unavailable".into());
    }
    read_json(response)
}

fn read_json(response: Response) -> Result<Value> {
    let mut bytes = Vec::new();
    response.take(MAX_JSON + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("visual_assets_comfy_response_limit".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}
