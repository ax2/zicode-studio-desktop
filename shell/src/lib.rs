#![cfg(windows)]

//! Explorer may load this DLL into its own process. Keep it small: it only hands
//! a bounded, revalidated selection to the sibling Studio executable.
use std::ffi::c_void;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Component, PathBuf, Prefix};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{
    implement, IUnknown, Interface, Ref, Result, BOOL, GUID, HRESULT, PCWSTR, PWSTR,
};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_NOTIMPL, E_POINTER, HINSTANCE,
    HMODULE, S_FALSE, S_OK,
};
use windows::Win32::System::Com::{
    CoTaskMemAlloc, CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl,
};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray, ECS_ENABLED,
    ECS_HIDDEN, SIGDN_FILESYSPATH,
};

pub const SELECTION_CLSID: GUID = GUID::from_u128(0xada43b0a_52bf_4319_9285_8e5f131c4300);
const E_PENDING: HRESULT = HRESULT(0x8000_000A_u32 as i32);
const MAX_COMMAND_UNITS: usize = 24_000;
const REPARSE_POINT: u32 = 0x400;
static OBJECTS: AtomicU32 = AtomicU32::new(0);
static LOCKS: AtomicU32 = AtomicU32::new(0);

struct Lifetime;
impl Lifetime {
    fn new() -> Self {
        OBJECTS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}
impl Drop for Lifetime {
    fn drop(&mut self) {
        OBJECTS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[implement(IExplorerCommand)]
struct SelectionCommand {
    _lifetime: Lifetime,
}

impl IExplorerCommand_Impl for SelectionCommand_Impl {
    fn GetTitle(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        shell_text("在 Studio 中选择文件工具")
    }
    fn GetIcon(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        let exe = sibling_executable()?;
        shell_text(&format!("\"{}\",0", exe.display()))
    }
    fn GetToolTip(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        shell_text("为选中的文件查找工具；不会自动读取或执行")
    }
    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(SELECTION_CLSID)
    }
    fn GetState(&self, items: Ref<IShellItemArray>, ok_to_be_slow: BOOL) -> Result<u32> {
        let Some(items) = items.as_ref() else {
            return Ok(ECS_HIDDEN.0 as u32);
        };
        let count = unsafe { items.GetCount()? };
        if !(2..=4).contains(&count) {
            return Ok(ECS_HIDDEN.0 as u32);
        }
        if !ok_to_be_slow.as_bool() {
            return Err(E_PENDING.into());
        }
        Ok(if selected_paths(items).is_ok() {
            ECS_ENABLED.0 as u32
        } else {
            ECS_HIDDEN.0 as u32
        })
    }
    fn Invoke(&self, items: Ref<IShellItemArray>, _context: Ref<IBindCtx>) -> Result<()> {
        let paths = selected_paths(items.as_ref().ok_or(E_FAIL)?)?;
        let exe = sibling_executable()?;
        if !exe.is_file() {
            return Err(E_FAIL.into());
        }
        Command::new(exe)
            .arg("--open-selection")
            .arg(paths.len().to_string())
            .args(paths)
            .spawn()
            .map(|_| ())
            .map_err(|_| E_FAIL.into())
    }
    fn GetFlags(&self) -> Result<u32> {
        Ok(0)
    }
    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

fn selected_paths(items: &IShellItemArray) -> Result<Vec<PathBuf>> {
    let count = unsafe { items.GetCount()? };
    if !(2..=4).contains(&count) {
        return Err(E_FAIL.into());
    }
    let mut paths = Vec::with_capacity(count as usize);
    for index in 0..count {
        let item = unsafe { items.GetItemAt(index)? };
        let name = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH)? };
        let result = unsafe { name.to_string() }.map(PathBuf::from);
        unsafe { CoTaskMemFree(Some(name.0.cast())) };
        paths.push(result?);
    }
    validate_paths(paths).map_err(|_| E_FAIL.into())
}

fn validate_paths(paths: Vec<PathBuf>) -> std::result::Result<Vec<PathBuf>, &'static str> {
    if !(2..=4).contains(&paths.len()) {
        return Err("selection_count");
    }
    let mut canonical = Vec::with_capacity(paths.len());
    for path in paths {
        if !path.is_absolute()
            || path.to_str().is_none()
            || !matches!(path.components().next(), Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        {
            return Err("nonlocal_path");
        }
        for ancestor in path.ancestors() {
            let meta = fs::symlink_metadata(ancestor).map_err(|_| "missing_path")?;
            use std::os::windows::fs::MetadataExt;
            if meta.file_type().is_symlink() || meta.file_attributes() & REPARSE_POINT != 0 {
                return Err("linked_path");
            }
        }
        if !path.is_file() {
            return Err("nonfile_path");
        }
        canonical.push(path.canonicalize().map_err(|_| "missing_path")?);
    }
    let parent = canonical[0].parent();
    if canonical.iter().any(|path| path.parent() != parent) {
        return Err("different_directories");
    }
    let mut names = std::collections::HashSet::new();
    if canonical
        .iter()
        .any(|path| !names.insert(path.to_string_lossy().to_lowercase()))
    {
        return Err("duplicate_path");
    }
    let units = canonical.iter().fold(32_usize, |size, path| {
        size.saturating_add(path.as_os_str().encode_wide().count() + 3)
    });
    if units > MAX_COMMAND_UNITS {
        return Err("command_too_long");
    }
    Ok(canonical)
}

fn module_path() -> Result<PathBuf> {
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(DllGetClassObject as *const () as *const u16),
            &mut module,
        )?;
    }
    let mut buffer = vec![0_u16; 32_768];
    let length = unsafe { GetModuleFileNameW(Some(module), &mut buffer) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(E_FAIL.into());
    }
    Ok(PathBuf::from(String::from_utf16_lossy(&buffer[..length])))
}

