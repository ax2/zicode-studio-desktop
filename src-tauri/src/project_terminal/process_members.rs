//! Windows can remove a process from job accounting before its handle is signaled.
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::time::Instant;
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_INVALID_PARAMETER, ERROR_MORE_DATA, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

const UNCONFIRMED: &str = "terminal_process_group_unconfirmed";
const TIMEOUT: &str = "terminal_process_group_exit_timeout";

fn accounting(job: HANDLE) -> Result<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, &'static str> {
    let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            std::mem::size_of_val(&info) as u32,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(UNCONFIRMED)
    } else {
        Ok(info)
    }
}

pub(super) struct Members {
    handles: Vec<OwnedHandle>,
    total: u32,
}

impl Members {
    pub(super) fn capture(job: HANDLE) -> Result<Self, &'static str> {
        let counters = accounting(job)?;
        let header = std::mem::offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList);
        let mut capacity = (counters.ActiveProcesses as usize).max(8);
        loop {
            let bytes = capacity
                .checked_mul(size_of::<usize>())
                .and_then(|n| n.checked_add(header))
                .and_then(|n| u32::try_from(n).ok())
                .ok_or(UNCONFIRMED)?;
            let mut storage = vec![0usize; bytes as usize / size_of::<usize>()];
            let list = storage
                .as_mut_ptr()
                .cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
            let ok = unsafe {
                QueryInformationJobObject(
                    job,
                    JobObjectBasicProcessIdList,
                    list.cast(),
                    bytes,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 && unsafe { GetLastError() } != ERROR_MORE_DATA {
                return Err(UNCONFIRMED);
            }
            let count = unsafe { (*list).NumberOfProcessIdsInList } as usize;
            let assigned = unsafe { (*list).NumberOfAssignedProcesses } as usize;
            if ok == 0 || count < assigned {
                capacity = capacity.checked_mul(2).ok_or(UNCONFIRMED)?.max(assigned);
                continue;
            }
            let ids = storage
                .get(header / size_of::<usize>()..)
                .and_then(|ids| ids.get(..count))
                .ok_or(UNCONFIRMED)?;
            let mut handles = Vec::with_capacity(count);
            for &id in ids {
                let raw = unsafe {
                    OpenProcess(
                        PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                        0,
                        u32::try_from(id).map_err(|_| UNCONFIRMED)?,
                    )
                };
                if raw.is_null() {
                    // A PID which is no longer valid has already exited.
                    if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                        continue;
                    }
                    return Err(UNCONFIRMED);
                }
                let owner = unsafe { OwnedHandle::from_raw_handle(raw) };
                let mut belongs = 0;
                if unsafe { IsProcessInJob(raw, job, &mut belongs) } == 0 {
                    return Err(UNCONFIRMED);
                }
                if belongs != 0 {
                    handles.push(owner);
                }
            }
            return Ok(Self {
                handles,
                total: counters.TotalProcesses,
            });
        }
    }

    pub(super) fn wait(&self, deadline: Instant) -> Result<(), &'static str> {
        for handle in &self.handles {
            wait_for_process(handle.as_raw_handle(), deadline)?;
        }
        Ok(())
    }

    pub(super) fn active_processes(&self, job: HANDLE) -> Result<u32, ()> {
        let info = accounting(job).map_err(|_| ())?;
        // A process admitted during the snapshot has no guaranteed handle witness.
        if info.TotalProcesses != self.total {
            return Err(());
        }
        Ok(info.ActiveProcesses)
    }
}

fn wait_for_process(handle: HANDLE, deadline: Instant) -> Result<(), &'static str> {
    let ms = deadline
        .saturating_duration_since(Instant::now())
        .as_millis() as u32;
    match unsafe { WaitForSingleObject(handle, ms) } {
        WAIT_OBJECT_0 => Ok(()),
        WAIT_TIMEOUT => Err(TIMEOUT),
        _ => Err(UNCONFIRMED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Stdio};
    use std::time::Duration;

    struct FixtureChild(Child);
    impl Drop for FixtureChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn retains_exit_witnesses_and_rejects_an_unobserved_member() {
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        assert!(!raw.is_null());
        let job = unsafe { OwnedHandle::from_raw_handle(raw) };
        let launch = || {
            let shell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                .join("System32/cmd.exe");
            let child = FixtureChild(
                crate::process_command::new_command(shell)
                    .args(["/d", "/q", "/c", "set /p fixture="])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
            assert_ne!(
                unsafe { AssignProcessToJobObject(job.as_raw_handle(), child.0.as_raw_handle()) },
                0
            );
            child
        };
        let first = launch();
        let partial = Members::capture(raw).unwrap();
        assert_eq!(partial.wait(Instant::now()), Err(TIMEOUT));
        let second = launch();
        assert!(partial.active_processes(raw).is_err());
        let both = Members::capture(raw).unwrap();
        assert_eq!(both.handles.len(), 2);
        assert_ne!(unsafe { TerminateJobObject(raw, 1) }, 0);
        let deadline = Instant::now() + Duration::from_secs(3);
        both.wait(deadline).unwrap();
        assert_eq!(both.active_processes(raw), Ok(0));
        for child in [first, second] {
            assert_eq!(
                unsafe { WaitForSingleObject(child.0.as_raw_handle(), 0) },
                WAIT_OBJECT_0
            );
        }
    }
}
