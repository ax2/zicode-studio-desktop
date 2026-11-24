//! The bounded custom objects shared by the browser's native menu requests.
use super::Selection;
use std::{cell::RefCell, rc::Weak};
use webview2_com::{
    take_pwstr, CustomItemSelectedEventHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{BOOL, HSTRING, PWSTR};

const ACTIONS: [(&str, &str, &str); 14] = [
    ("back", "Back", "后退"),
    ("forward", "Forward", "前进"),
    ("reload", "Reload", "刷新"),
    ("find", "Find in page", "在页面中查找"),
    ("bookmark", "Bookmark this page", "收藏此页"),
    ("bookmarks", "Bookmarks", "收藏夹"),
    ("history", "Browsing history", "浏览历史"),
    ("downloads", "Downloads", "下载"),
    ("read", "Read page", "阅读网页"),
    ("reader", "Reading mode", "阅读模式"),
    (
        "translateSelection",
        "Translate selected text",
        "翻译选中文字",
    ),
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
        can_translate_selection: bool,
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
                    "translateSelection" => can_translate_selection,
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

#[cfg(test)]
mod tests {
    use super::super::super::{
        native_privacy_tests::HiddenOwner, Bounds, BrowserPolicy, NativeBrowserEngine,
    };
    use super::*;
    use std::{rc::Rc, sync::Arc};
    use windows::core::Interface;
    use wry::WebViewExtWindows;

    #[test]
    #[ignore = "Explicit Windows menu acceptance in a hidden owned WebView2 profile only"]
    fn cached_native_menu_updates_translation_availability_for_each_request() {
        let profile = tempfile::tempdir().unwrap();
        let owner = HiddenOwner::new();
        let mut engine = NativeBrowserEngine::new(
            profile.path().join("browser"),
            BrowserPolicy::public_web(),
            Arc::new(|_| {}),
        )
        .unwrap();
        let tab = "72195600-0fb0-47d3-a3f9-a4b70d8fe53d";
        engine
            .create(
                &owner,
                tab,
                "about:blank",
                Bounds {
                    x: 0.0,
                    y: 0.0,
                    width: 800.0,
                    height: 600.0,
                },
                1.0,
                false,
            )
            .unwrap();
        let view = engine.view(tab).unwrap();
        let environment = view
            .environment()
            .cast::<ICoreWebView2Environment9>()
            .unwrap();
        let selection = Rc::new(RefCell::new(Selection::default()));
        let index = ACTIONS
            .iter()
            .position(|(action, ..)| *action == "translateSelection")
            .unwrap();
        for (chinese, expected_label) in
            [(false, "Translate selected text"), (true, "翻译选中文字")]
        {
            let items = MenuItems::new(&environment, chinese, Rc::downgrade(&selection)).unwrap();
            for can_translate in [false, true, false, true] {
                let root = unsafe {
                    environment
                        .CreateContextMenuItem(
                            &HSTRING::from("Owned test menu"),
                            None,
                            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU,
                        )
                        .unwrap()
                };
                let result = items
                    .append(
                        &unsafe { root.Children().unwrap() },
                        None,
                        false,
                        can_translate,
                    )
                    .unwrap();
                let entry = &items.actions[index];
                let mut enabled = BOOL::default();
                let mut label = PWSTR::null();
                unsafe {
                    entry.IsEnabled(&mut enabled).unwrap();
                    entry.Label(&mut label).unwrap();
                }
                assert_eq!(take_pwstr(label), expected_label);
                assert_eq!(enabled.as_bool(), can_translate);
                assert_eq!(
                    result
                        .disabled_actions
                        .iter()
                        .any(|id| id == "translateSelection"),
                    !can_translate,
                );
                assert!(result.disabled_actions.iter().any(|id| id == "back"));
            }
        }
    }
}
