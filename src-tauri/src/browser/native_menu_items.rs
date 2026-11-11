//! The bounded custom objects shared by the browser's native menu requests.
use super::Selection;
use std::{cell::RefCell, rc::Weak};
use webview2_com::{
    take_pwstr, CustomItemSelectedEventHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{BOOL, HSTRING, PWSTR};

const ACTIONS: [(&str, &str, &str); 12] = [
    ("back", "Back", "后退"),
    ("forward", "Forward", "前进"),
    ("reload", "Reload", "刷新"),
    ("find", "Find in page", "在页面中查找"),
    ("bookmark", "Bookmark this page", "收藏此页"),
    ("bookmarks", "Bookmarks", "收藏夹"),
    ("history", "Browsing history", "浏览历史"),
    ("downloads", "Downloads", "下载"),
    ("read", "Read page", "阅读网页"),
    ("zoomIn", "Zoom in", "放大"),
    ("zoomOut", "Zoom out", "缩小"),
    ("zoomReset", "Reset zoom", "重置缩放"),
];
const LINKS: [(&str, &str, &str); 2] = [
    ("openLink", "Open link in new tab", "在新标签页中打开链接"),
    (
        "openLinkBackground",
        "Open link in background tab",
        "在后台标签页中打开链接",
    ),
];

pub(super) struct MenuItems {
    pub chinese: bool,
    submenu: ICoreWebView2ContextMenuItem,
    actions: Vec<ICoreWebView2ContextMenuItem>,
    links: Vec<ICoreWebView2ContextMenuItem>,
}

pub(super) struct Appended {
    pub actions: Vec<String>,
    pub disabled_actions: Vec<String>,
    pub menu_id: i32,
    pub label: String,
}

impl MenuItems {
    pub fn new(
        environment: &ICoreWebView2Environment9,
        chinese: bool,
        selection: Weak<RefCell<Selection>>,
    ) -> windows::core::Result<Self> {
        unsafe {
            let submenu = environment.CreateContextMenuItem(
                &HSTRING::from(if chinese {
                    "浏览器工具"
                } else {
                    "Browser tools"
                }),
                None,
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU,
            )?;
            let children = submenu.Children()?;
            let mut actions = Vec::with_capacity(ACTIONS.len());
            for (index, &(action, en, cn)) in ACTIONS.iter().enumerate() {
                let item = command(
                    environment,
                    if chinese { cn } else { en },
                    action,
                    selection.clone(),
                )?;
                children.InsertValueAtIndex(index as u32, &item)?;
                actions.push(item);
            }
            let mut links = Vec::with_capacity(LINKS.len());
            for (action, en, cn) in LINKS {
                links.push(command(
                    environment,
                    if chinese { cn } else { en },
                    action,
                    selection.clone(),
                )?);
            }
            Ok(Self {
                chinese,
                submenu,
                actions,
                links,
            })
        }
    }

    pub fn append(
        &self,
        menu: &ICoreWebView2ContextMenuItemCollection,
        history: Option<&super::super::super::windows_policy::HistoryState>,
        has_link: bool,
    ) -> windows::core::Result<Appended> {
        unsafe {
            let mut count = 0;
            menu.Count(&mut count)?;
            let mut result = Appended {
                actions: Vec::new(),
                disabled_actions: Vec::new(),
                menu_id: 0,
                label: String::new(),
            };
            if has_link {
                for (index, item) in self.links.iter().enumerate() {
                    menu.InsertValueAtIndex(index as u32, item)?;
                    result.actions.push(LINKS[index].0.into());
                    count += 1;
                }
            }
            for (index, item) in self.actions.iter().enumerate() {
                let action = ACTIONS[index].0;
                let enabled = match action {
                    "back" => history.is_some_and(|state| state.can_go_back),
                    "forward" => history.is_some_and(|state| state.can_go_forward),
                    _ => true,
                };
                item.SetIsEnabled(enabled)?;
                result.actions.push(action.into());
                if !enabled {
                    result.disabled_actions.push(action.into());
                }
            }
            menu.InsertValueAtIndex(count, &self.submenu)?;
            self.submenu.CommandId(&mut result.menu_id)?;
            let mut label = PWSTR::null();
            self.submenu.Label(&mut label)?;
            result.label = take_pwstr(label);
            Ok(result)
        }
    }
}

fn command(
    environment: &ICoreWebView2Environment9,
    label: &str,
    action: &'static str,
    selection: Weak<RefCell<Selection>>,
) -> windows::core::Result<ICoreWebView2ContextMenuItem> {
    unsafe {
        let item = environment.CreateContextMenuItem(
            &HSTRING::from(label),
            None,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
        )?;
        item.add_CustomItemSelected(
            &CustomItemSelectedEventHandler::create(Box::new(move |sender, _| {
                let Some(sender) = sender else {
                    return Ok(());
                };
                let mut enabled = BOOL::default();
                sender.IsEnabled(&mut enabled)?;
                if enabled.as_bool() {
                    if let Some(selection) = selection.upgrade() {
                        selection.borrow().dispatch(action)?;
                    }
                }
                Ok(())
            })),
            &mut 0,
        )?;
        Ok(item)
    }
}
