//! Lifetime-bound task processes. Closing the guard kills remaining descendants.
use std::process::Command;
use tokio::process::Child;

#[cfg(unix)]
pub struct ProcessTree(std::sync::atomic::AtomicI32);

#[cfg(unix)]
pub fn prepare(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(unix)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self, String> {
        child
            .id()
            .map(|pid| Self(std::sync::atomic::AtomicI32::new(pid as i32)))
            .ok_or_else(|| "task_process_unavailable".into())
    }
    pub fn terminate(&self) {
        // The group was created by prepare() and belongs exclusively to this task.
        let group = self.0.swap(0, std::sync::atomic::Ordering::AcqRel);
        if group != 0 {
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        }
    }
}

#[cfg(windows)]
pub struct ProcessTree(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
pub fn prepare(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
    command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
}

#[cfg(windows)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        #[link(name = "ntdll")]
        extern "system" {
            fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32;
        }
        // Child is still suspended: no script can spawn outside the job before assignment.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("task_process_group_failed".into());
            }
            let owner = OwnedHandle::from_raw_handle(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let process = child.raw_handle().ok_or("task_process_unavailable")?;
            if SetInformationJobObject(
                owner.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(owner.as_raw_handle(), process) == 0
                || NtResumeProcess(process) < 0
            {
                return Err("task_process_group_failed".into());
            }
            Ok(Self(owner))
        }
    }
    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
    }
}
