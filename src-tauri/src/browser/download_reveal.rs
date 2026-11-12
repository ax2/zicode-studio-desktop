//! Reveal a completed workspace-owned download in Explorer without launching it.
use serde_json::Value;
use std::{
    os::windows::{ffi::OsStrExt, fs::MetadataExt},
    path::{Component, Path, Prefix},
    ptr::{null, null_mut},
};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT,
    System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
    UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName},
};

const MISSING: &str = "The downloaded file is no longer available";
const SHELL_ERROR: &str = "Could not show the downloaded file in File Explorer";

pub async fn reveal(window: WebviewWindow, id: String) -> Result<Value, String> {
    let path = super::download_journal::completed_path(window.label().into(), id).await?;
    tauri::async_runtime::spawn_blocking(move || select_in_explorer(&path))
        .await
        .map_err(|_| SHELL_ERROR)??;
    Ok(Value::Null)
}

fn select_in_explorer(path: &Path) -> Result<(), String> {
    let shell_path = crate::process_command::working_directory(path);
    if !shell_path.is_absolute()
        || !matches!(shell_path.components().next(), Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::UNC(..)))
    {
        return Err(MISSING.into());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| MISSING)?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(MISSING.into());
    }
    let mut wide: Vec<_> = shell_path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err(MISSING.into());
    }
    wide.push(0);

    // The blocking worker owns this COM initialization and Shell item identifier.
    if unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) } < 0 {
        return Err(SHELL_ERROR.into());
    }
    let mut item = null_mut();
    let parsed = unsafe { SHParseDisplayName(wide.as_ptr(), null_mut(), &mut item, 0, null_mut()) };
    let selected = parsed >= 0
        && !item.is_null()
        && unsafe { SHOpenFolderAndSelectItems(item, 0, null(), 0) } >= 0;
    unsafe {
        CoTaskMemFree(item.cast());
        CoUninitialize();
    }
    if selected {
        Ok(())
    } else {
        Err(SHELL_ERROR.into())
    }
}
