#![allow(dead_code)]

#[cfg(test)]
use crate::pi_rpc_bridge::InMemoryPiProcess;
use crate::pi_rpc_bridge::{BridgeError, BridgeFrame, PiRpcBridge, PiRpcProcess};
use crate::process_command::new_command;
use crate::runtime_coordinator::{
    MutationAcceptance, RuntimeCoordinator, RuntimeSnapshot, RuntimeState, RuntimeStatus,
    RuntimeTarget,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

const MAX_RPC_FRAME_BYTES: usize = 16 * 1024 * 1024;
/// Runtimes for abandoned `temporary-*` sessions (created by the host for
/// new-session probes and QA) are reaped after this idle grace period so they
/// do not accumulate on the user's machine.
const TEMP_RUNTIME_GRACE: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone)]
pub struct NativeLaunchSpec {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub session_path: Option<PathBuf>,
    pub extensions: Vec<PathBuf>,
    pub pi_version: String,
    pub path_env: String,
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchDescription {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
}

impl NativeLaunchSpec {
    pub fn command_description(&self) -> LaunchDescription {
        let mut args = Vec::new();
        for extension in &self.extensions {
            args.push("--extension".into());
            args.push(extension.to_string_lossy().into_owned());
        }
        args.extend(["--mode".into(), "rpc".into()]);
        if let Some(session_path) = &self.session_path {
            args.push("--session".into());
            args.push(session_path.to_string_lossy().into_owned());
        }
        let mut environment = self.environment.clone();
        environment.extend([
            ("PATH".into(), self.path_env.clone()),
            ("PI_STUDIO_PI_VERSION".into(), self.pi_version.clone()),
        ]);
        LaunchDescription {
            program: self.binary.clone(),
            args,
            environment,
        }
    }
}

struct ManagedRuntime {
    target: Arc<Mutex<RuntimeTarget>>,
    bridge: PiRpcBridge,
    process: Option<PiRpcProcess>,
    launch: Option<NativeLaunchSpec>,
    spawned_at: Instant,
}

struct NativePiManagerInner {
    coordinator: Mutex<RuntimeCoordinator>,
    runtimes: Mutex<HashMap<String, ManagedRuntime>>,
    events: broadcast::Sender<NativeRuntimeEvent>,
    pending_ui: Mutex<HashMap<String, Vec<NativeRuntimeEvent>>>,
    last_respawn: Mutex<HashMap<String, Instant>>,
}

/// Minimum interval between automatic runtime respawns for the same instance.
/// Prevents a rapidly dying pi process from churning the registry.
const RESPAWN_MIN_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeEvent {
    pub target: RuntimeTarget,
    pub sequence: u64,
    pub event: Value,
}

#[derive(Clone)]
pub struct NativePiManager {
    inner: Arc<NativePiManagerInner>,
}

impl NativePiManager {
    pub fn new(idempotency_capacity: usize) -> Self {
        let (events, _) = broadcast::channel(1024);
        Self {
            inner: Arc::new(NativePiManagerInner {
                coordinator: Mutex::new(RuntimeCoordinator::new(idempotency_capacity)),
                runtimes: Mutex::new(HashMap::new()),
                events,
                pending_ui: Mutex::new(HashMap::new()),
                last_respawn: Mutex::new(HashMap::new()),
            }),
        }
    }

    #[cfg(test)]
    fn in_memory(idempotency_capacity: usize) -> Self {
        Self::new(idempotency_capacity)
    }

