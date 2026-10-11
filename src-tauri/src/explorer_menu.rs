//! Optional current-user legacy Explorer verbs. No HKLM, COM or file associations.
use crate::explorer_entry::MenuAction;

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
    const ENTRIES: [(&str, &str); 3] = [
        ("Directory", "%1"), ("Directory\\Background", "%V"), ("Drive", "%1"),
    ];

    fn command(exe: &str, placeholder: &str) -> Result<String, String> {
        if !std::path::Path::new(exe).is_absolute() || exe.contains(['"', '\r', '\n']) {
            return Err("Invalid executable path".into());
        }
        // Appending \. avoids a drive-root trailing backslash escaping its quote.
        Ok(format!("\"{exe}\" --open-folder \"{placeholder}\\.\""))
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
        let plans: Vec<_> = ENTRIES.iter().map(|(kind, placeholder)| {
            Ok((format!("{base}\\{kind}\\shell\\ZiCodeStudio.OpenFolder"), command(exe, placeholder)?))
        }).collect::<Result<_, String>>()?;
        // Preflight every verb before any mutation. A foreign entry blocks the operation.
        let installed = plans.iter().map(|(path, cmd)| inspect(root, path, cmd)).collect::<Result<Vec<_>, _>>()?;
        for ((path, cmd), present) in plans.iter().zip(&installed) {
            match action {
                MenuAction::Install => {
                    let (key, _) = root.create_subkey(path).map_err(|e| format!("Cannot create Explorer entry: {e}"))?;
                    key.set_value("ZiCodeStudioOwner", &OWNER).map_err(|e| e.to_string())?;
                    key.set_value("MUIVerb", &"在 ZiCode Studio 中打开").map_err(|e| e.to_string())?;
                    key.set_value("Icon", &format!("\"{exe}\",0")).map_err(|e| e.to_string())?;
                    key.set_value("MultiSelectModel", &"Single").map_err(|e| e.to_string())?;
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
            "installed":match action { MenuAction::Install => 3, MenuAction::Remove => 0, _ => installed.iter().filter(|v| **v).count() },
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
            assert_eq!(apply(&root, &base, exe, MenuAction::Install).unwrap()["installed"], 3);
            assert_eq!(apply(&root, &base, exe, MenuAction::Status).unwrap()["installed"], 3);
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
            assert_eq!(command(exe, "%V").unwrap(), format!("\"{exe}\" --open-folder \"%V\\.\""));
            assert!(command("C:\\bad\".exe", "%1").is_err());
        }
    }
}
