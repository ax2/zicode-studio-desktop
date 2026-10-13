//! Serialize Windows plugin setup until its hidden IPC window exists.
//! The upstream single-instance plugin can observe its mutex before that
//! window is created and otherwise let a second process continue startup.

#[cfg(windows)]
pub(crate) struct StartupGate(windows_sys::Win32::Foundation::HANDLE);

#[cfg(not(windows))]
pub(crate) struct StartupGate;

pub(crate) fn acquire(identifier: &str) -> Result<StartupGate, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject, INFINITE};

        let name = format!("{identifier}-studio-startup-gate");
        let wide: Vec<u16> = std::ffi::OsStr::new(&name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err(format!(
                "Cannot create startup gate: {}",
                std::io::Error::last_os_error()
            ));
        }
        let result = unsafe { WaitForSingleObject(handle, INFINITE) };
        if result != WAIT_OBJECT_0 && result != WAIT_ABANDONED {
            unsafe { CloseHandle(handle) };
            return Err(format!(
                "Cannot enter startup gate: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(StartupGate(handle))
    }
    #[cfg(not(windows))]
    {
        let _ = identifier;
        Ok(StartupGate)
    }
}

#[cfg(windows)]
impl Drop for StartupGate {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::ReleaseMutex;
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}
