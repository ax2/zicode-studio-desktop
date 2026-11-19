use super::*;
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, KeyUsagePurpose};
use rusqlite::{params, Connection};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
};
const MSG:&str="From: Fixture <sender@example.test>\r\nReply-To: reply@example.test\r\nSubject: =?UTF-8?B?5rWL6K+V?=\r\nMessage-ID: <original@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n5L2g5aW9\r\n";
type Server = BufReader<rustls::StreamOwned<rustls::ServerConnection, TcpStream>>;
struct Fixture {
    adapter: Alibaba,
    thread: thread::JoinHandle<()>,
    rx: std::sync::mpsc::Receiver<String>,
}
fn fixture(smtp: bool, drop_final: bool) -> Fixture {
    sized_fixture(smtp, drop_final, 3, 10)
}
fn sized_fixture(smtp: bool, drop_final: bool, count: u32, stride: u32) -> Fixture {
    let mut ca = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca.key_usages = vec![KeyUsagePurpose::KeyCertSign];
    ca.distinguished_name
        .push(rcgen::DnType::CommonName, "Synthetic mail fixture CA");
    let key = KeyPair::generate().unwrap();
    let cert = ca.self_signed(&key).unwrap();
    let leaf = KeyPair::generate().unwrap();
    let mut server = CertificateParams::new(vec!["localhost".into()]).unwrap();
    server
        .distinguished_name
        .push(rcgen::DnType::CommonName, "localhost");
    server
        .extended_key_usages
        .push(rcgen::ExtendedKeyUsagePurpose::ServerAuth);
    let leaf_cert = server.signed_by(&leaf, &cert, &key).unwrap();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![leaf_cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(leaf.serialize_der()).into(),
        )
        .unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let adapter = Alibaba {
        imap_host: "localhost".into(),
        smtp_host: "localhost".into(),
        imap_port: port,
        smtp_port: port,
        extra_root: Some(cert.der().to_vec()),
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let thread = thread::spawn(move || {
        let (tcp, _) = listener.accept().unwrap();
        tcp.set_read_timeout(Some(TIMEOUT)).unwrap();
        tcp.set_write_timeout(Some(TIMEOUT)).unwrap();
        let mut wire = rustls::StreamOwned::new(
            rustls::ServerConnection::new(Arc::new(config)).unwrap(),
            tcp,
        );
        while wire.conn.is_handshaking() {
            if wire.conn.complete_io(&mut wire.sock).is_err() {
                return;
            }
        }
        let mut s = BufReader::new(wire);
        if smtp {
            serve_smtp(&mut s, drop_final, tx)
        } else {
            serve_imap(&mut s, count, stride, tx)
        }
    });
    Fixture {
        adapter,
        thread,
        rx,
    }
}
fn line(s: &mut Server) -> String {
    let mut l = String::new();
    match s.read_line(&mut l) {
        Ok(0) | Err(_) => String::new(),
        Ok(_) => l.trim_end_matches(['\r', '\n']).into(),
    }
}
fn emit(s: &mut Server, text: &str) {
    let stream = s.get_mut();
    stream.write_all(text.as_bytes()).unwrap();
    stream.flush().unwrap();
}
fn serve_imap(s: &mut Server, count: u32, stride: u32, trace: std::sync::mpsc::Sender<String>) {
    emit(s, "* OK local synthetic IMAP\r\n");
    loop {
        let command = line(s);
        if command.is_empty() {
            break;
        }
        let (tag, cmd) = command.split_once(' ').unwrap();
        let upper = cmd.to_ascii_uppercase();
        if upper.starts_with("LOGIN ") {
            assert!(cmd.contains("synthetic"));
            emit(s, &format!("{tag} OK authenticated\r\n"));
        } else if upper.starts_with("EXAMINE ") {
            emit(s,&format!("* {count} EXISTS\r\n* OK [UIDVALIDITY 7] stable\r\n{tag} OK [READ-ONLY] examined\r\n"));
        } else if upper.starts_with("FETCH ") || upper.starts_with("UID FETCH ") {
            trace.send(upper.clone()).unwrap();
            let is_uid = upper.starts_with("UID ");
            let range = cmd
                .split_whitespace()
                .nth(if is_uid { 2 } else { 1 })
                .unwrap();
            let (a, b) = range.split_once(':').unwrap_or((range, range));
            let a = a.parse::<u32>().unwrap();
            let b = b.parse::<u32>().unwrap();
            assert!(b >= a && b - a < 40, "page must be bounded");
            let header = upper.contains("[HEADER]");
            let bytes = if header {
                &MSG[..MSG.find("\r\n\r\n").unwrap() + 4]
            } else {
                MSG
            };
            let part = if header { "HEADER" } else { "" };
            for pos in a..=b {
                if is_uid && !pos.is_multiple_of(stride) {
                    continue;
                }
                let seq = if is_uid { pos / stride } else { pos };
                if seq == 0 || seq > count {
                    continue;
                }
                let uid = seq * stride;
                if upper.ends_with("(UID)") {
                    emit(s, &format!("* {seq} FETCH (UID {uid})\r\n"));
                } else {
                    emit(s,&format!("* {seq} FETCH (UID {uid} RFC822.SIZE {} BODY[{part}]<0> {{{}}}\r\n{bytes})\r\n",MSG.len(),bytes.len()));
                }
            }
            emit(s, &format!("{tag} OK fetched\r\n"));
        } else {
            panic!("Unexpected synthetic IMAP command")
        }
    }
}
#[test]
fn million_sparse_uids_use_one_header_window_and_bounded_cursor_probes() {
    let mut db = database();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    let f = sized_fixture(false, false, 1_000_000, 4000);
    let first = mail.sync(&f.adapter, "synthetic", None, 3).unwrap();
    f.thread.join().unwrap();
    assert_eq!(
        first.messages.iter().map(|m| m.uid).collect::<Vec<_>>(),
        [4_000_000_000, 3_999_996_000, 3_999_992_000]
    );
    assert_eq!(f.rx.try_iter().count(), 1);
    let f = sized_fixture(false, false, 1_000_000, 4000);
    let second = mail.sync(&f.adapter, "synthetic", first.next, 3).unwrap();
    f.thread.join().unwrap();
    assert_eq!(second.messages[0].uid, 3_999_988_000);
    assert_eq!(f.rx.try_iter().count(), 2);
    let f = sized_fixture(false, false, 1_000_000, 4000);
    let removed = mail
        .sync(
            &f.adapter,
            "synthetic",
            Some(Cursor {
                uid_validity: 7,
                before: 2_000_000_001,
            }),
            3,
        )
        .unwrap();
    f.thread.join().unwrap();
    assert_eq!(removed.messages[0].uid, 2_000_000_000);
    let log: Vec<_> = f.rx.try_iter().collect();
    assert!(log.len() <= 22);
    assert_eq!(log.iter().filter(|op| op.contains("HEADER")).count(), 1);
}
fn serve_smtp(s: &mut Server, drop_final: bool, tx: std::sync::mpsc::Sender<String>) {
    emit(s, "220 localhost ESMTP fixture\r\n");
    loop {
        let l = line(s);
        let u = l.to_ascii_uppercase();
        if l.is_empty() {
            break;
        } else if u.starts_with("EHLO ") {
            emit(s, "250-localhost\r\n250 AUTH PLAIN\r\n")
        } else if u.starts_with("AUTH PLAIN") {
            if u == "AUTH PLAIN" {
                emit(s, "334 \r\n");
                assert!(!line(s).is_empty())
            }
            emit(s, "235 via fixture\r\n")
        } else if u.starts_with("MAIL FROM:") || u.starts_with("RCPT TO:") {
            emit(s, "250 OK\r\n")
        } else if u == "DATA" {
            emit(s, "354 End with dot\r\n");
            let mut data = String::new();
            loop {
                let l = line(s);
                if l == "." {
                    break;
                }
                data.push_str(&l);
                data.push('\n');
                if data.len() > 65536 {
                    panic!("fixture overflow")
                }
            }
            tx.send(data).unwrap();
            if drop_final {
                break;
            }
            emit(s, "250 queued\r\n")
        } else if u == "QUIT" {
            emit(s, "221 bye\r\n");
            break;
        } else {
            panic!("Unexpected synthetic SMTP command")
        }
    }
}
fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    seed(&db);
    db
}
fn seed(db: &Connection) {
    db.execute_batch("CREATE TABLE accounts(scope TEXT,id TEXT,provider TEXT,address TEXT);CREATE TABLE drafts(scope TEXT,account TEXT,id TEXT,revision INTEGER,recipient TEXT,subject TEXT,body TEXT);
    INSERT INTO accounts VALUES ('one','a','alibaba','user@example.test'),('two','b','alibaba','other@example.test'),('one','g','gmail','gmail@example.test');
    INSERT INTO drafts VALUES ('one','a','d',1,'reply@example.test','reply','synthetic reply');").unwrap();
}
#[test]
fn tls_imap_local_pagination_cache_and_identity() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("mail.sqlite3");
    let mut db = Connection::open(&file).unwrap();
    seed(&db);
    assert!(Mailbox::open(&mut db, "two", "a").is_err());
    assert!(Mailbox::open(&mut db, "one", "g").is_err());
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    let f = fixture(false, false);
    let p = mail.sync(&f.adapter, "synthetic", None, 2).unwrap();
    f.thread.join().unwrap();
    assert_eq!(
        p.messages.iter().map(|m| m.uid).collect::<Vec<_>>(),
        [30, 20]
    );
    assert_eq!(p.messages[0].subject, "测试");
    let f = fixture(false, false);
    let last = mail.sync(&f.adapter, "synthetic", p.next, 2).unwrap();
    f.thread.join().unwrap();
    assert_eq!(last.messages[0].uid, 10);
    assert!(last.next.is_none());
    let f = fixture(false, false);
    let l = mail.read(&f.adapter, "synthetic", 7, 30).unwrap();
    f.thread.join().unwrap();
    assert_eq!(l.text.trim(), "你好");
    assert_eq!(l.summary.reply_to, "reply@example.test");
    assert!(matches!(
        mail.sync(
            &Alibaba::default(),
            "synthetic",
            Some(Cursor {
                uid_validity: 3,
                before: 10
            }),
            2
        ),
        Err("mail_inbox_changed")
    ));
    drop(mail);
    drop(db);
    let mut db = Connection::open(&file).unwrap();
    let mail = Mailbox::open(&mut db, "one", "a").unwrap();
    assert_eq!(mail.cached_page(None, 1).unwrap().messages[0].uid, 30);
    assert_eq!(mail.cached_body(7, 30).unwrap().text.trim(), "你好");
    assert!(Mailbox::open(&mut db, "two", "b")
        .unwrap()
        .cached_body(7, 30)
        .is_err());
}
#[test]
fn imap_rejects_untrusted_fixture_and_hostname_mismatch() {
    let mut db = database();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    for trust in [false, true] {
        let mut f = fixture(false, false);
        if trust {
            f.adapter.imap_host = "127.0.0.1".into()
        } else {
            f.adapter.extra_root = None
        }
        assert!(matches!(
            mail.sync(&f.adapter, "synthetic", None, 2),
            Err("mail_tls")
        ));
        f.thread.join().unwrap();
    }
}
#[test]
fn smtp_confirm_revision_reply_and_no_retry_after_ambiguous_delivery() {
    for (dropped, result) in [(false, "accepted"), (true, "unknown")] {
        let mut db = database();
        let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
        assert_eq!(
            mail.send(&Alibaba::default(), "synthetic", "d", 1, false, None),
            Err("mail_confirmation_required")
        );
        assert_eq!(
            mail.send(&Alibaba::default(), "synthetic", "d", 2, true, None),
            Err("mail_draft_changed")
        );
        let f = fixture(false, false);
        mail.sync(&f.adapter, "synthetic", None, 2).unwrap();
        f.thread.join().unwrap();
        let f = fixture(true, dropped);
        assert_eq!(
            mail.send(&f.adapter, "synthetic", "d", 1, true, Some((7, 30)))
                .unwrap(),
            result
        );
        f.thread.join().unwrap();
        let body = f.rx.recv().unwrap();
        assert!(
            body.contains("In-Reply-To: <original@example.test>")
                && body.contains("synthetic reply")
        );
        // Re-open from disk state; no additional SMTP connection is possible after fixture has stopped.
        let mut reopened = Mailbox::open(&mut db, "one", "a").unwrap();
        assert_eq!(
            reopened
                .send(&f.adapter, "synthetic", "d", 1, true, None)
                .unwrap(),
            result
        );
        let count: i32 = db
            .query_row("SELECT COUNT(*) FROM alibaba_send", params![], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
