//! Reuse one restricted decoder for a bounded group of staged originals.
use super::{decode_image, start_restricted, Result, OUTPUT, TIME_LIMIT};
use std::{
    env, fs,
    io::{self, Read, Write},
    os::windows::{fs::MetadataExt, io::OwnedHandle},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    thread::{self, JoinHandle},
};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

const MAX_IMAGES: usize = 16;
const ACK: u8 = 1;

fn valid_digest(digest: &[u8]) -> bool {
    digest.len() == 64
        && digest
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn read_digest(input: &mut impl Read) -> Result<Option<[u8; 64]>> {
    let mut request = [0u8; 65];
    if input.read(&mut request[..1])? == 0 {
        return Ok(None);
    }
    input.read_exact(&mut request[1..])?;
    if request[64] != b'\n' || !valid_digest(&request[..64]) {
        return Err("invalid restore worker request".into());
    }
    Ok(Some(request[..64].try_into()?))
}

pub(crate) fn decode_batch(stage: &Path) -> Result<()> {
    if !stage.is_absolute() {
        return Err("restore worker requires an absolute stage".into());
    }
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    for _ in 0..MAX_IMAGES {
        let Some(request) = read_digest(&mut input)? else {
            return Ok(());
        };
        let digest = std::str::from_utf8(&request)?;
        decode_image(
            &stage.join(format!("{digest}.blob")),
            &stage.join(format!("{digest}.png")),
        )?;
        output.write_all(&[ACK])?;
        output.flush()?;
    }
    Ok(())
}

struct Worker {
    child: Child,
    job: Option<OwnedHandle>,
    requests: Option<SyncSender<[u8; 65]>>,
    replies: Option<Receiver<u8>>,
    reader: Option<JoinHandle<()>>,
}

impl Worker {
    fn start(stage: &Path) -> Result<Self> {
        let mut command = Command::new(env::current_exe()?);
        command
            .arg("--zicode-visual-assets-restore-worker")
            .arg(stage)
            .stdout(Stdio::piped());
        let (mut child, job) = start_restricted(command)?;
        let mut input = child.stdin.take().ok_or("missing restore worker input")?;
        let mut output = child.stdout.take().ok_or("missing restore worker output")?;
        let (sender, replies) = mpsc::sync_channel(1);
        let (requests, receiver) = mpsc::sync_channel::<[u8; 65]>(1);
        let reader = thread::Builder::new().spawn(move || {
            let mut reply = [0u8];
            while let Ok(request) = receiver.recv() {
                if input.write_all(&request).is_err()
                    || output.read_exact(&mut reply).is_err()
                    || sender.send(reply[0]).is_err()
                {
                    break;
                }
            }
        })?;
        Ok(Self {
            child,
            job: Some(job),
            requests: Some(requests),
            replies: Some(replies),
            reader: Some(reader),
        })
    }

    fn generate(&mut self, digest: &str, output: &Path) -> Result<()> {
        let mut request = [b'\n'; 65];
        request[..64].copy_from_slice(digest.as_bytes());
        self.requests
            .as_ref()
            .ok_or("missing restore worker requests")?
            .send(request)
            .map_err(|_| "image worker rejected input or exceeded its output limit")?;
        let reply = self
            .replies
            .as_ref()
            .ok_or("missing restore worker replies")?
            .recv_timeout(TIME_LIMIT);
        match reply {
            Ok(ACK) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => return Err("image worker timed out".into()),
            _ => return Err("image worker rejected input or exceeded its output limit".into()),
        }
        let metadata = fs::symlink_metadata(output)?;
        if !metadata.is_file()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || metadata.len() == 0
            || metadata.len() > OUTPUT
        {
            return Err("invalid restore worker output".into());
        }
        Ok(())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        drop(self.requests.take());
        drop(self.replies.take());
        drop(self.job.take());
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

pub(crate) fn restore_thumbnails() -> impl FnMut(&Path, &Path) -> Result<()> {
    let mut worker = None;
    let mut remaining = 0;
    move |input, output| {
        let stage = input.parent().ok_or("missing restore stage")?;
        let digest = input
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or("invalid staged original")?;
        if !valid_digest(digest.as_bytes())
            || input.extension().and_then(|value| value.to_str()) != Some("blob")
            || output != stage.join(format!("{digest}.png"))
        {
            return Err("invalid restore thumbnail paths".into());
        }
        if remaining == 0 {
            drop(worker.take());
            worker = Some(Worker::start(stage)?);
            remaining = MAX_IMAGES;
        }
        let result = worker
            .as_mut()
            .ok_or("missing restore worker")?
            .generate(digest, output);
        if result.is_err() {
            drop(worker.take());
            remaining = 0;
        } else {
            remaining -= 1;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_complete_lowercase_digest_frames() {
        let mut input = format!("{}\n{}\n", "a".repeat(64), "0".repeat(64)).into_bytes();
        let mut stream = input.as_slice();
        assert_eq!(read_digest(&mut stream).unwrap(), Some([b'a'; 64]));
        assert_eq!(read_digest(&mut stream).unwrap(), Some([b'0'; 64]));
        assert_eq!(read_digest(&mut stream).unwrap(), None);
        input[0] = b'/';
        assert!(read_digest(&mut input.as_slice()).is_err());
        assert!(read_digest(&mut &b"partial"[..]).is_err());
        let uppercase = format!("{}\n", "A".repeat(64));
        assert!(read_digest(&mut uppercase.as_bytes()).is_err());
    }
}
