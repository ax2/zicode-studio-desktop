use super::Result;
use image::{
    codecs::{png::PngDecoder, webp::WebPDecoder},
    ImageFormat, ImageReader, Limits,
};
use std::{
    env, fs,
    io::{Cursor, Read},
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
};
use windows_sys::Win32::System::JobObjects::*;

pub(super) const INPUT: u64 = 24 * 1024 * 1024;
pub(super) const OUTPUT: u64 = 512 * 1024;
pub(super) const TIME_LIMIT: Duration = Duration::from_secs(10);

#[path = "restore_worker.rs"]
mod restore;
pub(super) use restore::{decode_batch, restore_thumbnails};

pub fn read_input(path: &Path) -> Result<Vec<u8>> {
    read_input_file(open_input(path)?)
}

pub fn open_input(path: &Path) -> Result<fs::File> {
    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || metadata.len() > INPUT
    {
        return Err("expected a regular image file of at most 24 MiB".into());
    }
    Ok(file)
}

pub fn read_input_file(file: fs::File) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(INPUT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > INPUT {
        return Err("image exceeds 24 MiB".into());
    }
    Ok(bytes)
}

pub fn decode(input: &Path, output: &Path) -> Result<()> {
    std::io::stdin().read_exact(&mut [0])?;
    decode_image(input, output)
}

fn decode_image(input: &Path, output: &Path) -> Result<()> {
    let bytes = read_input(input)?;
    let image = decode_static(&bytes)?.thumbnail(256, 256).to_rgba8();
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    image.write_to(&mut file, ImageFormat::Png)?;
    file.sync_all()?;
    Ok(())
}

pub(super) fn decode_static(bytes: &[u8]) -> Result<image::DynamicImage> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let format = reader.format().ok_or("unrecognized image")?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("unsupported image format".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = reader;
    let animated = match format {
        ImageFormat::Png => {
            PngDecoder::with_limits(Cursor::new(bytes), limits.clone())?.is_apng()?
        }
        ImageFormat::WebP => WebPDecoder::new(Cursor::new(bytes))?.has_animation(),
        _ => false,
    };
    if animated {
        return Err("animated images are unsupported".into());
    }
    reader.limits(limits);

    Ok(reader.decode()?)
}

pub fn generate(input: &Path, output: &Path) -> Result<()> {
    let mut command = crate::process_command::new_command(env::current_exe()?);
    command
        .arg("--zicode-visual-assets-worker")
        .arg(input)
        .arg(output);
    run_single(command, TIME_LIMIT)?;
    if fs::metadata(output)?.len() > OUTPUT {
        return Err("image worker rejected input or exceeded its output limit".into());
    }
    Ok(())
}

pub(super) fn run_single(command: Command, time_limit: Duration) -> Result<()> {
    run_single_with_checkpoint(command, time_limit, &|| Ok(()))
}

pub(super) fn run_single_with_checkpoint(
    mut command: Command,
    time_limit: Duration,
    checkpoint: &impl Fn() -> Result<()>,
) -> Result<()> {
    use std::io::Write;
    command.stdout(Stdio::null());
    let (mut child, job) = start_restricted(command)?;
    let result = (|| {
        child
            .stdin
            .take()
            .ok_or("missing worker gate")?
            .write_all(&[1])?;
        let deadline = Instant::now() + time_limit;
        let mut next_checkpoint = Instant::now() + Duration::from_millis(250);
        loop {
            if let Some(status) = child.try_wait()? {
                return if status.success() {
                    Ok(())
                } else {
                    Err("image worker rejected input or exceeded its output limit".into())
                };
            }
            if Instant::now() >= deadline {
                return Err("image worker timed out".into());
            }
            if Instant::now() >= next_checkpoint {
                checkpoint()?;
                next_checkpoint = Instant::now() + Duration::from_millis(250);
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    drop(job);
    child.wait()?;
    result
}

fn start_restricted(mut command: Command) -> Result<(Child, OwnedHandle)> {
    let job = unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let job = OwnedHandle::from_raw_handle(handle);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        info.BasicLimitInformation.ActiveProcessLimit = 1;
        info.ProcessMemoryLimit = 256 * 1024 * 1024;
        if SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&info) as u32,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        job
    };
    let mut child = command
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    if unsafe { AssignProcessToJobObject(job.as_raw_handle(), child.as_raw_handle()) } == 0 {
        let error = std::io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    Ok((child, job))
}
