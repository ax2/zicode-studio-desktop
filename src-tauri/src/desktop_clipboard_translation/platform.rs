use super::Request;
use crate::model_tools::ModelEndpoint;
use crate::settings_store::{SettingScope, SettingsStore};
use crate::translation::{TranslationRequest, TranslationResult};
use crate::{HostServer, NativePiManagerState, RuntimeTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;

#[path = "windows.rs"]
mod windows;

pub(crate) const POPUP_LABEL: &str = "clipboard-translation-popup";
const POPUP_PAGE: &str = "/translation-popup.html";
const CHANGED: &str = "studio-clipboard-translation-changed";
const HANDOFF: &str = "studio-clipboard-translation-handoff";
const KEY: &str = "approval";
const UNAVAILABLE: &str = "Clipboard translation is unavailable";
const CHOOSE_MODEL: &str = "Choose a service for clipboard translation in Studio";
const LANGUAGES: &[&str] = &[
    "English",
    "Chinese",
    "Japanese",
    "Korean",
    "French",
    "German",
    "Spanish",
    "Russian",
    "Portuguese",
    "Arabic",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    workspace: String,
    scene: String,
    provider: String,
    model: String,
    identity: String,
    destination: String,
    local: bool,
    preferred: String,
    alternate: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Draft {
    text: String,
    source_lang: Option<String>,
    target_lang: String,
    result: Option<TranslationResult>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Popup {
    #[serde(skip)]
    scope: Option<(String, String)>,
    revision: u64,
    draft: Draft,
    status: &'static str,
    message: String,
}

struct Handoff {
    label: String,
    workspace: String,
    scene: String,
    draft: Draft,
}

struct State {
    approval: Option<Approval>,
    shortcut: Option<windows::Hotkey>,
    shortcut_error: Option<&'static str>,
    popup: Option<Popup>,
    cancellation: Option<CancellationToken>,
    handoff: Option<Handoff>,
    clock: u64,
}

struct ClipboardTranslation {
    state: Mutex<State>,
    settings: SettingsStore,
}

pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    let settings = SettingsStore::new(
        crate::app_paths::system_root()?.join("desktop-clipboard-translation.json"),
        PathBuf::new(),
        false,
    );
    let approval: Option<Approval> =
        serde_json::from_value(settings.effective(KEY, Value::Null)?.value)
            .map_err(|_| "Clipboard translation settings are invalid")?;
    let handle = app.clone();
    let hotkey = windows::Hotkey::register(move || {
        let clipboard = windows::read_text();
        let callback = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Err(error) = open(&callback, clipboard) {
                log::warn!("[clipboard-translation] {error}");
            }
        });
    });
    let (shortcut, shortcut_error) = match hotkey {
        Ok(shortcut) => (Some(shortcut), None),
        Err(error) => (None, Some(error)),
    };
    app.manage(ClipboardTranslation {
        state: Mutex::new(State {
            approval,
            shortcut,
            shortcut_error,
            popup: None,
            cancellation: None,
            handoff: None,
            clock: 0,
        }),
        settings,
    });
    Ok(())
}

pub(crate) fn shutdown(app: &AppHandle) {
    if let Some(data) = app.try_state::<ClipboardTranslation>() {
        if let Ok(mut state) = data.state.lock() {
            state.cancel();
            state.shortcut = None;
            state.popup = None;
            state.handoff = None;
        }
    }
}

pub(crate) fn destroyed(app: &AppHandle) {
    if let Some(data) = app.try_state::<ClipboardTranslation>() {
        if let Ok(mut state) = data.state.lock() {
            state.cancel();
            state.popup = None;
        }
    }
}

impl State {
    fn cancel(&mut self) {
        if let Some(token) = self.cancellation.take() {
            token.cancel();
        }
    }