fn sibling_executable() -> Result<PathBuf> {
    let mut path = module_path()?;
    path.set_file_name("zicode-studio-desktop.exe");
    if !path.is_file()
        && path
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|name| name.eq_ignore_ascii_case("resources"))
    {
        path = path
            .parent()
            .and_then(|parent| parent.parent())
            .ok_or(E_FAIL)?
            .join("zicode-studio-desktop.exe");
    }
    Ok(path)
}

fn shell_text(value: &str) -> Result<PWSTR> {
    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let size = wide.len() * std::mem::size_of::<u16>();
    let ptr = unsafe { CoTaskMemAlloc(size) };
    if ptr.is_null() {
        return Err(E_FAIL.into());
    }
    unsafe { std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr.cast::<u16>(), wide.len()) };
    Ok(PWSTR(ptr.cast()))
}

#[implement(IClassFactory)]
struct SelectionFactory {
    _lifetime: Lifetime,
}
impl IClassFactory_Impl for SelectionFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<IUnknown>,
        iid: *const GUID,
        object: *mut *mut c_void,
    ) -> Result<()> {
        if outer.as_ref().is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if iid.is_null() || object.is_null() {
            return Err(E_POINTER.into());
        }
        let command: IUnknown = SelectionCommand {
            _lifetime: Lifetime::new(),
        }
        .into();
        unsafe { command.query(iid, object).ok() }
    }
    fn LockServer(&self, lock: BOOL) -> Result<()> {
        if lock.as_bool() {
            LOCKS.fetch_add(1, Ordering::AcqRel);
        } else {
            let _ = LOCKS.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1));
        }
        Ok(())
    }
}

