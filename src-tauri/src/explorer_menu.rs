//! Optional current-user legacy Explorer verbs. No HKLM, COM or file associations.
use crate::explorer_entry::MenuAction;

#[tauri::command]
pub fn desktop_explorer_menu(
    window: tauri::WebviewWindow,
    action: String,
) -> Result<serde_json::Value, String> {
    crate::require_workspace_window(&window)?;
    let operation = match action.as_str() {
        "status" => MenuAction::Status,
        "install" => MenuAction::Install,
        "remove" => MenuAction::Remove,
        _ => return Err("Unknown Explorer menu action".into()),
    };
    if operation == MenuAction::Status && (!cfg!(windows) || crate::desktop_profile::is_isolated())
    {
        return Ok(
            serde_json::json!({"supported":false,"reason":if cfg!(windows) {"isolated-profile"} else {"windows-only"}}),
        );
    }
    let mut result = execute(operation)?;
    result["supported"] = serde_json::Value::Bool(true);
    Ok(result)
}

pub fn execute(action: MenuAction) -> Result<serde_json::Value, String> {
    if crate::desktop_profile::is_isolated() {
        return Err("Isolated profiles cannot change Explorer registration".into());
    }
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_str().ok_or("Executable path must be Unicode")?;
        platform::apply(
            &winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER),
            "Software\\Classes",
            exe,
            action,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err("Explorer integration is available on Windows only".into())
    }
}

#[cfg(windows)]
mod platform {
    use super::MenuAction;
    use serde_json::{json, Value};
    use winreg::{enums::KEY_READ, RegKey};
    const OWNER: &str = "zicode-studio-desktop.explorer.v1";
    const SELECTION_CLSID: &str = "{ADA43B0A-52BF-4319-9285-8E5F131C4300}";
    const SELECTION_DLL: &str = "zicode_studio_shell.dll";
    const ENTRIES: [(&str, &str, bool); 4] = [
        ("Directory", "%1", false),
        ("Directory\\Background", "%V", false),
        ("Drive", "%1", false),
        ("*", "%1", true),
    ];

