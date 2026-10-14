//! Lifetime ownership, not a filesystem/network sandbox. Native plugins remain disabled.
use std::process::{Child, Command};

#[cfg(windows)]
pub(super) struct Tree(std::os::windows::io::OwnedHandle);
#[cfg(unix)]
pub(super) struct Tree(std::cell::Cell<i32>);

pub(super) fn spawn(command: &mut Command) -> Result<(Child, Tree), ()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| ())?;
    let tree = Tree::attach(&child);
    match tree {
        Ok(tree) => Ok((child, tree)),
        Err(()) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(())
        }
    }
}

#[cfg(windows)]
impl Tree {
    fn attach(child: &Child) -> Result<Self, ()> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        #[link(name = "ntdll")]
        extern "system" {
            fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32;
        }
        // The child is suspended until assigned. No Worker code runs outside its job.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(());
            }
            let owner = OwnedHandle::from_raw_handle(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                owner.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(owner.as_raw_handle(), child.as_raw_handle()) == 0
                || NtResumeProcess(child.as_raw_handle()) < 0
            {
                return Err(());
            }
            Ok(Self(owner))
        }
    }
    pub(super) fn terminate(&self) -> Result<(), ()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        // Keep the job handle alive while confirming all owned processes exited.
        unsafe {
            if TerminateJobObject(self.0.as_raw_handle(), 1) == 0 {
                return Err(());
            }
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
            let ok = unsafe {
                QueryInformationJobObject(
                    self.0.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    std::mem::size_of_val(&info) as u32,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(());
            }
            if info.ActiveProcesses == 0 {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(());
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}

#[cfg(unix)]
impl Tree {
    fn attach(child: &Child) -> Result<Self, ()> {
        #[cfg(test)]
        eprintln!(
            "worker_group_attached pid={} pgid={} parent_pgid={} uid={} euid={}",
            child.id(),
            unsafe { libc::getpgid(child.id() as i32) },
            unsafe { libc::getpgrp() },
            unsafe { libc::getuid() },
            unsafe { libc::geteuid() }
        );
        Ok(Self(std::cell::Cell::new(child.id() as i32)))
    }
    pub(super) fn terminate(&self) -> Result<(), ()> {
        // prepare created this invocation's group. A deliberately detached process
        // is outside this lifetime mechanism; this is not hostile native isolation.
        let group = self.0.get();
        if group == 0 {
            return Ok(());
        }
        let mut interruptions = 0;
        loop {
            if unsafe { libc::kill(-group, libc::SIGKILL) } == 0 {
                self.0.set(0);
                return Ok(());
            }
            let error = std::io::Error::last_os_error();
            match error.raw_os_error() {
                // A signal may interrupt the call without changing the group.
                Some(libc::EINTR) if interruptions < 8 => {
                    interruptions += 1;
                    continue;
                }
                // The group has already exited between observing the Worker and cleanup.
                Some(libc::ESRCH) => {
                    self.0.set(0);
                    return Ok(());
                }
                _ => {
                    #[cfg(test)]
                    eprintln!(
                        "worker_group_cleanup_failed pgid={group} errno={:?} current_child_pgid={} child_alive={} group_exists={}",
                        error.raw_os_error(),
                        unsafe { libc::getpgid(group) },
                        unsafe { libc::kill(group, 0) },
                        unsafe { libc::kill(-group, 0) }
                    );
                    return Err(());
                }
            }
        }
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}