    pub fn spawn(&self, target: RuntimeTarget, spec: NativeLaunchSpec) -> Result<(), String> {
        // Each new session may abandon an older temporary runtime; clear the
        // stale ones before spawning so the process table does not grow.
        let _ = self.reap_stale_temporary_runtimes(TEMP_RUNTIME_GRACE);
        let launch = spec.command_description();
        let mut command = new_command(&launch.program);
        command
            .args(&launch.args)
            .envs(&launch.environment)
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let launch_spec = spec.clone();
        let child = command
            .spawn()
            .map_err(|error| format!("Cannot start embedded Pi native RPC process: {error}"))?;
        let (bridge, mut process) = PiRpcBridge::attach(child, MAX_RPC_FRAME_BYTES)?;
        if let Err(error) = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .register(target.clone(), RuntimeState::Starting)
        {
            let _ = process.kill();
            return Err(format!("Cannot register Pi runtime: {error:?}"));
        }
        self.inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .insert(
                target.instance_id.clone(),
                ManagedRuntime {
                    target: Arc::new(Mutex::new(target.clone())),
                    bridge: bridge.clone(),
                    process: Some(process),
                    launch: Some(launch_spec),
                    spawned_at: Instant::now(),
                },
            );
        self.start_event_pump(target, bridge);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn register_in_memory(
        &self,
        target: RuntimeTarget,
    ) -> Result<InMemoryPiProcess, String> {
        let (bridge, process) = PiRpcBridge::in_memory(1024 * 1024);
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .register(target.clone(), RuntimeState::Ready)
            .map_err(|error| format!("Cannot register test runtime: {error:?}"))?;
        self.inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .insert(
                target.instance_id.clone(),
                ManagedRuntime {
                    target: Arc::new(Mutex::new(target.clone())),
                    bridge: bridge.clone(),
                    process: None,
                    launch: None,
                    spawned_at: Instant::now(),
                },
            );
        self.start_event_pump(target, bridge);
        Ok(process)
    }

    /// Stop runtimes for `temporary-*` sessions that are older than `grace`
    /// and are not actively working. Runtimes in Starting/Working state are
    /// never touched; permanent sessions are never touched.
    pub fn reap_stale_temporary_runtimes(&self, grace: Duration) -> usize {
        let states: HashMap<String, RuntimeState> = self
            .inner
            .coordinator
            .lock()
            .map(|coordinator| {
                coordinator
                    .statuses()
                    .into_iter()
                    .map(|status| (status.target.instance_id.clone(), status.state))
                    .collect()
            })
            .unwrap_or_default();
        let targets = self
            .inner
            .runtimes
            .lock()
            .map(|runtimes| {
                runtimes
                    .values()
                    .filter_map(|runtime| {
                        let target = runtime.target.lock().ok()?.clone();
                        if !target.session_id.starts_with("temporary-") {
                            return None;
                        }
                        if runtime.spawned_at.elapsed() <= grace {
                            return None;
                        }
                        let reapable = matches!(
                            states.get(&target.instance_id),
                            Some(
                                RuntimeState::Idle | RuntimeState::Ready | RuntimeState::Suspended
                            )
                        );
                        reapable.then_some(target)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut reaped = 0;
        for target in targets {
            if self.stop(&target).is_ok() {
                reaped += 1;
            }
        }
        if reaped > 0 {
            log::info!("[picot-native] reaped {reaped} stale temporary runtime(s)");
        }
        reaped
    }

    #[cfg(test)]
    fn backdate_runtime(&self, instance_id: &str, at: Instant) {
        if let Ok(mut runtimes) = self.inner.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(instance_id) {
                runtime.spawned_at = at;
            }
        }
    }

    fn start_event_pump(&self, target: RuntimeTarget, bridge: PiRpcBridge) {
        let inner = Arc::clone(&self.inner);
        // Started from the synchronous startup path (Tauri `setup` hook), which
        // has no entered Tokio runtime — use Tauri's global runtime handle so
        // this works off the main thread instead of panicking on `tokio::spawn`.
        tauri::async_runtime::spawn(async move {
            while let Some(frame) = bridge.next_frame().await {
                let target = inner.runtimes.lock().ok().and_then(|runtimes| {
                    runtimes
                        .get(&target.instance_id)?
                        .target
                        .lock()
                        .ok()
                        .map(|target| target.clone())
                });
                let Some(target) = target else {
                    return;
                };
                let event = match frame {
                    BridgeFrame::Event(event) | BridgeFrame::ExtensionUi(event) => event,
                    BridgeFrame::ProtocolError(message) => {
                        serde_json::json!({ "type": "protocol_error", "message": message })
                    }
                };
                let sequenced = {
                    let Ok(mut coordinator) = inner.coordinator.lock() else {
                        return;
                    };
                    match event.get("type").and_then(Value::as_str) {
                        Some("agent_start") => {
                            let _ = coordinator.set_state(&target, RuntimeState::Working);
                        }
                        Some("agent_settled") | Some("agent_end") => {
                            let _ = coordinator.set_state(&target, RuntimeState::Idle);
                        }
                        _ => {}
                    }
                    coordinator.emit_event(&target, event)
                };
                let Ok(sequenced) = sequenced else {
                    return;
                };
                let runtime_event = NativeRuntimeEvent {
                    target: sequenced.target,
                    sequence: sequenced.sequence,
                    event: sequenced.event,
                };
                if runtime_event.event.get("type").and_then(Value::as_str)
                    == Some("extension_ui_request")
                {
                    if let Ok(mut pending) = inner.pending_ui.lock() {
                        pending
                            .entry(runtime_event.target.instance_id.clone())
                            .or_default()
                            .push(runtime_event.clone());
                    }
                }
                let _ = inner.events.send(runtime_event);
            }
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NativeRuntimeEvent> {
        self.inner.events.subscribe()
    }

    pub fn pending_extension_ui(
        &self,
        target: &RuntimeTarget,
    ) -> Result<Vec<NativeRuntimeEvent>, String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Extension UI lookup rejected: {error:?}"))?;
        Ok(self
            .inner
            .pending_ui
            .lock()
            .map_err(|_| "Pending extension UI lock poisoned".to_string())?
            .get(&target.instance_id)
            .cloned()
            .unwrap_or_default())
    }

    /// Rebuild a runtime whose RPC bridge reported `ProcessClosed`. The old
    /// process (if any) is killed, the stale registration is removed, and the
    /// original launch spec is replayed so the target comes back with a fresh
    /// stdin/stdout bridge. Throttled per instance to avoid respawn storms.
    fn respawn(&self, target: &RuntimeTarget) -> Result<(), String> {
        {
            let mut last = self
                .inner
                .last_respawn
                .lock()
                .map_err(|_| "Runtime respawn lock poisoned".to_string())?;
            if let Some(previous) = last.get(&target.instance_id) {
                if previous.elapsed() < RESPAWN_MIN_INTERVAL {
                    return Ok(());
                }
            }
            last.insert(target.instance_id.clone(), Instant::now());
        }

        let launch = {
            let mut runtimes = self
                .inner
                .runtimes
                .lock()
                .map_err(|_| "Native runtime registry lock poisoned".to_string())?;
            let Some(mut runtime) = runtimes.remove(&target.instance_id) else {
                return Ok(());
            };
            if let Some(process) = &mut runtime.process {
                let _ = process.kill();
            }
            runtime.launch
        };
        let Some(launch) = launch else {
            return Err("Native runtime has no launch spec to respawn".into());
        };

        // Best-effort cleanup of the coordinator record so the fresh
        // registration in `spawn` is accepted.
        let _ = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .unregister(target);
        self.spawn(target.clone(), launch)
    }

    pub async fn request(
        &self,
        target: &RuntimeTarget,
        command: Value,
        idempotency_key: Option<&str>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let mut mutation_key = None;
        {
            let mut coordinator = self
                .inner
                .coordinator
                .lock()
                .map_err(|_| "Runtime coordinator lock poisoned".to_string())?;
            coordinator
                .validate_command(target, &command)
                .map_err(|error| format!("Runtime request rejected: {error:?}"))?;
            if is_mutation(
                command
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ) {
                let key = idempotency_key
                    .ok_or_else(|| "Runtime mutation requires an idempotency key".to_string())?;
                let acceptance = coordinator
                    .accept_mutation(target, key)
                    .map_err(|error| format!("Runtime mutation rejected: {error:?}"))?;
                if acceptance == MutationAcceptance::Duplicate {
                    return coordinator
                        .mutation_result(target, key)
                        .map_err(|error| format!("Cannot read mutation result: {error:?}"))?
                        .ok_or_else(|| {
                            "Runtime mutation was accepted and is still pending".into()
                        });
                }
                mutation_key = Some(key.to_owned());
            }
        }
        let bridge = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&target.instance_id)
            .map(|runtime| runtime.bridge.clone())
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        let response = match bridge.request(command.clone(), timeout).await {
            Ok(response) => response,
            Err(BridgeError::ProcessClosed) => {
                // The pi subprocess RPC channel is gone (stdin pipe closed or
                // the process exited). Rebuild the runtime once so config and
                // extension operations recover automatically instead of leaving
                // every dependent view stuck on a disconnected error until the
                // user manually starts a new session.
                self.respawn(target)?;
                let bridge = self
                    .inner
                    .runtimes
                    .lock()
                    .map_err(|_| "Native runtime registry lock poisoned".to_string())?
                    .get(&target.instance_id)
                    .map(|runtime| runtime.bridge.clone())
                    .ok_or_else(|| "Native runtime instance is not running".to_string())?;
                bridge
                    .request(command, timeout)
                    .await
                    .map_err(|error| format!("Pi RPC request failed: {error:?}"))?
            }
            Err(error) => {
                return Err(format!("Pi RPC request failed: {error:?}"));
            }
        };
        if let Some(key) = mutation_key {
            self.inner
                .coordinator
                .lock()
                .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
                .complete_mutation(target, &key, response.clone())
                .map_err(|error| format!("Cannot cache mutation result: {error:?}"))?;
        }
        Ok(response)
    }

    pub fn stop(&self, target: &RuntimeTarget) -> Result<(), String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Runtime stop rejected: {error:?}"))?;
        let mut runtime = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .remove(&target.instance_id)
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        if let Some(process) = &mut runtime.process {
            process.kill()?;
        }
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .unregister(target)
            .map_err(|error| format!("Cannot unregister stopped runtime: {error:?}"))?;
        Ok(())
    }

    pub fn stop_workspace(&self, workspace_id: &str) {
        let targets = self
            .inner
            .runtimes
            .lock()
            .map(|runtimes| {
                runtimes
                    .values()
                    .filter_map(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
                    .filter(|target| target.workspace_id == workspace_id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for target in targets {
            let _ = self.stop(&target);
        }
    }

    pub fn stop_all(&self) {
        let targets = self
            .inner
            .runtimes
            .lock()
            .map(|runtimes| {
                runtimes
                    .values()
                    .filter_map(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for target in targets {
            let _ = self.stop(&target);
        }
    }

    pub fn target_for_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<RuntimeTarget> {
        self.inner
            .runtimes
            .lock()
            .ok()?
            .values()
            .find(|runtime| {
                runtime.target.lock().is_ok_and(|target| {
                    target.workspace_id == workspace_id && target.session_id == session_id
                })
            })
            .and_then(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
    }

    pub fn target_for_session_id(&self, session_id: &str) -> Option<RuntimeTarget> {
        self.inner
            .runtimes
            .lock()
            .ok()?
            .values()
            .find(|runtime| {
                runtime
                    .target
                    .lock()
                    .is_ok_and(|target| target.session_id == session_id)
            })
            .and_then(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
    }

    pub fn bind_session_id(
        &self,
        temporary: &RuntimeTarget,
        session_id: &str,
    ) -> Result<RuntimeTarget, String> {
        if !temporary.session_id.starts_with("temporary-") {
            return Ok(temporary.clone());
        }
        let mut coordinator = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?;
        let binding_event = coordinator
            .emit_event(
                temporary,
                serde_json::json!({
                    "type": "session_bound",
                    "sessionId": session_id,
                }),
            )
            .map_err(|error| format!("Cannot sequence session binding: {error:?}"))?;
        let formal = coordinator
            .bind_session_id(temporary, session_id)
            .map_err(|error| format!("Cannot bind formal session: {error:?}"))?;
        drop(coordinator);
        let runtime = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?;
        let managed = runtime
            .get(&temporary.instance_id)
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        *managed
            .target
            .lock()
            .map_err(|_| "Native runtime target lock poisoned".to_string())? = formal.clone();
        drop(runtime);
        let _ = self.inner.events.send(NativeRuntimeEvent {
            target: binding_event.target,
            sequence: binding_event.sequence,
            event: binding_event.event,
        });
        Ok(formal)
    }

    pub fn snapshot(&self, target: &RuntimeTarget) -> Result<RuntimeSnapshot, String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .snapshot(target)
            .map_err(|error| format!("Runtime snapshot rejected: {error:?}"))
    }

    pub fn statuses(&self) -> Result<Vec<RuntimeStatus>, String> {
        Ok(self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .statuses())
    }

    pub async fn respond_extension_ui(
        &self,
        target: &RuntimeTarget,
        response: Value,
    ) -> Result<(), String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Extension UI response rejected: {error:?}"))?;
        if response.get("type").and_then(Value::as_str) != Some("extension_ui_response") {
            return Err("Expected extension_ui_response".into());
        }
        let bridge = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&target.instance_id)
            .map(|runtime| runtime.bridge.clone())
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        let response_id = response
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        bridge
            .send_frame(response)
            .await
            .map_err(|error| format!("Cannot send extension UI response: {error:?}"))?;
        if let Some(response_id) = response_id {
            let mut pending = self
                .inner
                .pending_ui
                .lock()
                .map_err(|_| "Pending extension UI lock poisoned".to_string())?;
            if let Some(events) = pending.get_mut(&target.instance_id) {
                events.retain(|event| {
                    event.event.get("id").and_then(Value::as_str) != Some(response_id.as_str())
                });
            }
        }
        Ok(())
    }
}

fn is_mutation(command_type: &str) -> bool {
    matches!(
        command_type,
        "prompt"
            | "steer"
            | "follow_up"
            | "compact"
            | "bash"
            | "fork"
            | "clone"
            | "navigate_tree"
            | "set_model"
            | "set_thinking_level"
            | "set_auto_compaction"
            | "set_auto_retry"
            | "set_steering_mode"
            | "set_follow_up_mode"
    )
}

#[cfg(test)]
mod tests {
    use super::{NativeLaunchSpec, NativePiManager};
    use crate::runtime_coordinator::RuntimeTarget;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn launch_spec_has_no_tcp_port_and_resumes_only_at_process_start() {
        let spec = NativeLaunchSpec {
            binary: PathBuf::from("/embedded/pi"),
            cwd: PathBuf::from("/workspace"),
            session_path: Some(PathBuf::from("/sessions/a.jsonl")),
            extensions: vec![PathBuf::from("/extensions/picot-bridge.mjs")],
            pi_version: env!("PI_STUDIO_PI_VERSION_BUNDLED").into(),
            path_env: "/usr/bin".into(),
            environment: BTreeMap::from([("PI_CODING_AGENT_DIR".into(), "/isolated/agent".into())]),
        };
        let launch = spec.command_description();
        assert_eq!(launch.program, PathBuf::from("/embedded/pi"));
        assert!(launch.args.windows(2).any(|pair| pair == ["--mode", "rpc"]));
        assert!(launch
            .args
            .windows(2)
            .any(|pair| pair == ["--session", "/sessions/a.jsonl"]));
        assert!(!launch.environment.contains_key("PI_STUDIO_PORT"));
        assert_eq!(launch.environment["PI_CODING_AGENT_DIR"], "/isolated/agent");
        assert!(!launch
            .args
            .iter()
            .any(|argument| argument.parse::<u16>().is_ok()));
    }

    #[tokio::test]
    async fn reaps_abandoned_temporary_runtimes_after_grace() {
        let manager = NativePiManager::in_memory(8);
        let temp = RuntimeTarget::new("ws-1", "temporary-abc", "inst-temp");
        manager.register_in_memory(temp.clone()).unwrap();
        let real = RuntimeTarget::new("ws-1", "real-session", "inst-real");
        manager.register_in_memory(real.clone()).unwrap();

        // A brand-new temporary runtime stays alive (within the grace period).
        assert_eq!(
            manager.reap_stale_temporary_runtimes(Duration::from_secs(15 * 60)),
            0
        );

        // After the grace period, the abandoned temporary runtime is reaped
        // while the permanent session runtime is untouched.
        manager.backdate_runtime("inst-temp", Instant::now() - Duration::from_secs(60 * 60));
        assert_eq!(
            manager.reap_stale_temporary_runtimes(Duration::from_secs(15 * 60)),
            1
        );
        assert!(manager
            .target_for_session("ws-1", "temporary-abc")
            .is_none());
        assert!(manager.target_for_session("ws-1", "real-session").is_some());
    }

    #[tokio::test]
    async fn routes_native_requests_by_opaque_target_and_rejects_session_replacement() {
        let manager = NativePiManager::in_memory(8);
        let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
        let mut events = manager.subscribe();
        let mut fake = manager.register_in_memory(target.clone()).unwrap();

        fake.write_frame(json!({ "type": "agent_start" }))
            .await
            .unwrap();
        let event = events.recv().await.unwrap();
        assert_eq!(event.target, target);
        assert_eq!(event.sequence, 1);
        assert_eq!(event.event["type"], "agent_start");

        let request = tokio::spawn({
            let manager = manager.clone();
            let target = target.clone();
            async move {
                manager
                    .request(
                        &target,
                        json!({ "type": "get_state" }),
                        None,
                        Duration::from_secs(1),
                    )
                    .await
            }
        });
        let outbound = fake.read_request().await.unwrap();
        let id = outbound["id"].as_str().unwrap();
        fake.write_frame(json!({
            "id": id,
            "type": "response",
            "command": "get_state",
            "success": true
        }))
        .await
        .unwrap();
        assert!(request.await.unwrap().unwrap()["success"]
            .as_bool()
            .unwrap());

        let first_prompt = tokio::spawn({
            let manager = manager.clone();
            let target = target.clone();
            async move {
                manager
                    .request(
                        &target,
                        json!({ "type": "prompt", "message": "once" }),
                        Some("prompt-intent"),
                        Duration::from_secs(1),
                    )
                    .await
            }
        });
        let outbound = fake.read_request().await.unwrap();
        let id = outbound["id"].as_str().unwrap();
        fake.write_frame(json!({
            "id": id,
            "type": "response",
            "command": "prompt",
            "success": true
        }))
        .await
        .unwrap();
        let accepted = first_prompt.await.unwrap().unwrap();
        let duplicate = manager
            .request(
                &target,
                json!({ "type": "prompt", "message": "once" }),
                Some("prompt-intent"),
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        assert_eq!(duplicate, accepted);
        assert!(fake.try_read_request().is_none());

        assert!(manager
            .request(
                &target,
                json!({ "type": "switch_session", "sessionPath": "/other.jsonl" }),
                Some("intent-1"),
                Duration::from_secs(1),
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn binds_a_temporary_session_once_and_routes_future_events_to_the_formal_target() {
        let manager = NativePiManager::in_memory(8);
        let temporary = RuntimeTarget::new("workspace-a", "temporary-a", "instance-a");
        let mut events = manager.subscribe();
        let mut fake = manager.register_in_memory(temporary.clone()).unwrap();

        let formal = manager.bind_session_id(&temporary, "session-a").unwrap();
        let binding = events.recv().await.unwrap();
        assert_eq!(binding.target, temporary);
        assert_eq!(binding.event["type"], "session_bound");
        assert_eq!(binding.event["sessionId"], "session-a");
        assert_eq!(formal.instance_id, "instance-a");

        fake.write_frame(json!({ "type": "agent_start" }))
            .await
            .unwrap();
        let event = events.recv().await.unwrap();
        assert_eq!(event.target, formal);
        assert_eq!(manager.target_for_session_id("session-a"), Some(formal));
    }

    #[tokio::test]
    async fn respawn_without_launch_spec_reports_a_clear_error() {
        let manager = NativePiManager::in_memory(8);
        let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
        manager.register_in_memory(target.clone()).unwrap();

        let error = manager.respawn(&target).unwrap_err();
        assert!(error.contains("no launch spec"), "{error}");
        // The dead runtime is removed even when respawn cannot rebuild it, so a
        // follow-up request fails with a deterministic "not running" error
        // instead of hanging on a broken bridge.
        assert!(manager
            .request(
                &target,
                json!({ "type": "get_state" }),
                None,
                Duration::from_secs(1),
            )
            .await
            .is_err_and(|error| error.contains("not running")));
    }
}