    fn next_revision(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn settings(&self) -> Value {
        json!({"approval": self.approval, "shortcutError": self.shortcut_error})
    }
}

fn valid_language(language: &str) -> bool {
    LANGUAGES.contains(&language)
}

fn source_language(text: &str) -> Option<&'static str> {
    let sample: String = text.chars().take(2_048).collect();
    let count = sample
        .chars()
        .filter(|character| character.is_alphabetic())
        .count();
    if count < 8 {
        return None;
    }
    let han = sample
        .chars()
        .filter(|character| matches!(*character, '\u{3400}'..='\u{9fff}'))
        .count();
    let ascii = sample.chars().filter(char::is_ascii_alphabetic).count();
    if han >= 4 && ascii >= 12 && han.min(ascii) * 8 >= count {
        return None;
    }
    let info = whatlang::detect(&sample)?;
    if !info.is_reliable() {
        return None;
    }
    match info.lang().code() {
        "eng" => Some("English"),
        "cmn" => Some("Chinese"),
        "jpn" => Some("Japanese"),
        "kor" => Some("Korean"),
        "fra" => Some("French"),
        "deu" => Some("German"),
        "spa" => Some("Spanish"),
        "rus" => Some("Russian"),
        "por" => Some("Portuguese"),
        "ara" => Some("Arabic"),
        _ => None,
    }
}

fn is_popup(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == POPUP_PAGE
        && url.query().is_none()
        && url.fragment().is_none()
}

fn workspace_scope(window: &WebviewWindow) -> Result<RuntimeTarget, String> {
    crate::require_workspace_window(window)?;
    let url = window.url().map_err(|_| UNAVAILABLE)?;
    let (workspace, session) = crate::desktop_tools::route_identity(url.path())?;
    let manager = window
        .try_state::<NativePiManagerState>()
        .ok_or(UNAVAILABLE)?;
    manager
        .statuses()?
        .into_iter()
        .find_map(|status| {
            let target = status.target;
            (target.workspace_id == workspace && target.session_id == session).then_some(target)
        })
        .ok_or_else(|| "Open a Studio workspace to configure clipboard translation".into())
}

fn resolve(
    app: &AppHandle,
    scene: &str,
    provider: &str,
    model: &str,
) -> Result<ModelEndpoint, String> {
    app.try_state::<HostServer>()
        .ok_or(UNAVAILABLE)?
        .clipboard_translation_model(scene, provider, model)
}

fn switch_approval(
    data: &ClipboardTranslation,
    approval: Option<Approval>,
) -> Result<Value, String> {
    let mut state = data.state.lock().map_err(|_| UNAVAILABLE)?;
    data.settings
        .merge(SettingScope::Global, &json!({(KEY): approval}))?;
    state.cancel();
    state.approval = approval;
    if let Some(popup) = state.popup.as_mut() {
        if popup.status == "running" {
            popup.status = "ready";
            popup.message = "Clipboard translation settings changed. Try again.".into();
        }
    }
    Ok(state.settings())
}

fn open(app: &AppHandle, clipboard: Result<String, &'static str>) -> Result<(), String> {
    let data = app.try_state::<ClipboardTranslation>().ok_or(UNAVAILABLE)?;
    let automatic = {
        let mut state = data.state.lock().map_err(|_| UNAVAILABLE)?;
        state.cancel();
        let mut popup = Popup {
            scope: state
                .approval
                .as_ref()
                .map(|approval| (approval.workspace.clone(), approval.scene.clone())),
            revision: state.next_revision(),
            draft: Draft::default(),
            status: "ready",
            message: String::new(),
        };
        if let Ok(text) = clipboard {
            let source = source_language(&text);
            let (preferred, alternate) = state
                .approval
                .as_ref()
                .map(|approval| (approval.preferred.as_str(), approval.alternate.as_str()))
                .unwrap_or(("Chinese", "English"));
            popup.draft = Draft {
                text,
                source_lang: source.map(str::to_string),
                target_lang: if source == Some(preferred) {
                    alternate
                } else {
                    preferred
                }
                .into(),
                result: None,
            };
            if state.approval.is_none() {
                popup.message = CHOOSE_MODEL.into();
            } else if source.is_none() {
                popup.message = "Choose the languages and try again".into();
            }
        } else if let Err(error) = clipboard {
            popup.status = "empty";
            popup.message = error.into();
        }
        let automatic = (popup.status == "ready" && popup.message.is_empty()).then(|| {
            (
                popup.revision,
                popup.draft.source_lang.clone(),
                popup.draft.target_lang.clone(),
            )
        });
        state.popup = Some(popup);
        automatic
    };

    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|_| UNAVAILABLE)?;
    } else {
        WebviewWindowBuilder::new(
            app,
            POPUP_LABEL,
            WebviewUrl::App(POPUP_PAGE.trim_start_matches('/').into()),
        )
        .data_directory(crate::app_paths::webview_root()?)
        .title(if crate::desktop_tray::translation_locale(app) == "en" {
            "ZiCode Studio · Clipboard translation"
        } else {
            "ZiCode Studio · 剪贴板翻译"
        })
        .inner_size(440.0, 560.0)
        .min_inner_size(340.0, 360.0)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .on_navigation(is_popup)
        .build()
        .map_err(|_| UNAVAILABLE)?;
    }
    let _ = app.emit_to(POPUP_LABEL, CHANGED, ());
    if let Some((revision, source, target)) = automatic {
        start(app, revision, source, target)?;
    }
    Ok(())
}

