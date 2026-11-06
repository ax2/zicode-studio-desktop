//! Extend the actual browser menu; retain native copy/paste/link/image actions.
use super::{BrowserPolicy, EngineEvent};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use webview2_com::{take_pwstr, ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler, Microsoft::Web::WebView2::Win32::*};
use windows::core::{Interface, HSTRING, PWSTR, BOOL};
use wry::WebViewExtWindows;

pub fn install(view: &wry::WebView, policy: BrowserPolicy, tab: String, chinese: Arc<AtomicBool>, emit: Arc<dyn Fn(EngineEvent) + Send + Sync>) -> windows::core::Result<()> {
    let environment = view.environment().cast::<ICoreWebView2Environment9>()?;
    let controller = view.controller();
    unsafe { view.webview().cast::<ICoreWebView2_11>()?.add_ContextMenuRequested(
        &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()); };
            let mut visible = BOOL::default();controller.IsVisible(&mut visible)?;
            if !visible.as_bool() { args.SetHandled(true)?;return Ok(()); }
            let zh = chinese.load(Ordering::Relaxed);
            let menu = args.MenuItems()?;let mut count = 0;menu.Count(&mut count)?;
            let mut actions = Vec::new();
            let target = args.ContextMenuTarget()?;let mut link = BOOL::default();target.HasLinkUri(&mut link)?;
            if link.as_bool() {
                let mut raw = PWSTR::null();target.LinkUri(&mut raw)?;let url = take_pwstr(raw);
                if url.len() <= 16384 && url != "about:blank" && policy.permits(&url) {
                    let item = environment.CreateContextMenuItem(&HSTRING::from(if zh { "在新标签页中打开链接" } else { "Open link in new tab" }),None,COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                    let chosen_emit = emit.clone();let chosen_tab = tab.clone();let owner = controller.clone();
                    item.add_CustomItemSelected(&CustomItemSelectedEventHandler::create(Box::new(move |_,_| {
                        let mut visible = BOOL::default();owner.IsVisible(&mut visible)?;
                        if visible.as_bool() { chosen_emit(EngineEvent::Popup { tab:chosen_tab.clone(),url:url.clone(),user_initiated:true,allowed:true }); }
                        Ok(())
                    })), &mut 0)?;
                    menu.InsertValueAtIndex(0,&item)?;count += 1;actions.push("openLink");
                }
            }
            let submenu = environment.CreateContextMenuItem(&HSTRING::from(if zh { "浏览器工具" } else { "Browser tools" }),None,COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU)?;
            let children = submenu.Children()?;
            for (index,(action,en,cn)) in [
                ("back","Back","后退"),("forward","Forward","前进"),("reload","Reload","刷新"),
                ("find","Find in page","在页面中查找"),("bookmark","Bookmark this page","收藏此页"),
                ("history","Browsing history","浏览历史"),("read","Read page","阅读网页"),
                ("zoomIn","Zoom in","放大"),("zoomOut","Zoom out","缩小"),("zoomReset","Reset zoom","重置缩放"),
            ].into_iter().enumerate() {
                let item = environment.CreateContextMenuItem(&HSTRING::from(if zh { cn } else { en }),None,COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                let selected_emit = emit.clone();let selected_tab = tab.clone();let owner = controller.clone();
                item.add_CustomItemSelected(&CustomItemSelectedEventHandler::create(Box::new(move |_,_| {
                    let mut visible = BOOL::default();owner.IsVisible(&mut visible)?;
                    if visible.as_bool() { selected_emit(EngineEvent::ContextAction { tab:selected_tab.clone(),action:action.into() }); }
                    Ok(())
                })),&mut 0)?;
                children.InsertValueAtIndex(index as u32,&item)?;actions.push(action);
            }
            menu.InsertValueAtIndex(count,&submenu)?;
            emit(EngineEvent::ContextMenuReady { tab:tab.clone(),actions:actions.into_iter().map(String::from).collect() });
            Ok(())
        })), &mut 0) }
}