    fn command(exe: &str, placeholder: &str, file: bool) -> Result<String, String> {
        if !std::path::Path::new(exe).is_absolute() || exe.contains(['"', '\r', '\n']) {
            return Err("Invalid executable path".into());
        }
        // Appending \. avoids a drive-root trailing backslash escaping its quote.
        Ok(if file {
            format!("\"{exe}\" --open-file \"{placeholder}\"")
        } else {
            format!("\"{exe}\" --open-folder \"{placeholder}\\.\"")
        })
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum EntryState {
        Missing,
        Current,
        Stale,
    }

    fn selection_dll(exe: &str) -> Result<std::path::PathBuf, String> {
        let folder = std::path::Path::new(exe)
            .parent()
            .ok_or("Invalid executable location")?;
        let local = folder.join(SELECTION_DLL);
        let bundled = folder.join("resources").join(SELECTION_DLL);
        Ok(if local.is_file() {
            local
        } else if bundled.is_file() {
            bundled
        } else {
            local
        })
    }

    fn inspect_selection(root: &RegKey, base: &str, exe: &str) -> Result<EntryState, String> {
        let verb_path = format!("{base}\\*\\shell\\ZiCodeStudio.OpenSelection");
        let class_path = format!("{base}\\CLSID\\{SELECTION_CLSID}");
        let verb = match root.open_subkey_with_flags(&verb_path, KEY_READ) {
            Ok(key) => Some(key),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("Cannot inspect Explorer selection verb: {e}")),
        };
        let class = match root.open_subkey_with_flags(&class_path, KEY_READ) {
            Ok(key) => Some(key),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("Cannot inspect Explorer selection class: {e}")),
        };
        if verb.is_none() && class.is_none() {
            return Ok(EntryState::Missing);
        }
        if let Some(verb) = &verb {
            let owner: String = verb
                .get_value("ZiCodeStudioOwner")
                .map_err(|_| "Selection verb has no Studio owner")?;
            let handler: String = verb
                .get_value("ExplorerCommandHandler")
                .map_err(|_| "Selection verb has no handler")?;
            let model: String = verb
                .get_value("MultiSelectModel")
                .map_err(|_| "Selection verb has no selection model")?;
            if owner != OWNER
                || !handler.eq_ignore_ascii_case(SELECTION_CLSID)
                || model != "Player"
                || verb.enum_keys().next().is_some()
            {
                return Err("Explorer selection verb belongs to another handler".into());
            }
        }
        let mut actual_dll = None;
        if let Some(class) = &class {
            let owner: String = class
                .get_value("ZiCodeStudioOwner")
                .map_err(|_| "Selection class has no Studio owner")?;
            if owner != OWNER {
                return Err("Explorer selection class belongs to another handler".into());
            }
            for child in class.enum_keys() {
                if child.map_err(|e| e.to_string())? != "InprocServer32" {
                    return Err("Explorer selection class has an unexpected subkey".into());
                }
            }
            let server = class
                .open_subkey("InprocServer32")
                .map_err(|_| "Selection COM server is missing")?;
            let path: String = server
                .get_value("")
                .map_err(|_| "Selection COM server path is missing")?;
            let threading: String = server
                .get_value("ThreadingModel")
                .map_err(|_| "Selection COM threading model is missing")?;
            let path = std::path::PathBuf::from(path);
            if threading != "Apartment"
                || !path.is_absolute()
                || path.file_name().and_then(|name| name.to_str()) != Some(SELECTION_DLL)
            {
                return Err("Explorer selection COM server is not a Studio DLL".into());
            }
            actual_dll = Some(path);
        }
        let expected_dll = selection_dll(exe)?;
        Ok(
            if verb.is_some() && actual_dll.as_ref() == Some(&expected_dll) {
                EntryState::Current
            } else {
                EntryState::Stale
            },
        )
    }

    fn apply_selection(
        root: &RegKey,
        base: &str,
        exe: &str,
        action: MenuAction,
        present: EntryState,
    ) -> Result<(), String> {
        let verb_path = format!("{base}\\*\\shell\\ZiCodeStudio.OpenSelection");
        let class_path = format!("{base}\\CLSID\\{SELECTION_CLSID}");
        match action {
            MenuAction::Install => {
                let dll = selection_dll(exe)?;
                if !dll.is_file() {
                    return Err(
                        "Studio selection Shell DLL is missing; rebuild the complete runtime"
                            .into(),
                    );
                }
                let (class, _) = root.create_subkey(&class_path).map_err(|e| e.to_string())?;
                class
                    .set_value("ZiCodeStudioOwner", &OWNER)
                    .map_err(|e| e.to_string())?;
                let (server, _) = class
                    .create_subkey("InprocServer32")
                    .map_err(|e| e.to_string())?;
                server
                    .set_value("", &dll.to_string_lossy().as_ref())
                    .map_err(|e| e.to_string())?;
                server
                    .set_value("ThreadingModel", &"Apartment")
                    .map_err(|e| e.to_string())?;
                let (verb, _) = root.create_subkey(&verb_path).map_err(|e| e.to_string())?;
                verb.set_value("ZiCodeStudioOwner", &OWNER)
                    .map_err(|e| e.to_string())?;
                verb.set_value("MUIVerb", &"在 Studio 中选择文件工具")
                    .map_err(|e| e.to_string())?;
                verb.set_value("MultiSelectModel", &"Player")
                    .map_err(|e| e.to_string())?;
                verb.set_value("ExplorerCommandHandler", &SELECTION_CLSID)
                    .map_err(|e| e.to_string())?;
            }
            MenuAction::Remove if present != EntryState::Missing => {
                inspect_selection(root, base, exe)?;
                if root.open_subkey_with_flags(&verb_path, KEY_READ).is_ok() {
                    root.delete_subkey_all(&verb_path)
                        .map_err(|e| e.to_string())?;
                }
                if root.open_subkey_with_flags(&class_path, KEY_READ).is_ok() {
                    root.delete_subkey_all(&class_path)
                        .map_err(|e| e.to_string())?;
                }
            }
            MenuAction::RemoveCurrent if present == EntryState::Current => {
                inspect_selection(root, base, exe)?;
                if root.open_subkey_with_flags(&verb_path, KEY_READ).is_ok() {
                    root.delete_subkey_all(&verb_path)
                        .map_err(|e| e.to_string())?;
                }
                if root.open_subkey_with_flags(&class_path, KEY_READ).is_ok() {
                    root.delete_subkey_all(&class_path)
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn inspect(
        root: &RegKey,
        path: &str,
        expected: &str,
        placeholder: &str,
        file: bool,
    ) -> Result<EntryState, String> {
        let key = match root.open_subkey_with_flags(path, KEY_READ) {
            Ok(key) => key,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(EntryState::Missing),
            Err(e) => return Err(format!("Cannot inspect Explorer menu: {e}")),
        };
        let owner: String = key
            .get_value("ZiCodeStudioOwner")
            .map_err(|_| "Existing Explorer entry has no matching owner")?;
        let actual: String = key
            .open_subkey("command")
            .and_then(|k| k.get_value(""))
            .map_err(|_| "Existing Explorer command is invalid")?;
        if owner != OWNER {
            return Err("Explorer entry belongs to another command or installation".into());
        }
        let suffix = if file {
            format!("\" --open-file \"{placeholder}\"")
        } else {
            format!("\" --open-folder \"{placeholder}\\.\"")
        };
        let old_exe = actual
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix(&suffix))
            .ok_or("Existing Explorer command is not a Studio entry")?;
        let current_exe = expected
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix(&suffix))
            .ok_or("Invalid current Explorer command")?;
        let old_path = std::path::Path::new(old_exe);
        if !old_path.is_absolute()
            || old_path.file_name() != std::path::Path::new(current_exe).file_name()
            || command(old_exe, placeholder, file)? != actual
        {
            return Err("Explorer entry belongs to another command or installation".into());
        }
        for child in key.enum_keys() {
            if child.map_err(|e| e.to_string())? != "command" {
                return Err("Explorer entry contains an unexpected subkey".into());
            }
        }
        Ok(if actual == expected {
            EntryState::Current
        } else {
            EntryState::Stale
        })
    }

    pub(super) fn apply(
        root: &RegKey,
        base: &str,
        exe: &str,
        action: MenuAction,
    ) -> Result<Value, String> {
        let plans: Vec<_> = ENTRIES
            .iter()
            .map(|(kind, placeholder, file)| {
                let verb = if *file { "OpenFile" } else { "OpenFolder" };
                Ok((
                    format!("{base}\\{kind}\\shell\\ZiCodeStudio.{verb}"),
                    command(exe, placeholder, *file)?,
                    *placeholder,
                    *file,
                ))
            })
            .collect::<Result<_, String>>()?;
        // Preflight every verb before any mutation. A foreign entry blocks the operation.
        let installed = plans
            .iter()
            .map(|(path, cmd, placeholder, file)| inspect(root, path, cmd, placeholder, *file))
            .collect::<Result<Vec<_>, _>>()?;
        let selection = inspect_selection(root, base, exe)?;
        if action == MenuAction::Install && !selection_dll(exe)?.is_file() {
            return Err(
                "Studio selection Shell DLL is missing; rebuild the complete runtime".into(),
            );
        }
        for ((path, cmd, placeholder, file), present) in plans.iter().zip(&installed) {
            match action {
                MenuAction::Install => {
                    let (key, _) = root
                        .create_subkey(path)
                        .map_err(|e| format!("Cannot create Explorer entry: {e}"))?;
                    key.set_value("ZiCodeStudioOwner", &OWNER)
                        .map_err(|e| e.to_string())?;
                    let label = if *file {
                        "在 Studio 中选择文件工具"
                    } else {
                        "在 ZiCode Studio 中打开"
                    };
                    key.set_value("MUIVerb", &label)
                        .map_err(|e| e.to_string())?;
                    key.set_value("Icon", &format!("\"{exe}\",0"))
                        .map_err(|e| e.to_string())?;
                    // A background verb has no selected item. Windows hides it when
                    // MultiSelectModel=Single is present, even though the key exists.
                    if path.contains("\\Directory\\Background\\") {
                        match key.delete_value("MultiSelectModel") {
                            Ok(()) => {}
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                            Err(e) => return Err(e.to_string()),
                        }
                    } else {
                        key.set_value("MultiSelectModel", &"Single")
                            .map_err(|e| e.to_string())?;
                    }
                    key.create_subkey("command")
                        .and_then(|(k, _)| k.set_value("", cmd))
                        .map_err(|e| e.to_string())?;
                }
                MenuAction::Remove if *present != EntryState::Missing => {
                    inspect(root, path, cmd, placeholder, *file)?;
                    root.delete_subkey_all(path)
                        .map_err(|e| format!("Cannot remove owned Explorer entry: {e}"))?;
                }
                MenuAction::RemoveCurrent if *present == EntryState::Current => {
                    // Recheck just before removing this exact product-owned subtree.
                    inspect(root, path, cmd, placeholder, *file)?;
                    root.delete_subkey_all(path)
                        .map_err(|e| format!("Cannot remove owned Explorer entry: {e}"))?;
                }
                _ => {}
            }
        }
        apply_selection(root, base, exe, action, selection)?;
        Ok(
            json!({"schemaVersion":1,"scope":"current-user","menu":"legacy","action":format!("{action:?}"),"total":ENTRIES.len()+1,
            "installed":match action { MenuAction::Install => ENTRIES.len()+1, MenuAction::Remove => 0, MenuAction::RemoveCurrent => installed.iter().filter(|v| **v == EntryState::Stale).count() + usize::from(selection == EntryState::Stale), MenuAction::Status => installed.iter().filter(|v| **v != EntryState::Missing).count() + usize::from(selection != EntryState::Missing) },
            "stale":match action { MenuAction::Status | MenuAction::RemoveCurrent => installed.iter().filter(|v| **v == EntryState::Stale).count() + usize::from(selection == EntryState::Stale), _ => 0 },
            "modernWindows11Menu":false}),
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn private_registry_roundtrip_and_foreign_ownership() {
            let root = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
            let base = format!(
                "Software\\ZiCodeStudio.Tests\\explorer-{}",
                uuid::Uuid::new_v4()
            );
            let temp =
                std::env::temp_dir().join(format!("studio-shell-test-{}", uuid::Uuid::new_v4()));
            let folder = temp.join("测试 & 空格");
            std::fs::create_dir_all(&folder).unwrap();
            let dll = folder.join(SELECTION_DLL);
            std::fs::write(&dll, b"MZ").unwrap();
            let exe_path = folder.join("zicode-studio-desktop.exe");
            let exe = exe_path.to_str().unwrap();
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"],
                0
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"],
                5
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"],
                5
            );
            let selection = root
                .open_subkey(format!("{base}\\*\\shell\\ZiCodeStudio.OpenSelection"))
                .unwrap();
            assert_eq!(
                selection
                    .get_value::<String, _>("MultiSelectModel")
                    .unwrap(),
                "Player"
            );
            assert_eq!(
                selection
                    .get_value::<String, _>("ExplorerCommandHandler")
                    .unwrap(),
                SELECTION_CLSID
            );
            let file_path = format!("{base}\\*\\shell\\ZiCodeStudio.OpenFile");
            let file = root.open_subkey(&file_path).unwrap();
            assert_eq!(
                file.get_value::<String, _>("MUIVerb").unwrap(),
                "在 Studio 中选择文件工具"
            );
            assert_eq!(
                file.get_value::<String, _>("MultiSelectModel").unwrap(),
                "Single"
            );
            assert_eq!(
                file.open_subkey("command")
                    .unwrap()
                    .get_value::<String, _>("")
                    .unwrap(),
                format!("\"{exe}\" --open-file \"%1\"")
            );
            drop(file);
            let old_exe = "D:\\old install\\zicode-studio-desktop.exe";
            let file_command = root
                .open_subkey_with_flags(format!("{file_path}\\command"), winreg::enums::KEY_WRITE)
                .unwrap();
            file_command
                .set_value("", &command(old_exe, "%1", true).unwrap())
                .unwrap();
            drop(file_command);
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Status).unwrap()["stale"],
                1
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Install).unwrap()["stale"],
                0
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Status).unwrap()["stale"],
                0
            );
            let background = root
                .open_subkey(format!(
                    "{base}\\Directory\\Background\\shell\\ZiCodeStudio.OpenFolder"
                ))
                .unwrap();
            assert!(background
                .get_value::<String, _>("MultiSelectModel")
                .is_err());
            drop(background);
            // Simulate an older installation with only the three folder verbs.
            root.delete_subkey_all(&file_path).unwrap();
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"],
                4
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"],
                5
            );
            let file = root
                .open_subkey_with_flags(&file_path, winreg::enums::KEY_WRITE)
                .unwrap();
            file.set_value("ZiCodeStudioOwner", &"foreign-file")
                .unwrap();
            assert!(apply(&root, &base, exe, MenuAction::Remove).is_err());
            assert!(apply(&root, &base, exe, MenuAction::Install).is_err());
            assert!(root
                .open_subkey(format!("{base}\\Directory\\shell\\ZiCodeStudio.OpenFolder"))
                .is_ok());
            file.set_value("ZiCodeStudioOwner", &OWNER).unwrap();
            drop(file);
            let path = format!("{base}\\Directory\\shell\\ZiCodeStudio.OpenFolder");
            let key = root
                .open_subkey_with_flags(&path, winreg::enums::KEY_WRITE)
                .unwrap();
            key.set_value("ZiCodeStudioOwner", &"foreign").unwrap();
            assert!(apply(&root, &base, exe, MenuAction::Remove).is_err());
            assert!(apply(&root, &base, exe, MenuAction::Install).is_err());
            assert!(root
                .open_subkey(format!("{base}\\Drive\\shell\\ZiCodeStudio.OpenFolder"))
                .is_ok());
            key.set_value("ZiCodeStudioOwner", &OWNER).unwrap();
            drop(key);
            let other_install = "C:\\new-install\\zicode-studio-desktop.exe";
            assert_eq!(
                apply(&root, &base, other_install, MenuAction::RemoveCurrent).unwrap()["installed"],
                5
            );
            assert!(root.open_subkey(&file_path).is_ok());
            assert_eq!(
                apply(&root, &base, exe, MenuAction::RemoveCurrent).unwrap()["installed"],
                0
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"],
                5
            );
            let file_command = root
                .open_subkey_with_flags(format!("{file_path}\\command"), winreg::enums::KEY_WRITE)
                .unwrap();
            file_command
                .set_value("", &command(old_exe, "%1", true).unwrap())
                .unwrap();
            drop(file_command);
            let retained = apply(&root, &base, exe, MenuAction::RemoveCurrent).unwrap();
            assert_eq!(retained["installed"], 1);
            assert_eq!(retained["stale"], 1);
            assert!(root.open_subkey(&file_path).is_ok());
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"],
                5
            );
            assert!(apply(&root, &base, "C:\\another.exe", MenuAction::Remove).is_err());
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Remove).unwrap()["installed"],
                0
            );
            assert_eq!(
                apply(&root, &base, exe, MenuAction::Remove).unwrap()["installed"],
                0
            );
            assert!(base.starts_with("Software\\ZiCodeStudio.Tests\\explorer-"));
            root.delete_subkey_all(&base).unwrap();
            std::fs::remove_file(dll).unwrap();
            std::fs::remove_dir(folder).unwrap();
            std::fs::remove_dir(temp).unwrap();
            assert_eq!(
                command(exe, "%V", false).unwrap(),
                format!("\"{exe}\" --open-folder \"%V\\.\"")
            );
            assert!(command("C:\\bad\".exe", "%1", false).is_err());
            assert!(command("C:\\bad\".exe", "%1", true).is_err());
        }
    }
}
