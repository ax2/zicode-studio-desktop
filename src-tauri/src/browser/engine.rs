//! Native browser adapter. Must stay on the native UI thread.
//! Wry children are intentionally NOT registered as Tauri webviews. No IPC,
//! initialization scripts, local protocols or Studio token are installed.
use super::policy::BrowserPolicy;
#[path = "event_lifetime.rs"]
mod event_lifetime;
#[path = "native_view.rs"]
mod native_view;
#[path = "native_favicon.rs"]
mod native_favicon;
#[path = "native_page_controls.rs"]
pub(super) mod page_controls;
#[path = "native_shortcuts.rs"]
mod native_shortcuts;
#[path = "native_popups.rs"]
mod native_popups;
#[path = "native_context_menu.rs"]
mod native_context_menu;
#[path = "native_downloads.rs"]
pub(super) mod native_downloads;
use native_view::{Container, NativeView};
use raw_window_handle::HasWindowHandle;
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use wry::WebViewBuilderExtWindows;
use wry::{
    dpi::{LogicalPosition, LogicalSize},
    Rect, WebContext, WebView, WebViewBuilder, WebViewExtWindows,
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum EngineEvent {
    HistoryChanged { tab: String, history: super::windows_policy::HistoryState },
    Favicon { tab: String, image: Option<String> },
    ContextAction { tab: String, action: String },
    ContextMenuReady {
        tab: String,
        actions: Vec<String>,
        #[serde(rename = "disabledActions")]
        disabled_actions: Vec<String>,
        #[serde(rename = "menuId")]
        menu_id: i32,
        label: String,
    },
    Shortcut { tab: String, action: String },
    Visited {
        tab: String,
        url: String,
        title: String,
        #[serde(rename = "sameDocument")]
        same_document: bool,
    },
    Title {
        tab: String,
        title: String,
    },
    Loading {
        tab: String,
        url: String,
        finished: bool,
    },
    Popup {
        tab: String,
        url: String,
        #[serde(rename = "userInitiated")]
        user_initiated: bool,
        allowed: bool,
        background: bool,
    },
    DownloadChanged { download: native_downloads::Record },
    NavigationBlocked {
        tab: String,
    },
    NativeDownloadBlocked {
        tab: String,
    },
    PermissionBlocked {
        tab: String,
        permission_kind: i32,
    },
    NavigationStarted {
        tab: String,
    },
    NavigationFinished {
        tab: String,
        success: bool,
        canceled: bool,
    },
}

#[derive(Clone, Copy)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Bounds {
    fn rect(self) -> Result<Rect, String> {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.x + self.width > 32768.0
            || self.y + self.height > 32768.0
        {
            return Err("Invalid browser bounds".into());
        }
        Ok(Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: LogicalSize::new(self.width, self.height).into(),
        })
    }
}