#[no_mangle]
extern "system" fn DllMain(_instance: HINSTANCE, _reason: u32, _reserved: *mut c_void) -> BOOL {
    BOOL(1)
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    if OBJECTS.load(Ordering::Acquire) == 0 && LOCKS.load(Ordering::Acquire) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[no_mangle]
extern "system" fn DllGetClassObject(
    class_id: *const GUID,
    interface_id: *const GUID,
    object: *mut *mut c_void,
) -> HRESULT {
    catch_unwind(AssertUnwindSafe(|| {
        if object.is_null() || class_id.is_null() || interface_id.is_null() {
            return E_POINTER;
        }
        unsafe { object.write(std::ptr::null_mut()) };
        if unsafe { *class_id } != SELECTION_CLSID {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = SelectionFactory {
            _lifetime: Lifetime::new(),
        }
        .into();
        unsafe { factory.query(interface_id, object) }
    }))
    .unwrap_or(E_FAIL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHCreateShellItemArrayFromIDLists};

    #[test]
    fn rejects_nonlocal_and_duplicate_selections() {
        assert_eq!(validate_paths(vec![]), Err("selection_count"));
        assert_eq!(
            validate_paths(vec![
                PathBuf::from("relative-a"),
                PathBuf::from("relative-b")
            ]),
            Err("nonlocal_path")
        );
    }

    #[test]
    fn accepts_only_distinct_files_in_one_directory() {
        let root = std::env::temp_dir().join(format!("studio-shell-{}", std::process::id()));
        let other = root.join("other");
        fs::create_dir_all(&other).unwrap();
        let first = root.join("中文 空格&.txt");
        let second = root.join("two.txt");
        let outside = other.join("three.txt");
        fs::write(&first, b"one").unwrap();
        fs::write(&second, b"two").unwrap();
        fs::write(&outside, b"three").unwrap();
        assert_eq!(
            validate_paths(vec![first.clone(), second.clone()])
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            validate_paths(vec![first.clone(), first.clone()]),
            Err("duplicate_path")
        );
        assert_eq!(
            validate_paths(vec![first.clone(), outside.clone()]),
            Err("different_directories")
        );
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
        fs::remove_file(outside).unwrap();
        fs::remove_dir(other).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn class_factory_rejects_unknown_class() {
        let unknown = GUID::from_u128(0x12345678_1234_4234_8234_123456789abc);
        let mut object = std::ptr::null_mut();
        assert_eq!(
            DllGetClassObject(&unknown, &IClassFactory::IID, &mut object),
            CLASS_E_CLASSNOTAVAILABLE
        );
        assert!(object.is_null());
    }

    #[test]
    fn class_factory_creates_bounded_selection_command() {
        let mut object = std::ptr::null_mut();
        assert_eq!(
            DllGetClassObject(&SELECTION_CLSID, &IClassFactory::IID, &mut object),
            S_OK
        );
        let factory = unsafe { IClassFactory::from_raw(object) };
        let command: IExplorerCommand =
            unsafe { factory.CreateInstance(None::<&IUnknown>) }.unwrap();
        assert_eq!(
            unsafe { command.GetCanonicalName() }.unwrap(),
            SELECTION_CLSID
        );
        assert_eq!(
            unsafe { command.GetState(None::<&IShellItemArray>, false) }.unwrap(),
            ECS_HIDDEN.0 as u32
        );
        let title = unsafe { command.GetTitle(None::<&IShellItemArray>) }.unwrap();
        assert!(unsafe { title.to_string() }.unwrap().contains("Studio"));
        unsafe { CoTaskMemFree(Some(title.0.cast())) };
    }

    #[test]
    fn installed_class_activates_from_registered_dll_when_requested() {
        if std::env::var_os("ZICODE_TEST_SHELL_REGISTRATION").is_none() {
            return;
        }
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.unwrap();
        let command: IExplorerCommand =
            unsafe { CoCreateInstance(&SELECTION_CLSID, None, CLSCTX_INPROC_SERVER) }.unwrap();
        assert_eq!(
            unsafe { command.GetCanonicalName() }.unwrap(),
            SELECTION_CLSID
        );
        drop(command);
        unsafe { CoUninitialize() };
    }

    #[test]
    fn registered_command_reads_a_real_shell_selection_when_requested() {
        if std::env::var_os("ZICODE_TEST_SHELL_REGISTRATION").is_none() {
            return;
        }
        let root = std::env::temp_dir().join(format!("studio-shell-com-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let paths = [root.join("一.txt"), root.join("two.txt")];
        for path in &paths {
            fs::write(path, b"sample").unwrap();
        }
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.unwrap();
        let command: IExplorerCommand =
            unsafe { CoCreateInstance(&SELECTION_CLSID, None, CLSCTX_INPROC_SERVER) }.unwrap();
        let wide: Vec<Vec<u16>> = paths
            .iter()
            .map(|path| {
                path.as_os_str()
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect()
            })
            .collect();
        let pidls: Vec<_> = wide
            .iter()
            .map(|path| unsafe { ILCreateFromPathW(PCWSTR(path.as_ptr())) })
            .collect();
        assert!(pidls.iter().all(|pidl| !pidl.is_null()));
        let selection = unsafe {
            SHCreateShellItemArrayFromIDLists(
                &pidls
                    .iter()
                    .map(|pidl| *pidl as *const _)
                    .collect::<Vec<_>>(),
            )
        }
        .unwrap();
        for pidl in pidls {
            unsafe { ILFree(Some(pidl)) };
        }
        assert_eq!(
            unsafe { command.GetState(&selection, true) }.unwrap(),
            ECS_ENABLED.0 as u32
        );
        assert_eq!(
            unsafe { command.GetState(&selection, false) }
                .unwrap_err()
                .code(),
            E_PENDING
        );
        let invoked = std::env::var_os("ZICODE_TEST_SHELL_INVOKE").is_some();
        if invoked {
            unsafe { command.Invoke(&selection, None::<&IBindCtx>) }.unwrap();
            // Keep the selected files alive while the launched Studio process
            // validates the handoff. This gated smoke path is not a UI test.
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
        drop(selection);
        drop(command);
        unsafe { CoUninitialize() };
        for path in paths {
            fs::remove_file(path).unwrap();
        }
        if invoked {
            // The launched app may create workspace metadata. Preserve it for
            // inspection instead of recursively deleting unknown content.
            eprintln!("Shell smoke workspace retained: {}", root.display());
        } else {
            fs::remove_dir(root).unwrap();
        }
    }
}