fn start(
    app: &AppHandle,
    expected: u64,
    source: Option<String>,
    target: String,
) -> Result<(), String> {
    if !valid_language(&target)
        || source
            .as_deref()
            .is_some_and(|value| !valid_language(value) || value == target)
    {
        return Err("Choose different source and target languages".into());
    }
    let data = app.try_state::<ClipboardTranslation>().ok_or(UNAVAILABLE)?;
    let (approval, text, revision, cancellation) = {
        let mut state = data.state.lock().map_err(|_| UNAVAILABLE)?;
        let approval = state.approval.clone().ok_or(CHOOSE_MODEL)?;
        let popup = state
            .popup
            .as_ref()
            .filter(|popup| popup.revision == expected && !popup.draft.text.is_empty())
            .ok_or("Clipboard translation is no longer current")?;
        let scope = (approval.workspace.clone(), approval.scene.clone());
        if popup
            .scope
            .as_ref()
            .is_some_and(|previous| previous != &scope)
        {
            return Err(
                "Press the translation shortcut again for the newly approved workspace".into(),
            );
        }
        let text = popup.draft.text.clone();
        state.cancel();
        let revision = state.next_revision();
        let cancellation = CancellationToken::new();
        state.cancellation = Some(cancellation.clone());
        state.popup = Some(Popup {
            scope: Some(scope),
            revision,
            draft: Draft {
                text: text.clone(),
                source_lang: source.clone(),
                target_lang: target.clone(),
                result: None,
            },
            status: "running",
            message: String::new(),
        });
        (approval, text, revision, cancellation)
    };
    let _ = app.emit_to(POPUP_LABEL, CHANGED, ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = translate(
            &app,
            &approval,
            TranslationRequest {
                text,
                source_lang: source,
                target_lang: target,
            },
            cancellation.clone(),
        )
        .await;
        if let Some(data) = app.try_state::<ClipboardTranslation>() {
            if let Ok(mut state) = data.state.lock() {
                if cancellation.is_cancelled()
                    || state
                        .popup
                        .as_ref()
                        .is_none_or(|popup| popup.revision != revision)
                {
                    return;
                }
                let fresh = state.next_revision();
                if let Some(popup) = state.popup.as_mut() {
                    popup.revision = fresh;
                    match result {
                        Ok(result) => {
                            popup.status = "done";
                            popup.draft.result = Some(result);
                        }
                        Err(error) => {
                            popup.status = "ready";
                            popup.message = error;
                        }
                    }
                }
                state.cancellation = None;
            }
        }
        let _ = app.emit_to(POPUP_LABEL, CHANGED, ());
    });
    Ok(())
}

