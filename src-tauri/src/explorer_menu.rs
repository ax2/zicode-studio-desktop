//! Optional current-user legacy Explorer verbs. No HKLM, COM or file associations.
use crate::explorer_entry::MenuAction;

#[tauri::command]
pub fn desktop_explorer_menu(window: tauri::WebviewWindow, action: String) -> Result<serde_json::Value, String> {
    crate::require_workspace_window(&window)?;
    let operation = match action.as_str() {
        "status" => MenuAction::Status,
        "install" => MenuAction::Install,
        "remove" => MenuAction::Remove,
        _ => return Err("Unknown Explorer menu action".into()),
    };
    if operation == MenuAction::Status && (!cfg!(windows) || crate::desktop_profile::is_isolated()) {
        return Ok(serde_json::json!({"supported":false,"reason":if cfg!(windows) {"isolated-profile"} else {"windows-only"}}));
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
        platform::apply(&winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER), "Software\\Classes", exe, action)
    }
    #[cfg(not(windows))]
    { let _ = action; Err("Explorer integration is available on Windows only".into()) }
}

#[cfg(windows)]
mod platform {
    use super::MenuAction;
    use serde_json::{json, Value};
    use winreg::{enums::KEY_READ, RegKey};
    const OWNER: &str = "zicode-studio-desktop.explorer.v1";
    const ENTRIES: [(&str, &str, bool); 4] = [
        ("Directory", "%1", false), ("Directory\\Background", "%V", false), ("Drive", "%1", false),
        ("*", "%1", true),
    ];

    fn command(exe: &str, placeholder: &str, file: bool) -> Result<String, String> {
        if !std::path::Path::new(exe).is_absolute() || exe.contains(['"', '\r', '\n']) {
            return Err("Invalid executable path".into());
        }
        // Appending \. avoids a drive-root trailing backslash escaping its quote.
        Ok(if file { format!("\"{exe}\" --open-file \"{placeholder}\"") }
            else { format!("\"{exe}\" --open-folder \"{placeholder}\\.\"") })
    }

