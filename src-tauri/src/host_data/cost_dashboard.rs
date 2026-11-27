//! Local session usage parsing and the aggregate cost dashboard.
use super::{
    same_dir, CostBreakdownEntry, CostDashboard, CostSessionRow, HostDataError, HostDataPlane,
};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
struct SessionMetrics {
    id: String,
    title: String,
    cwd: Option<PathBuf>,
    model: String,
    timestamp: String,
    total_cost: f64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read: u64,
    cache_write: u64,
    user_messages: u64,
    tool_calls: u64,
    tool_cost_by_name: HashMap<String, f64>,
}

impl HostDataPlane {
    pub fn cost_dashboard(&self, workspace_id: &str) -> Result<CostDashboard, HostDataError> {
        // Validate the workspace id (keeps the RPC contract), but the dashboard
        // aggregates usage across ALL projects under the session root — the UI
        // is designed to rank projects globally, not scope to one workspace.
        let _ = self.workspace_root(workspace_id)?;
        let mut sessions = Vec::new();
        for path in self.session_files()? {
            if let Some(metrics) = parse_session_metrics(&path, None)? {
                sessions.push(metrics);
            }
        }
        Ok(build_cost_dashboard(sessions))
    }
}

fn parse_session_metrics(
    path: &Path,
    workspace: Option<&Path>,
) -> Result<Option<SessionMetrics>, HostDataError> {
    let file = std::fs::File::open(path).map_err(|error| HostDataError::Io(error.to_string()))?;
    let mut metrics = SessionMetrics {
        model: "unknown".to_owned(),
        ..SessionMetrics::default()
    };
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match entry.get("type").and_then(serde_json::Value::as_str) {
            Some("session") => {
                metrics.id = entry
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                metrics.timestamp = entry
                    .get("timestamp")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                metrics.cwd = entry
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .map(PathBuf::from);
            }
            Some("session_info") => {
                if let Some(name) = entry.get("name").and_then(serde_json::Value::as_str) {
                    metrics.title = name.to_owned();
                }
            }
            Some("model_change") => {
                if let Some(model) = entry.get("model").and_then(serde_json::Value::as_str) {
                    metrics.model = model.to_owned();
                }
            }
            Some("message") => {
                let Some(role) = entry
                    .pointer("/message/role")
                    .and_then(serde_json::Value::as_str)
                else {
                    continue;
                };
                if role == "user" {
                    metrics.user_messages += 1;
                    continue;
                }
                if role != "assistant" {
                    continue;
                }
                if let Some(model) = entry
                    .pointer("/message/model")
                    .and_then(serde_json::Value::as_str)
                {
                    metrics.model = model.to_owned();
                }
                let usage = entry.pointer("/message/usage");
                let cost = usage
                    .and_then(|usage| usage.pointer("/cost/total"))
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(0.0);
                metrics.total_cost += cost;
                metrics.input_tokens += usage
                    .and_then(|usage| usage.get("input"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.output_tokens += usage
                    .and_then(|usage| usage.get("output"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.cache_read += usage
                    .and_then(|usage| usage.get("cacheRead"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.cache_write += usage
                    .and_then(|usage| usage.get("cacheWrite"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                let tool_calls: Vec<&str> = entry
                    .pointer("/message/content")
                    .and_then(serde_json::Value::as_array)
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|block| {
                                block.get("type").and_then(serde_json::Value::as_str)
                                    == Some("toolCall")
                            })
                            .filter_map(|block| {
                                block.get("name").and_then(serde_json::Value::as_str)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                metrics.tool_calls += tool_calls.len() as u64;
                if !tool_calls.is_empty() && cost > 0.0 {
                    let per_tool_cost = cost / tool_calls.len() as f64;
                    for tool_name in tool_calls {
                        *metrics
                            .tool_cost_by_name
                            .entry(tool_name.to_owned())
                            .or_insert(0.0) += per_tool_cost;
                    }
                }
            }
            _ => {}
        }
    }
    if metrics.id.is_empty() {
        return Ok(None);
    }
    if let Some(workspace) = workspace {
        let Some(cwd) = metrics.cwd.as_ref() else {
            return Ok(None);
        };
        if !same_dir(cwd, workspace) {
            return Ok(None);
        }
    }
    if metrics.title.is_empty() {
        metrics.title = "Untitled".to_owned();
    }
    Ok(Some(metrics))
}

fn build_cost_dashboard(sessions: Vec<SessionMetrics>) -> CostDashboard {
    let mut dashboard = CostDashboard::default();
    let mut by_model: Vec<(String, f64)> = Vec::new();
    let mut by_tool: HashMap<String, f64> = HashMap::new();
    for session in &sessions {
        dashboard.summary.total_cost += session.total_cost;
        let session_tokens =
            session.input_tokens + session.output_tokens + session.cache_read + session.cache_write;
        dashboard.summary.total_tokens += session_tokens;
        dashboard.summary.user_message_count += session.user_messages;
        dashboard.summary.session_count += 1;

        match by_model.iter_mut().find(|(name, _)| name == &session.model) {
            Some((_, cost)) => *cost += session.total_cost,
            None => by_model.push((session.model.clone(), session.total_cost)),
        }
        for (tool_name, cost) in &session.tool_cost_by_name {
            *by_tool.entry(tool_name.clone()).or_insert(0.0) += cost;
        }
    }
    dashboard.summary.avg_cost_per_session = if dashboard.summary.session_count > 0 {
        dashboard.summary.total_cost / dashboard.summary.session_count as f64
    } else {
        0.0
    };
    dashboard.summary.avg_cost_per_user_message = if dashboard.summary.user_message_count > 0 {
        dashboard.summary.total_cost / dashboard.summary.user_message_count as f64
    } else {
        0.0
    };
    by_model.sort_by(|left, right| right.1.total_cmp(&left.1));
    dashboard.by_model = by_model
        .into_iter()
        .map(|(name, cost)| CostBreakdownEntry { name, cost })
        .collect();
    let mut by_tool: Vec<(String, f64)> = by_tool.into_iter().collect();
    by_tool.sort_by(|left, right| right.1.total_cmp(&left.1));
    dashboard.by_tool = by_tool
        .into_iter()
        .map(|(name, cost)| CostBreakdownEntry { name, cost })
        .collect();

    let mut session_rows: Vec<CostSessionRow> = sessions
        .into_iter()
        .map(|session| {
            let project_path = session
                .cwd
                .as_ref()
                .map(|cwd| cwd.to_string_lossy().into_owned())
                .unwrap_or_default();
            let project_name = session
                .cwd
                .as_ref()
                .and_then(|cwd| cwd.file_name())
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| project_path.clone());
            CostSessionRow {
                id: session.id,
                title: session.title,
                model: session.model,
                time: session.timestamp,
                total_cost: session.total_cost,
                total_tokens: session.input_tokens
                    + session.output_tokens
                    + session.cache_read
                    + session.cache_write,
                input_tokens: session.input_tokens,
                output_tokens: session.output_tokens,
                cache_read: session.cache_read,
                cache_write: session.cache_write,
                tool_calls: session.tool_calls,
                tool_cost_by_name: session.tool_cost_by_name,
                user_messages: session.user_messages,
                project_path,
                project_name,
            }
        })
        .collect();
    session_rows.sort_by(|left, right| right.total_cost.total_cmp(&left.total_cost));
    dashboard.top_sessions = session_rows.iter().take(20).cloned().collect();
    dashboard.sessions = session_rows;
    dashboard
}

#[cfg(test)]
mod tests {
    use super::{HostDataError, HostDataPlane};
    use std::collections::HashMap;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn builds_cost_dashboard_across_all_projects() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-cost-{nonce}"));
        let workspace = temp.join("workspace");
        let other = temp.join("other");
        let sessions = temp.join("sessions/project");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        fs::write(
            sessions.join("included.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hi\"}}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{{\"input\":10,\"output\":20,\"cost\":{{\"total\":0.5}}}},\"content\":[{{\"type\":\"toolCall\",\"name\":\"bash\"}}]}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        fs::write(
            sessions.join("excluded.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{{\"cost\":{{\"total\":99.0}}}}}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace.clone())]))
            .unwrap()
            .with_session_root(temp.join("sessions"));

        let dashboard = data.cost_dashboard("workspace-a").unwrap();
        // Both projects are aggregated, not just the registered workspace.
        assert_eq!(dashboard.summary.session_count, 2);
        assert_eq!(dashboard.summary.total_cost, 99.5);
        assert_eq!(dashboard.summary.total_tokens, 30);
        assert_eq!(dashboard.by_model[0].name, "gpt-5");
        assert_eq!(dashboard.by_tool[0].name, "bash");
        // The most expensive session sorts first.
        assert_eq!(dashboard.top_sessions[0].id, "session-b");

        assert_eq!(
            data.cost_dashboard("unregistered"),
            Err(HostDataError::UnknownWorkspace)
        );
        let wire = serde_json::to_value(&dashboard).unwrap();
        let rows = serde_json::json!([
            {
                "id": "session-b", "title": "Untitled", "model": "gpt-5", "time": "",
                "totalCost": 99.0, "totalTokens": 0, "inputTokens": 0, "outputTokens": 0,
                "cacheRead": 0, "cacheWrite": 0, "toolCalls": 0, "toolCostByName": {},
                "userMessages": 0, "projectPath": other.to_string_lossy(), "projectName": "other"
            },
            {
                "id": "session-a", "title": "Untitled", "model": "gpt-5", "time": "2026-01-01",
                "totalCost": 0.5, "totalTokens": 30, "inputTokens": 10, "outputTokens": 20,
                "cacheRead": 0, "cacheWrite": 0, "toolCalls": 1, "toolCostByName": {"bash": 0.5},
                "userMessages": 1, "projectPath": workspace.to_string_lossy(),
                "projectName": "workspace"
            },
        ]);
        assert_eq!(
            wire,
            serde_json::json!({
                "summary": {
                    "totalCost": 99.5, "totalTokens": 30, "sessionCount": 2, "userMessageCount": 1,
                    "avgCostPerSession": 49.75, "avgCostPerUserMessage": 99.5
                },
                "byModel": [{"name": "gpt-5", "cost": 99.5}],
                "byTool": [{"name": "bash", "cost": 0.5}],
                "topSessions": rows,
                "sessions": rows
            })
        );
        fs::remove_dir_all(temp).unwrap();
    }
}
