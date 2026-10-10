use super::TerminalManager;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::path::Path;

pub fn dispatch_environment(
    manager: &TerminalManager,
    root: &Path,
    workspace: &str,
    request_id: &str,
    operation: &str,
    frame: &Value,
    environment: &crate::project_environment::Environment,
) -> Result<Value, String> {
    let mut response =
        json!({ "type": "host_response", "requestId": request_id, "operation": operation });
    if matches!(operation, "terminal_open" | "terminal_open_directory") {
        let directory = match frame.get("directory") {
            Some(Value::String(value)) => value.as_str(),
            None if operation == "terminal_open" => "",
            _ => return Err("task_directory_invalid".into()),
        };
        if operation == "terminal_open" && !directory.is_empty() {
            return Err("terminal_operation_unsupported".into());
        }
        let open_intent_id = match frame.get("openIntentId") {
            None => None,
            Some(Value::String(value)) if uuid::Uuid::parse_str(value).is_ok() => {
                Some(value.as_str())
            }
            _ => return Err("terminal_open_intent_invalid".into()),
        };
        response["terminal"] = json!(manager.open_in(
            root,
            workspace,
            directory,
            (number(frame, "cols")?, number(frame, "rows")?),
            environment,
            open_intent_id
        )?);
    } else if operation == "terminal_list" {
        response["terminals"] = json!(manager.list(root, workspace)?);
        response["openIntentSupported"] = json!(true);
    } else {
        let id = frame
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or("terminal_not_found")?;
        match operation {
            "terminal_read" => {
                let (info, chunk) = manager.read(root, workspace, id, number(frame, "offset")?)?;
                response["terminal"] = json!(info);
                response["chunk"] = json!(chunk);
            }
            "terminal_input" => {
                let data = frame
                    .get("data")
                    .and_then(Value::as_str)
                    .filter(|s| s.len() <= 8192)
                    .ok_or("terminal_input_invalid")?;
                let bytes = STANDARD
                    .decode(data)
                    .map_err(|_| "terminal_input_invalid")?;
                manager.input(root, workspace, id, bytes)?;
            }
            "terminal_resize" => manager.resize(
                root,
                workspace,
                id,
                number(frame, "cols")?,
                number(frame, "rows")?,
            )?,
            "terminal_close" => manager.close(root, workspace, id)?,
            _ => return Err("terminal_operation_unsupported".into()),
        }
    }
    Ok(response)
}
fn number(frame: &Value, key: &str) -> Result<u64, String> {
    frame
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| "terminal_request_invalid".into())
}
