use super::*;

struct RecordingWriter(mpsc::Sender<Vec<u8>>);
impl Write for RecordingWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.send(bytes.to_vec()).unwrap();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn stopping_rejects_user_input_but_answers_console_queries_until_output_eof() {
    let (tx, rx) = mpsc::sync_channel(4);
    let session = Arc::new(Session {
        root: PathBuf::new(),
        workspace: "fixture".into(),
        stop: AtomicBool::new(true),
        control: tx,
        state: Mutex::new(State {
            info: Info {
                id: "fixture".into(),
                open_intent_id: None,
                workspace_id: "fixture".into(),
                directory: String::new(),
                shell: "fixture".into(),
                python_environment: None,
                status: "stopping".into(),
                cols: 80,
                rows: 24,
                exit_code: None,
                output_closed: false,
                output_end: 0,
            },
            output: Default::default(),
        }),
    });
    struct CloseOutput(Arc<Session>);
    impl Drop for CloseOutput {
        fn drop(&mut self) {
            self.0.state.lock().unwrap().info.output_closed = true;
        }
    }
    let output_guard = CloseOutput(session.clone());
    let (recorded, writes) = mpsc::channel();
    let (complete, finished) = mpsc::channel();
    let worker_session = session.clone();
    let worker = std::thread::spawn(move || {
        controls(
            Box::new(RecordingWriter(recorded)),
            rx,
            &worker_session,
            Arc::new(Mutex::new(None)),
        );
        complete.send(()).unwrap();
    });
    let (confirmation, result) = mpsc::sync_channel(1);
    session.control.send(Control::Input(b"user-command\r".to_vec(), Some(confirmation))).unwrap();
    session.control.send(Control::Input(b"\x1b[1;1R".to_vec(), None)).unwrap();
    assert_eq!(result.recv_timeout(Duration::from_secs(1)).unwrap(), Err("terminal_closed".into()));
    assert_eq!(writes.recv_timeout(Duration::from_secs(1)).unwrap(), b"\x1b[1;1R");
    assert!(matches!(finished.try_recv(), Err(mpsc::TryRecvError::Empty)));
    drop(output_guard);
    finished.recv_timeout(Duration::from_secs(1)).unwrap();
    worker.join().unwrap();
}
