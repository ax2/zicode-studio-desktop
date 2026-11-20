//! Reuse one custom menu per browser environment across tabs and requests.
use super::{BrowserPolicy, EngineEvent};
use std::{
    cell::RefCell,
    rc::{Rc, Weak},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use webview2_com::{
    take_pwstr, ContextMenuRequestedEventHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{Interface, BOOL, PWSTR};
use wry::WebViewExtWindows;

#[path = "native_menu_items.rs"]
mod items;

struct Owner {
    controller: ICoreWebView2Controller,
    tab: String,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
}

#[derive(Default)]
struct Selection {
    owner: Weak<Owner>,
    link: Option<String>,
}

impl Selection {
    fn dispatch(&self, action: &str) -> windows::core::Result<()> {
        let Some(owner) = self.owner.upgrade() else {
            return Ok(());
        };
        let mut visible = BOOL::default();
        unsafe {
            owner.controller.IsVisible(&mut visible)?;
        }
        if !visible.as_bool() {
            return Ok(());
        }
        match action {
            "openLink" | "openLinkBackground" => {
                if let Some(url) = &self.link {
                    (owner.emit)(EngineEvent::Popup {
                        tab: owner.tab.clone(),
                        url: url.clone(),
                        user_initiated: true,
                        allowed: true,
                        background: action == "openLinkBackground",
                        request: None,
                    });
                }
            }
            _ => (owner.emit)(EngineEvent::ContextAction {
                tab: owner.tab.clone(),
                action: action.into(),
            }),
        }
        Ok(())
    }
}

#[derive(Default)]
pub(super) struct MenuCache {
    items: Option<items::MenuItems>,
    selection: Rc<RefCell<Selection>>,
}

pub fn install(
    view: &wry::WebView,
    policy: BrowserPolicy,
    tab: String,
    chinese: Arc<AtomicBool>,
    cache: Rc<RefCell<MenuCache>>,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    let environment = view.environment().cast::<ICoreWebView2Environment9>()?;
    let owner = Rc::new(Owner {
        controller: view.controller(),
        tab,
        emit,
    });
    unsafe {
        view.webview()
            .cast::<ICoreWebView2_11>()?
            .add_ContextMenuRequested(
                &ContextMenuRequestedEventHandler::create(Box::new(move |sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut visible = BOOL::default();
                    owner.controller.IsVisible(&mut visible)?;
                    if !visible.as_bool() {
                        args.SetHandled(true)?;
                        return Ok(());
                    }
                    let history = sender
                        .as_ref()
                        .map(super::super::windows_policy::history_state)
                        .transpose()?;
                    let target = args.ContextMenuTarget()?;
                    let mut has_link = BOOL::default();
                    target.HasLinkUri(&mut has_link)?;
                    let link = if has_link.as_bool() {
                        let mut raw = PWSTR::null();
                        target.LinkUri(&mut raw)?;
                        let url = take_pwstr(raw);
                        (url.len() <= 16384 && url != "about:blank" && policy.permits(&url))
                            .then_some(url)
                    } else {
                        None
                    };
                    let chinese = chinese.load(Ordering::Relaxed);
                    let mut cache = cache.borrow_mut();
                    if cache
                        .items
                        .as_ref()
                        .is_none_or(|items| items.chinese != chinese)
                    {
                        // Labels are read-only in WebView2. Replace the single cached set
                        // on language changes; do not retain a set for every tab/language.
                        let selection = Rc::new(RefCell::new(Selection::default()));
                        cache.items = Some(items::MenuItems::new(
                            &environment,
                            chinese,
                            Rc::downgrade(&selection),
                        )?);
                        // Retire callbacks from the previous localized objects.
                        cache.selection = selection;
                    }
                    *cache.selection.borrow_mut() = Selection {
                        owner: Rc::downgrade(&owner),
                        link: link.clone(),
                    };
                    let items = cache.items.as_ref().expect("initialized menu");
                    let result =
                        items.append(&args.MenuItems()?, history.as_ref(), link.is_some())?;
                    (owner.emit)(EngineEvent::ContextMenuReady {
                        tab: owner.tab.clone(),
                        actions: result.actions,
                        disabled_actions: result.disabled_actions,
                        menu_id: result.menu_id,
                        label: result.label,
                    });
                    Ok(())
                })),
                &mut 0,
            )
    }
}
