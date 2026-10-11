use super::*;
use std::io::{self, Cursor};

fn code(error: ApiError) -> String {
    error.1 .0["error"]["code"].as_str().unwrap().into()
}

#[test]
fn bounded_chunks_preserve_bytes_and_reject_changed_lengths() {
    let control = Control::new(Instant::now() + TTL);
    let bytes = vec![73; MAX_CHUNK * 3 + 7];
    assert_eq!(
        read(&mut Cursor::new(&bytes), bytes.len(), &control).unwrap(),
        bytes
    );
    assert_eq!(
        code(read(&mut Cursor::new(b"abc"), 4, &control).unwrap_err()),
        "resource_file_changed"
    );
    assert_eq!(
        code(read(&mut Cursor::new(b""), MAX_BYTES + 1, &control).unwrap_err()),
        "resource_budget_exceeded"
    );
    assert!(read(&mut Cursor::new(b""), 0, &control).unwrap().is_empty());
}

#[test]
fn cancellation_during_a_read_rejects_partial_bytes_without_another_read() {
    struct CancelReader<'a> {
        control: &'a Control,
        calls: usize,
    }
    impl Read for CancelReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.calls += 1;
            assert_eq!(self.calls, 1);
            buffer[0] = 42;
            self.control.cancel();
            Ok(1)
        }
    }
    let control = Control::new(Instant::now() + TTL);
    let mut reader = CancelReader {
        control: &control,
        calls: 0,
    };
    assert_eq!(
        code(read(&mut reader, 1, &control).unwrap_err()),
        "resource_file_read_cancelled"
    );
    assert_eq!(reader.calls, 1);
    // Even an expired cancelled operation reports cancellation, never success.
    let expired = Control::new(Instant::now());
    expired.cancel();
    assert_eq!(
        code(expired.check().unwrap_err()),
        "resource_file_read_cancelled"
    );
}

#[test]
fn deadline_is_checked_before_read_and_after_interrupted_reads() {
    struct NoRead;
    impl Read for NoRead {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            panic!("Expired work must not read")
        }
    }
    let control = Control::new(Instant::now());
    assert_eq!(
        code(read(&mut NoRead, 0, &control).unwrap_err()),
        "resource_file_read_timeout"
    );
    struct InterruptReader<'a>(&'a Control);
    impl Read for InterruptReader<'_> {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            self.0.cancel();
            Err(io::ErrorKind::Interrupted.into())
        }
    }
    let control = Control::new(Instant::now() + TTL);
    assert_eq!(
        code(read(&mut InterruptReader(&control), 0, &control).unwrap_err()),
        "resource_file_read_cancelled"
    );
    assert!(control.deadline <= Instant::now() + Duration::from_secs(30));
}