pub struct NativeBrowserEngine {
    // Drop native views before their shared browser context.
    pub menu_chinese: Arc<std::sync::atomic::AtomicBool>,
    pub downloads: std::rc::Rc<native_downloads::Downloads>,
    menu_cache: std::rc::Rc<std::cell::RefCell<native_context_menu::MenuCache>>,
    views: HashMap<String, NativeView>,
    documents: HashMap<String, (String, Arc<std::sync::atomic::AtomicU64>)>,
    context: WebContext,
    policy: BrowserPolicy,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
}
impl NativeBrowserEngine {
    pub fn new(
        profile: PathBuf,
        policy: BrowserPolicy,
        emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
        Ok(Self {
            menu_chinese: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            downloads: native_downloads::Downloads::new(emit.clone()),
            menu_cache: Default::default(),
            views: HashMap::new(),
            documents: HashMap::new(),
            // Chromium storage should receive a conventional Win32 path, not
            // Rust canonicalize's verbatim prefix (the owner check may use it).
            context: WebContext::new(Some(dunce::simplified(&profile).to_path_buf())),
            policy,
            emit,
        })
    }
    pub fn create(
        &mut self,
        parent: &impl HasWindowHandle,
        tab: &str,
        url: &str,
        bounds: Bounds,
        zoom: f64,
        muted: bool,
    ) -> Result<(), String> {
        if uuid::Uuid::parse_str(tab).is_err() || self.views.contains_key(tab) {
            return Err("Invalid or duplicate browser tab identity".into());
        }
        if !self.policy.permits(url) {
            return Err("Browser navigation blocked".into());
        }
        let (events, tab_emit) = event_lifetime::EventLifetime::new(self.emit.clone());
        let revision = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let nav_revision = revision.clone();
        let favicon = Arc::new(native_favicon::Icon::default());
        let nav_favicon = favicon.clone();
        let nav_policy = self.policy.clone();
        let nav_emit = tab_emit.clone();
        let nav_tab = tab.to_string();
        let title_emit = tab_emit.clone();
        let title_tab = tab.to_string();
        let load_emit = tab_emit.clone();
        let load_tab = tab.to_string();
        let container = Container::new(parent)?;
        let mut initial_bounds = bounds.rect()?;
        initial_bounds.position = LogicalPosition::new(0.0, 0.0).into();
        let view = WebViewBuilder::new_with_web_context(&mut self.context)
            .with_bounds(initial_bounds)
            .with_visible(false)
            .with_focused(false)
            // Preserve SmartScreen; don't inherit Wry's app-shell disabling flag.
            .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
            .with_devtools(false)
            .with_clipboard(false)
            .with_navigation_handler(move |url| {
                let permitted = nav_policy.permits(&url);
                if permitted {
                    nav_revision.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    nav_favicon.clear();
                    nav_emit(EngineEvent::Favicon { tab: nav_tab.clone(), image: None });
                }
                if !permitted {
                    nav_emit(EngineEvent::NavigationBlocked {
                        tab: nav_tab.clone(),
                    });
                }
                permitted
            })
            .with_document_title_changed_handler(move |title| {
                title_emit(EngineEvent::Title {
                    tab: title_tab.clone(),
                    title: title.chars().take(512).collect(),
                })
            })
            .with_on_page_load_handler(move |event, url| {
                load_emit(EngineEvent::Loading {
                    tab: load_tab.clone(),
                    url,
                    finished: matches!(event, wry::PageLoadEvent::Finished),
                })
            })
            .build_as_child(&container)
            .map_err(|error| error.to_string())?;
        let view = NativeView {
            favicon,
            events,
            webview: view,
            container,
        };
        // Security handlers are installed before any network navigation.
        let download_staging = self
            .context
            .data_directory()
            .ok_or("Missing browser profile")?
            .join("download-staging");
        std::fs::create_dir_all(&download_staging).map_err(|error| error.to_string())?;
        native_favicon::install(&view.webview, tab.to_string(), view.favicon.clone(), tab_emit.clone());
        native_shortcuts::install(&view.webview, tab.to_string(), tab_emit.clone()).map_err(|error| error.to_string())?;
        native_popups::install(&view.webview, self.policy.clone(), tab.to_string(), tab_emit.clone()).map_err(|error| error.to_string())?;
        native_context_menu::install(&view.webview, self.policy.clone(), tab.to_string(), self.menu_chinese.clone(), self.menu_cache.clone(), tab_emit.clone()).map_err(|error| error.to_string())?;
        super::windows_policy::install(
            &view.webview,
            self.policy.clone(),
            &download_staging,
            tab.to_string(),
            tab_emit,
        )
        .map_err(|error| error.to_string())?;
        self.downloads.install(&view.webview, self.policy.clone(), tab.to_string()).map_err(|error| error.to_string())?;
        page_controls::set_zoom(&view.webview, zoom)?;
        page_controls::set_muted(&view.webview, muted)?;
        view.webview
            .load_url(url)
            .map_err(|error| error.to_string())?;
        self.views.insert(tab.to_string(), view);
        self.documents.insert(
            tab.to_string(),
            (uuid::Uuid::new_v4().to_string(), revision),
        );
        Ok(())
    }
    #[allow(dead_code)] // Production Host capture uses this; the separate engine probe does not.
    pub fn document_revision(&self, tab: &str) -> Result<String, String> {
        let (instance, revision) = self
            .documents
            .get(tab)
            .ok_or("Browser tab is no longer available")?;
        Ok(format!(
            "{}:{}",
            instance,
            revision.load(std::sync::atomic::Ordering::SeqCst)
        ))
    }
    #[allow(dead_code)] // Host metadata uses this; the standalone engine probe has no chrome.
    pub fn favicon(&self, tab: &str) -> Option<String> { self.views.get(tab).and_then(|view| view.favicon.image()) }
    pub fn view(&self, tab: &str) -> Result<&WebView, String> {
        self.views
            .get(tab)
            .map(|view| &view.webview)
            .ok_or_else(|| "Browser tab is no longer available".into())
    }
    pub fn activate(&self, tab: Option<&str>, bounds: Bounds, focus: bool) -> Result<(), String> {
        bounds.rect()?;
        if let Some(tab) = tab {
            self.view(tab)?;
        }
        for (id, view) in &self.views {
            if Some(id.as_str()) == tab {
                view.present(bounds, focus)?;
            } else {
                view.hide()?;
            }
        }
        Ok(())
    }
    pub fn navigate(&self, tab: &str, url: &str) -> Result<(), String> {
        if !self.policy.permits(url) {
            return Err("Browser navigation blocked".into());
        }
        self.view(tab)?
            .load_url(url)
            .map_err(|error| error.to_string())
    }
    pub fn action(&self, tab: &str, action: &str) -> Result<(), String> {
        let view = self.view(tab)?;
        if action == "selectAll" {
            // Fixed explicit browser edit action, not an arbitrary page-evaluation API.
            return view.evaluate_script("(() => { const body = document.body; const selection = getSelection(); if (!body || !selection) return; const range = document.createRange(); range.selectNodeContents(body); selection.removeAllRanges(); selection.addRange(range); })()")
                .map_err(|error| error.to_string());
        }
        // Native history, never page-supplied replacements for history methods.
        unsafe {
            let native = view.webview();
            match action {
                "back" => native.GoBack(),
                "forward" => native.GoForward(),
                "reload" => native.Reload(),
                "stop" => native.Stop(),
                _ => return Err("Unknown browser navigation action".into()),
            }
            .map_err(|error| error.to_string())
        }
    }
    pub fn destroy(&mut self, tab: &str) -> Result<(), String> {
        self.downloads.cancel_tab(tab);
        self.documents.remove(tab);
        self.views
            .remove(tab)
            .ok_or_else(|| "Browser tab is no longer available".to_string())?;
        Ok(())
    }
}

impl Drop for NativeBrowserEngine {
    fn drop(&mut self) {
        self.downloads.cancel_all();
        // Retire every tab before closing any controller: closing one can pump
        // COM callbacks belonging to another page in the same owner.
        for view in self.views.values() {
            view.events.retire();
        }
    }
}