    fn inspect(root: &RegKey, path: &str, expected: &str) -> Result<bool, String> {
        let key = match root.open_subkey_with_flags(path, KEY_READ) {
            Ok(key) => key,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("Cannot inspect Explorer menu: {e}")),
        };
        let owner: String = key.get_value("ZiCodeStudioOwner").map_err(|_| "Existing Explorer entry has no matching owner")?;
        let actual: String = key.open_subkey("command").and_then(|k| k.get_value("")).map_err(|_| "Existing Explorer command is invalid")?;
        if owner != OWNER || actual != expected { return Err("Explorer entry belongs to another command or installation".into()); }
        for child in key.enum_keys() {
            if child.map_err(|e| e.to_string())? != "command" { return Err("Explorer entry contains an unexpected subkey".into()); }
        }
        Ok(true)
    }

    pub(super) fn apply(root: &RegKey, base: &str, exe: &str, action: MenuAction) -> Result<Value, String> {
        let plans: Vec<_> = ENTRIES.iter().map(|(kind, placeholder, file)| {
            let verb = if *file { "OpenFile" } else { "OpenFolder" };
            Ok((format!("{base}\\{kind}\\shell\\ZiCodeStudio.{verb}"), command(exe, placeholder, *file)?, *file))
        }).collect::<Result<_, String>>()?;
        // Preflight every verb before any mutation. A foreign entry blocks the operation.
        let installed = plans.iter().map(|(path, cmd, _)| inspect(root, path, cmd)).collect::<Result<Vec<_>, _>>()?;
        for ((path, cmd, file), present) in plans.iter().zip(&installed) {
            match action {
                MenuAction::Install => {
                    let (key, _) = root.create_subkey(path).map_err(|e| format!("Cannot create Explorer entry: {e}"))?;
                    key.set_value("ZiCodeStudioOwner", &OWNER).map_err(|e| e.to_string())?;
                    let label = if *file { "在 Studio 中选择文件工具" } else { "在 ZiCode Studio 中打开" };
                    key.set_value("MUIVerb", &label).map_err(|e| e.to_string())?;
                    key.set_value("Icon", &format!("\"{exe}\",0")).map_err(|e| e.to_string())?;
                    // A background verb has no selected item. Windows hides it when
                    // MultiSelectModel=Single is present, even though the key exists.
                    if path.contains("\\Directory\\Background\\") {
                        match key.delete_value("MultiSelectModel") {
                            Ok(()) => {}
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                            Err(e) => return Err(e.to_string()),
                        }
                    } else {
                        key.set_value("MultiSelectModel", &"Single").map_err(|e| e.to_string())?;
                    }
                    key.create_subkey("command").and_then(|(k, _)| k.set_value("", cmd)).map_err(|e| e.to_string())?;
                }
                MenuAction::Remove if *present => {
                    // Recheck just before removing this exact product-owned subtree.
                    inspect(root, path, cmd)?;
                    root.delete_subkey_all(path).map_err(|e| format!("Cannot remove owned Explorer entry: {e}"))?;
                }
                _ => {}
            }
        }
        Ok(json!({"schemaVersion":1,"scope":"current-user","menu":"legacy","action":format!("{action:?}"),
            "installed":match action { MenuAction::Install => ENTRIES.len(), MenuAction::Remove => 0, _ => installed.iter().filter(|v| **v).count() },
            "modernWindows11Menu":false}))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn private_registry_roundtrip_and_foreign_ownership() {
            let root = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
            let base = format!("Software\\ZiCodeStudio.Tests\\explorer-{}", uuid::Uuid::new_v4());
            let exe = "C:\\测试 & 空格\\zicode-studio-desktop.exe";
            assert_eq!(apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"], 0);
            assert_eq!(apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"], 4);
            assert_eq!(apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"], 4);
            let file_path = format!("{base}\\*\\shell\\ZiCodeStudio.OpenFile");
            let file = root.open_subkey(&file_path).unwrap();
            assert_eq!(file.get_value::<String, _>("MUIVerb").unwrap(), "在 Studio 中选择文件工具");
            assert_eq!(file.get_value::<String, _>("MultiSelectModel").unwrap(), "Single");
            assert_eq!(file.open_subkey("command").unwrap().get_value::<String, _>("").unwrap(),
                format!("\"{exe}\" --open-file \"%1\""));
            drop(file);
            let background = root.open_subkey(format!("{base}\\Directory\\Background\\shell\\ZiCodeStudio.OpenFolder")).unwrap();
            assert!(background.get_value::<String, _>("MultiSelectModel").is_err());
            drop(background);
            // Simulate an older installation with only the three folder verbs.
            root.delete_subkey_all(&file_path).unwrap();
            assert_eq!(apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"], 3);
            assert_eq!(apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"], 4);
            let file = root.open_subkey_with_flags(&file_path, winreg::enums::KEY_WRITE).unwrap();
            file.set_value("ZiCodeStudioOwner", &"foreign-file").unwrap();
            assert!(apply(&root, &base, exe, MenuAction::Remove).is_err());
            assert!(apply(&root, &base, exe, MenuAction::Install).is_err());
            assert!(root.open_subkey(format!("{base}\\Directory\\shell\\ZiCodeStudio.OpenFolder")).is_ok());
            file.set_value("ZiCodeStudioOwner", &OWNER).unwrap();
            drop(file);
            let path = format!("{base}\\Directory\\shell\\ZiCodeStudio.OpenFolder");
            let key = root.open_subkey_with_flags(&path, winreg::enums::KEY_WRITE).unwrap();
            key.set_value("ZiCodeStudioOwner", &"foreign").unwrap();
            assert!(apply(&root, &base, exe, MenuAction::Remove).is_err());
            assert!(apply(&root, &base, exe, MenuAction::Install).is_err());
            assert!(root.open_subkey(format!("{base}\\Drive\\shell\\ZiCodeStudio.OpenFolder")).is_ok());
            key.set_value("ZiCodeStudioOwner", &OWNER).unwrap();
            assert!(apply(&root, &base, "C:\\another.exe", MenuAction::Remove).is_err());
            assert_eq!(apply(&root, &base, exe, MenuAction::Remove).unwrap()["installed"], 0);
            assert_eq!(apply(&root, &base, exe, MenuAction::Remove).unwrap()["installed"], 0);
            drop(key);
            assert!(base.starts_with("Software\\ZiCodeStudio.Tests\\explorer-"));
            root.delete_subkey_all(&base).unwrap();
            assert_eq!(command(exe, "%V", false).unwrap(), format!("\"{exe}\" --open-folder \"%V\\.\""));
            assert!(command("C:\\bad\".exe", "%1", false).is_err());
            assert!(command("C:\\bad\".exe", "%1", true).is_err());
        }
    }
}
