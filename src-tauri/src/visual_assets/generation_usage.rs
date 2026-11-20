//! Only matched ComfyUI execution events can substantiate execution time.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Budget {
    provider_fee_limit: u32,
}

// This adapter uses only the loopback endpoint and a graph of built-in local nodes.
pub(super) const LOCAL_BUDGET: Budget = Budget {
    provider_fee_limit: 0,
};
pub(super) const LOCAL_PROVIDER_CHARGE: u32 = 0;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Outcome {
    Success,
    Error,
    Interrupted,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Execution {
    started_at_ms: u64,
    finished_at_ms: u64,
    outcome: Outcome,
}

impl Execution {
    pub(super) fn from_history(status: &Value, prompt: Uuid, state: &str) -> Option<Self> {
        if !terminal(state) {
            return None;
        }
        let prompt = prompt.to_string();
        let mut start = None;
        let mut end = None;
        for event in status["messages"].as_array()? {
            let payload = event.get(1);
            if payload.and_then(|value| value["prompt_id"].as_str()) != Some(prompt.as_str()) {
                continue;
            }
            let outcome = match event.get(0).and_then(Value::as_str) {
                Some("execution_start") => {
                    if start.replace(payload?["timestamp"].as_u64()?).is_some() {
                        return None;
                    }
                    continue;
                }
                Some("execution_success") => Outcome::Success,
                Some("execution_error") => Outcome::Error,
                Some("execution_interrupted") => Outcome::Interrupted,
                _ => continue,
            };
            start?;
            if end
                .replace((outcome, payload?["timestamp"].as_u64()?))
                .is_some()
            {
                return None;
            }
        }
        let (outcome, finished_at_ms) = end?;
        let usage = Self {
            started_at_ms: start?,
            finished_at_ms,
            outcome,
        };
        usage.valid_for(state).then_some(usage)
    }

    pub(super) fn valid_for(&self, state: &str) -> bool {
        matches!(
            (self.outcome, state),
            (Outcome::Success, "ready" | "no_output")
                | (Outcome::Error | Outcome::Interrupted, "failed")
        ) && self.started_at_ms > 0
            && self.started_at_ms <= self.finished_at_ms
            && self.finished_at_ms < (1_u64 << 53)
    }
}

pub(super) fn terminal(state: &str) -> bool {
    matches!(state, "ready" | "no_output" | "failed")
}