async fn translate(
    app: &AppHandle,
    approval: &Approval,
    request: TranslationRequest,
    cancellation: CancellationToken,
) -> Result<TranslationResult, String> {
    let endpoint =
        resolve(app, &approval.scene, &approval.provider, &approval.model).map_err(|error| {
            match error.as_str() {
                "model_selection_unavailable" | "model_selection_ambiguous" => CHOOSE_MODEL.into(),
                _ => error,
            }
        })?;
    if endpoint.request_identity() != approval.identity {
        return Err("The approved translation service changed. Approve it again in Studio.".into());
    }
    let key = if endpoint.choice.requires_key {
        crate::credential_broker::model_tool_credential(&approval.scene, &approval.provider)?
    } else {
        None
    };
    crate::translation::validate(
        &request.text,
        &request.target_lang,
        request.source_lang.as_deref(),
    )?;
    let prompt = crate::translation::build_prompt(
        &request.text,
        request.source_lang.as_deref(),
        &request.target_lang,
    );
    let payload = crate::model_tools::complete_limited_cancellable(
        &endpoint,
        key.as_deref(),
        prompt,
        Duration::from_secs(60),
        16_384,
        cancellation,
    )
    .await
    .map_err(|error| -> String {
        match error.as_str() {
            "model_credential_unavailable" => {
                "Configure the translation service credentials in Studio".into()
            }
            "model_request_unavailable" => {
                "Could not reach the translation service. Try again.".into()
            }
            _ if error.starts_with("model_request_failed:") => {
                "The translation service rejected the request. Try again.".into()
            }
            _ => "The translation service did not return a usable result".into(),
        }
    })?;
    if payload
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
        == Some("length")
    {
        return Err(
            "The translation reached the service output limit. Split the text and try again."
                .into(),
        );
    }
    crate::translation::result_from_payload(&request, &endpoint, &payload)
}

fn transfer(
    popup: &WebviewWindow,
    data: &ClipboardTranslation,
    expected: u64,
) -> Result<(), String> {
    let app = popup.app_handle();
    let mut state = data.state.lock().map_err(|_| UNAVAILABLE)?;
    let snapshot = state
        .popup
        .as_ref()
        .filter(|snapshot| snapshot.revision == expected)
        .ok_or("Clipboard translation is no longer current")?;
    let draft = snapshot.draft.clone();
    let approved_scope = snapshot.scope.clone();
    let mut windows = app.webview_windows().into_iter().collect::<Vec<_>>();
    windows.sort_by(|a, b| a.0.cmp(&b.0));
    let (window, scope) = windows
        .into_iter()
        .find_map(|(_, window)| {
            let scope = workspace_scope(&window).ok()?;
            approved_scope
                .as_ref()
                .is_none_or(|(workspace, scene)| {
                    *workspace == scope.workspace_id && *scene == scope.scene_id
                })
                .then_some((window, scope))
        })
        .ok_or("Open the matching Studio workspace to receive the translation")?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|_| UNAVAILABLE)?;
    state.handoff = Some(Handoff {
        label: window.label().into(),
        workspace: scope.workspace_id,
        scene: scope.scene_id,
        draft,
    });
    if let Err(error) = app.emit_to(window.label(), HANDOFF, ()) {
        state.handoff = None;
        return Err(error.to_string());
    }
    drop(state);
    popup.close().map_err(|_| UNAVAILABLE.into())
}

