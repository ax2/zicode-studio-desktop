use super::*;

pub(super) async fn handle_websocket(
    mut socket: WebSocket,
    state: Arc<HostState>,
    peer_ip: IpAddr,
    require_remote_auth: bool,
) {
    let Some(Some(Ok(Message::Text(first)))) = state.lifecycle.until_stopped(socket.next()).await
    else {
        return;
    };
    let hello = match serde_json::from_str::<Value>(&first) {
        Ok(frame) => frame,
        Err(_) => {
            let _ = send_error(&mut socket, None, "invalid_json", "Invalid JSON frame").await;
            return;
        }
    };
    if !hello
        .get("clientId")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.len() <= 128)
    {
        let _ = send_error(
            &mut socket,
            None,
            "invalid_client_id",
            "clientId is required and must be at most 128 bytes",
        )
        .await;
        return;
    }
    // A client-supplied ID can be reused on reconnect or by another device.
    // Keep routing and dialog ownership tied to this socket instead.
    let client_id = uuid::Uuid::new_v4().to_string();
    let client_type = hello.get("clientType").and_then(Value::as_str);
    let remote_device_token = (client_type == Some("remote"))
        .then(|| {
            hello
                .get("deviceToken")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten();
    if (!peer_ip.is_loopback() || require_remote_auth) && client_type != Some("remote") {
        let _ = send_error(
            &mut socket,
            None,
            "remote_auth_required",
            "Remote clients must authenticate as remote devices",
        )
        .await;
        return;
    }
    if client_type == Some("desktop")
        && hello.get("desktopToken").and_then(Value::as_str) != Some(state.desktop_token.as_str())
    {
        let _ = send_error(
            &mut socket,
            None,
            "desktop_auth_required",
            "Desktop window credential rejected",
        )
        .await;
        return;
    }
    if client_type == Some("remote") {
        let authorized = remote_device_token
            .as_deref()
            .and_then(|token| state.auth.lock().ok()?.authorize(token).ok())
            .unwrap_or(false);
        if !authorized {
            let _ = send_error(
                &mut socket,
                None,
                "unauthorized_device",
                "Device token rejected",
            )
            .await;
            return;
        }
    }
    let handshake = state
        .router
        .lock()
        .map_err(|_| "Host router unavailable".to_string())
        .and_then(|mut router| {
            router
                .connect(&client_id, &hello)
                .map_err(|error| error.message)
        });
    if let Err(message) = handshake {
        let _ = send_error(&mut socket, None, "handshake_rejected", &message).await;
        return;
    }
    if !matches!(
        state
            .lifecycle
            .until_stopped(
                socket.send(Message::Text(
                    json!({ "type": "hello_ack", "protocolVersion": PROTOCOL_VERSION })
                        .to_string()
                        .into(),
                ))
            )
            .await,
        Some(Ok(()))
    ) {
        if let Ok(mut router) = state.router.lock() {
            router.disconnect(&client_id);
        }
        return;
    }

    let mut runtime_events = state.runtimes.subscribe();
    let mut subscriptions = HashSet::new();
    let mut remote_auth_check = tokio::time::interval(Duration::from_secs(5));
    remote_auth_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // M2 P2P session state: the answerer peer, its outbound signaling frames,
    // and DataChannel messages (routed back into the runtime pipeline).
    let mut p2p_answerer: Option<Arc<crate::p2p::P2pAnswerer>> = None;
    let mut p2p_signals: Option<mpsc::UnboundedReceiver<Value>> = None;
    let mut p2p_inbound: Option<mpsc::UnboundedReceiver<Value>> = None;
    let mut p2p_forwarder: Option<tokio::task::JoinHandle<()>> = None;
    state.lifecycle.until_stopped(async {
    loop {
        tokio::select! {
            _ = remote_auth_check.tick(), if remote_device_token.is_some() => {
                let authorized = remote_device_token
                    .as_deref()
                    .and_then(|token| state.auth.lock().ok()?.authorize(token).ok())
                    .unwrap_or(false);
                if !authorized {
                    let _ = send_error(
                        &mut socket,
                        None,
                        "device_access_revoked",
                        "This device no longer has access",
                    )
                    .await;
                    break;
                }
            }
            incoming = socket.next() => {
                let Some(Ok(message)) = incoming else { break };
                let Message::Text(text) = message else {
                    if matches!(message, Message::Close(_)) { break; }
                    continue;
                };
                let frame = match serde_json::from_str::<Value>(&text) {
                    Ok(frame) => frame,
                    Err(_) => {
                        let _ = send_error(&mut socket, None, "invalid_json", "Invalid JSON frame").await;
                        continue;
                    }
                };
                if crate::p2p::is_p2p_signal(&frame) {
                    if frame.get("type").and_then(Value::as_str) == Some("p2p_offer") {
                        if let Some(previous) = &p2p_answerer { previous.close().await; }
                        if let Some(forwarder) = p2p_forwarder.take() { forwarder.abort(); let _ = forwarder.await; }
                        match crate::p2p::P2pAnswerer::new() {
                            Ok((answerer, handle)) => {
                                let answerer = Arc::new(answerer);
                                let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();
                                let mut messages = handle.messages;
                                p2p_forwarder = Some(state.lifecycle.spawn(async move {
                                    while let Some(bytes) = messages.recv().await {
                                        if let Ok(frame) = serde_json::from_slice::<Value>(&bytes) {
                                            if inbound_tx.send(frame).is_err() {
                                                break;
                                            }
                                        }
                                    }
                                }));
                                p2p_answerer = Some(answerer.clone());
                                p2p_signals = Some(handle.signals);
                                p2p_inbound = Some(inbound_rx);
                                if let Err(error) = answerer.handle_signal(frame).await {
                                    answerer.close().await;
                                    let _ = send_error(&mut socket, None, "p2p_signal_failed", &error)
                                        .await;
                                }
                            }
                            Err(error) => {
                                let _ =
                                    send_error(&mut socket, None, "p2p_unavailable", &error).await;
                            }
                        }
                    } else if let Some(answerer) = &p2p_answerer {
                        if let Err(error) = answerer.handle_signal(frame).await {
                            let _ =
                                send_error(&mut socket, None, "p2p_signal_failed", &error).await;
                        }
                    }
                    continue;
                }
                if process_runtime_frame(
                    &state,
                    &client_id,
                    &mut subscriptions,
                    frame,
                    &mut socket,
                    &p2p_answerer,
                )
                .await
                .is_err()
                {
                    break;
                }
            }
            signal = async {
                match p2p_signals.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => futures_util::future::pending().await,
                }
            } => {
                if let Some(signal) = signal {
                    if socket.send(Message::Text(signal.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
            message = async {
                match p2p_inbound.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => futures_util::future::pending().await,
                }
            } => {
                if let Some(frame) = message {
                    if process_runtime_frame(
                        &state,
                        &client_id,
                        &mut subscriptions,
                        frame,
                        &mut socket,
                        &p2p_answerer,
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
            }
            event = runtime_events.recv() => {
                match event {
                    Ok(event) if subscriptions.contains(&event.target) => {
                        if extension_ui_requires_owner(&event.event) {
                            let is_owner = state
                                .session_owners
                                .lock()
                                .ok()
                                .and_then(|owners| owners.get(&event.target).cloned())
                                .as_deref()
                                == Some(client_id.as_str());
                            if !is_owner { continue; }
                        }
                        let outgoing = runtime_event_frame(event);
                        if !send_runtime_frame(&mut socket, &p2p_answerer, &outgoing).await {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let outgoing = structured_error(
                            None,
                            "event_sequence_gap",
                            "Runtime events were missed; request a snapshot",
                        );
                        if !send_runtime_frame(&mut socket, &p2p_answerer, &outgoing).await {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    }).await;
    if let Some(forwarder) = p2p_forwarder {
        forwarder.abort();
        let _ = forwarder.await;
    }
    if let Some(answerer) = p2p_answerer {
        answerer.close().await;
    }
    if let Ok(mut owners) = state.session_owners.lock() {
        owners.retain(|_, owner| owner != &client_id);
    }
    if let Ok(mut router) = state.router.lock() {
        router.disconnect(&client_id);
    }
}
