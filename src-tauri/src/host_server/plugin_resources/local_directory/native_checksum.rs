//! Window-bound directory grants for the trusted native folder picker.
use super::*;
use std::path::Component;

pub(super) struct SelectedDirectory {
    pub(super) context: Context,
    pub(super) path: PathBuf,
}

fn invalid_path() -> ApiError {
    rejected("resource_directory_path_invalid")
}

#[cfg(windows)]
fn volume(components: &mut std::path::Components<'_>) -> Result<PathBuf, ApiError> {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Prefix;
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    let Some(Component::Prefix(prefix)) = components.next() else {
        return Err(invalid_path());
    };
    let (Prefix::Disk(letter) | Prefix::VerbatimDisk(letter)) = prefix.kind() else {
        return Err(invalid_path());
    };
    let root = PathBuf::from(format!("{}:\\", char::from(letter)));
    let wide = root
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // GetDriveTypeW returns these local media kinds. Reject mapped network drives,
    // invalid drive letters and indeterminate drive types before opening the root.
    match unsafe { GetDriveTypeW(wide.as_ptr()) } {
        2 | 3 | 5 | 6 => Ok(root),
        _ => Err(invalid_path()),
    }
}

pub(super) fn open_picked_directory(path: &Path) -> Result<Dir, ApiError> {
    let mut components = path.components();
    #[cfg(windows)]
    let root = volume(&mut components)?;
    #[cfg(not(windows))]
    let root = Path::new("/");
    if components.next() != Some(Component::RootDir) {
        return Err(invalid_path());
    }
    let mut directory = Dir::open_ambient_dir(root, ambient_authority())
        .map_err(|_| rejected("resource_directory_unavailable"))?;
    for component in components {
        let Component::Normal(name) = component else {
            return Err(invalid_path());
        };
        directory = open_checked_child(&directory, name)?;
    }
    Ok(directory)
}

fn owner(value: Value) -> Result<Owner, String> {
    serde_json::from_value(value).map_err(|_| "resource_scope_invalid".to_owned())
}

fn error_code((_, Json(error)): ApiError) -> String {
    error["error"]["code"]
        .as_str()
        .unwrap_or("resource_store_unavailable")
        .to_owned()
}

impl HostServer {
    pub(crate) async fn prepare_native_checksum_folder(
        &self,
        context: Context,
        owner_value: Value,
        manifest: String,
        selected: PathBuf,
    ) -> Result<Value, String> {
        let owner = owner(owner_value)?;
        let purpose = Purpose::Checksum(checksum::parse(&manifest).map_err(error_code)?);
        let display_name = selected
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let state = self.state.clone();
        blocking(state.clone(), move || {
            let grant_id = issue_grant(
                &state,
                owner.clone(),
                purpose,
                Selection::Picked(SelectedDirectory {
                    context,
                    path: selected,
                }),
            )?;
            Ok(json!({
                "schemaVersion":1,"profile":checksum::PROFILE,"grantId":grant_id,
                "owner":owner,"displayName":display_name,"entryNamesRead":false,
                "confirmed":false,"expiresInSeconds":120,
            }))
        })
        .await
        .map(|Json(result)| result)
        .map_err(error_code)
    }

    pub(crate) async fn commit_native_checksum_folder(
        &self,
        context: Context,
        owner_value: Value,
        grant_id: String,
        confirmed: bool,
    ) -> Result<Value, String> {
        let request = DirectoryGrantRequest {
            schema_version: 1,
            owner: owner(owner_value)?,
            grant_id,
            confirmed,
        };
        commit_grant(self.state.clone(), request, Some(context))
            .await
            .map(|Json(result)| result)
            .map_err(error_code)
    }

    pub(crate) fn cancel_native_checksum_folder(
        &self,
        context: &Context,
        owner_value: Value,
        grant_id: String,
    ) -> Result<Value, String> {
        let request = DirectoryGrantRequest {
            schema_version: 1,
            owner: owner(owner_value)?,
            grant_id,
            confirmed: false,
        };
        cancel_grant(&self.state, &request, Some(context)).map_err(error_code)
    }
}