pub(super) fn command(window: WebviewWindow, request: Request) -> Result<Value, String> {
    let app = window.app_handle();
    let data = app.try_state::<ClipboardTranslation>().ok_or(UNAVAILABLE)?;
    match request {
        Request::Snapshot | Request::Retry { .. } | Request::Workbench { .. } | Request::Close => {
            if window.label() != POPUP_LABEL || !window.url().is_ok_and(|url| is_popup(&url)) {
                return Err(UNAVAILABLE.into());
            }
            match request {
                Request::Snapshot => {
                    let value = {
                        let state = data.state.lock().map_err(|_| UNAVAILABLE)?;
                        json!({"popup": state.popup, "languages": LANGUAGES, "locale": crate::desktop_tray::translation_locale(app), "service": state.approval.as_ref().map(|approval| {
                            json!({"destination": approval.destination, "local": approval.local})
                        })})
                    };
                    if !window.is_visible().unwrap_or(false) {
                        window
                            .show()
                            .and_then(|_| window.set_focus())
                            .map_err(|_| UNAVAILABLE)?;
                    }
                    Ok(value)
                }
                Request::Retry {
                    revision,
                    source,
                    target,
                } => {
                    start(app, revision, source, target)?;
                    Ok(Value::Null)
                }
                Request::Close => {
                    window.close().map_err(|_| UNAVAILABLE)?;
                    Ok(Value::Null)
                }
                Request::Workbench { revision } => {
                    // Closing and showing windows must be coordinated on the UI thread.
                    let popup = window.clone();
                    let handle = app.clone();
                    let (send, recv) = std::sync::mpsc::sync_channel(1);
                    app.run_on_main_thread(move || {
                        let result = handle
                            .try_state::<ClipboardTranslation>()
                            .ok_or_else(|| UNAVAILABLE.into())
                            .and_then(|data| transfer(&popup, &data, revision));
                        let _ = send.send(result);
                    })
                    .map_err(|_| UNAVAILABLE)?;
                    recv.recv_timeout(Duration::from_secs(2))
                        .map_err(|_| UNAVAILABLE)??;
                    Ok(Value::Null)
                }
                _ => unreachable!(),
            }
        }
        Request::Settings => {
            crate::require_workspace_window(&window)?;
            Ok(data.state.lock().map_err(|_| UNAVAILABLE)?.settings())
        }
        Request::Preview { provider, model } => {
            let scope = workspace_scope(&window)?;
            let endpoint = resolve(app, &scope.scene_id, &provider, &model)?;
            Ok(
                json!({"identity": endpoint.request_identity(), "destination": endpoint.choice.endpoint, "local": endpoint.is_loopback()}),
            )
        }
        Request::Enable {
            provider,
            model,
            identity,
            preferred,
            alternate,
        } => {
            let scope = workspace_scope(&window)?;
            if !valid_language(&preferred) || !valid_language(&alternate) || preferred == alternate
            {
                return Err("Choose two different preferred languages".into());
            }
            let endpoint = resolve(app, &scope.scene_id, &provider, &model)?;
            if endpoint.request_identity() != identity {
                return Err(
                    "The approved translation service changed. Approve it again in Studio.".into(),
                );
            }
            let local = endpoint.is_loopback();
            let value = switch_approval(
                &data,
                Some(Approval {
                    workspace: scope.workspace_id,
                    scene: scope.scene_id,
                    provider,
                    model,
                    identity,
                    destination: endpoint.choice.endpoint,
                    local,
                    preferred,
                    alternate,
                }),
            )?;
            let _ = app.emit_to(POPUP_LABEL, CHANGED, ());
            Ok(value)
        }
        Request::Disable => {
            crate::require_workspace_window(&window)?;
            let value = switch_approval(&data, None)?;
            let _ = app.emit_to(POPUP_LABEL, CHANGED, ());
            Ok(value)
        }
        Request::TakeHandoff => {
            let scope = workspace_scope(&window)?;
            let mut state = data.state.lock().map_err(|_| UNAVAILABLE)?;
            if state.handoff.as_ref().is_some_and(|handoff| {
                handoff.label == window.label()
                    && handoff.workspace == scope.workspace_id
                    && handoff.scene == scope.scene_id
            }) {
                return Ok(json!(state.handoff.take().map(|handoff| handoff.draft)));
            }
            Ok(Value::Null)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_popup, source_language};

    #[test]
    fn only_allows_the_bundled_popup_document() {
        for url in [
            "http://tauri.localhost:31415/translation-popup.html",
            "http://user@tauri.localhost/translation-popup.html",
            "http://tauri.localhost/index.html",
            "http://127.0.0.1/translation-popup.html",
            "http://tauri.localhost/translation-popup.html?source=other",
        ] {
            assert!(!is_popup(&reqwest::Url::parse(url).unwrap()), "{url}");
        }
        assert!(is_popup(
            &reqwest::Url::parse("http://tauri.localhost/translation-popup.html").unwrap()
        ));
    }

    #[test]
    fn identifies_reliable_samples_and_leaves_ambiguous_samples_for_the_picker() {
        assert_eq!(
            source_language(
                "I am testing a Windows application that translates text from the clipboard."
            ),
            Some("English")
        );
        assert_eq!(
            source_language(
                "这是一段用来测试翻译功能的中文文字，我们需要检查源语言和目标语言的选择是否正确。"
            ),
            Some("Chinese")
        );
        assert_eq!(source_language("OK"), None);
        assert_eq!(
            source_language(
                "今天测试 Windows clipboard translation and everything is working 非常顺利"
            ),
            None
        );
    }
}
