use super::*;
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, KeyUsagePurpose};
use rusqlite::{params, Connection};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
};
const MSG:&str="From: Fixture <sender@example.test>\r\nReply-To: reply@example.test\r\nSubject: =?UTF-8?B?5rWL6K+V?=\r\nMessage-ID: <original@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n5L2g5aW9\r\n--fixture\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>HTML fixture</p>\r\n--fixture\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=proof.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nAP8BAg==\r\n--fixture--\r\n";
const LARGE_ATTACHMENT: usize = 5*1024*1024 + 13;
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
    fixture_with_search(smtp,drop_final,count,stride,false)
}
fn fixture_with_search(smtp: bool, drop_final: bool, count:u32, stride:u32, reject_search:bool) -> Fixture {
    fixture_with_headers(smtp, drop_final, count, stride, reject_search, Vec::new())
}
fn fixture_with_headers(
    smtp: bool,
    drop_final: bool,
    count: u32,
    stride: u32,
    reject_search: bool,
    headers: Vec<(u32, String)>,
) -> Fixture {
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
            serve_imap(&mut s, count, stride, reject_search, headers, tx)
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
fn serve_imap(
    s: &mut Server,
    count: u32,
    stride: u32,
    reject_search: bool,
    headers: Vec<(u32, String)>,
    trace: std::sync::mpsc::Sender<String>,
) {
    let default_header = &MSG[..MSG.find("\r\n\r\n").unwrap() + 4];
    let header_for = |uid| {
        headers
            .iter()
            .find(|(id, _)| *id == uid)
            .map_or(default_header, |(_, header)| {
                &header[..header.len().min(MAX_HEADER)]
            })
    };
    let mut archive = false;
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
        } else if upper.starts_with("LIST ") {
            trace.send(upper.clone()).unwrap();
            emit(s, &format!("* LIST () \"/\" inbox\r\n* LIST (\\Noselect) \"/\" Parent\r\n* LIST () \"/\" \"Parent/&bUuL1Q- &- Notes\"\r\n{tag} OK folders\r\n"));
        } else if upper == "LOGOUT" {
            emit(s, &format!("* BYE\r\n{tag} OK logout\r\n"));
            break;
        } else if upper.starts_with("EXAMINE ") {
            archive = upper.contains("ARCHIVE");
            emit(s,&format!("* {count} EXISTS\r\n* OK [UIDVALIDITY 7] stable\r\n{tag} OK [READ-ONLY] examined\r\n"));
        } else if let Some(probe) = upper.strip_prefix("UID SEARCH UID ") {
            trace.send(upper.clone()).unwrap();
            if reject_search {
                emit(s,&format!("{tag} NO temporarily unavailable\r\n"));
                continue;
            }
            let mut response = String::from("* SEARCH");
            for uid in probe.split(',').map(|v| v.parse::<u32>().unwrap()) {
                if uid > 0 && uid.is_multiple_of(stride) && uid / stride <= count {
                    response.push_str(&format!(" {uid}"));
                }
            }
            emit(s,&format!("{response}\r\n{tag} OK searched\r\n"));
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
            if upper.contains("BODYSTRUCTURE") {
                let header = header_for(a);
                let tree=format!(r#"((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "BASE64" 8 1)("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "8BIT" 19 1) "ALTERNATIVE")("APPLICATION" "OCTET-STREAM" NIL NIL NIL "BASE64" 8 NIL ("ATTACHMENT" ("FILENAME" "proof.bin")))("APPLICATION" "OCTET-STREAM" NIL NIL NIL "BINARY" {} NIL ("ATTACHMENT" ("FILENAME" "large.bin"))) "MIXED")"#,LARGE_ATTACHMENT);
                emit(s,&format!("* 3 FETCH (UID {a} RFC822.SIZE {} BODYSTRUCTURE {tree} BODY[HEADER]<0> {{{}}}\r\n{header})\r\n{tag} OK fetched\r\n",MSG.len()+LARGE_ATTACHMENT,header.len()));
                continue;
            }
            if upper.starts_with("UID FETCH") && upper.contains("BODY.PEEK[") && !upper.contains("[HEADER]") {
                let section=upper.split("BODY.PEEK[").nth(1).unwrap().split(']').next().unwrap();
                let data=match section {"1.1"=>if archive {"T3RoZXI="} else {"5L2g5aW9"}.to_owned(),"1.2"=>"<p>HTML fixture</p>".to_owned(),"2"=>if archive {"QkJCQg=="} else {"AP8BAg=="}.to_owned(),"3"=>"Z".repeat(LARGE_ATTACHMENT),other=>panic!("Unexpected payload fetch {other}")};
                emit(s,&format!("* 3 FETCH (UID {a} BODY[{section}]<0> {{{}}}\r\n{data})\r\n{tag} OK fetched\r\n",data.len()));
                continue;
            }
            let header = upper.contains("[HEADER]");
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
                    let bytes = if header { header_for(uid) } else { MSG };
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
fn tls_imap_clipped_headers_keep_messages_and_never_supply_a_partial_reply_address() {
    let mut db = database();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    let headers = || {
        let mut exact_header = String::from(
            "From: sender@example.test\r\nReply-To: exact@example.test\r\nSubject: Exact header\r\nX-Folded: body",
        );
        let padding = MAX_HEADER - exact_header.len() - 4;
        let folded_line = format!("\r\n {}", "x".repeat(61));
        exact_header.push_str(&folded_line.repeat(padding / 64));
        exact_header.push_str(&"x".repeat(padding % 64));
        exact_header.push_str("\r\n\r\n");
        assert_eq!(exact_header.len(), MAX_HEADER);
        vec![
            (
                40,
                format!(
                    "From: sender@example.test\r\nSubject: Large header\r\nReply-To: partial@example.test,\r\n{}\r\n",
                    " extra@example.test,\r\n".repeat(4000)
                ),
            ),
            (
                30,
                format!(
                    "To: contact@example.test,\r\n{}From: later@example.test\r\n\r\n",
                    "\tmore@example.test,\r\n".repeat(4000)
                ),
            ),
            (20, exact_header),
        ]
    };
    let current = fixture_with_headers(false, false, 4, 10, false, headers());
    let page = mail.sync(&current.adapter, "synthetic", None, 3);
    current.thread.join().unwrap();
    let page = page.unwrap();
    assert_eq!(
        page.messages.iter().map(|message| message.uid).collect::<Vec<_>>(),
        [40, 30, 20]
    );
    assert_eq!(page.messages[0].subject, "Large header");
    assert_eq!(page.messages[0].sender, "sender@example.test");
    assert!(page.messages[0].reply_to.is_empty());
    assert!(page.messages[0].header_limited);
    assert!(page.messages[1].sender.is_empty());
    assert!(page.messages[1].reply_to.is_empty());
    assert!(page.messages[1].header_limited);
    assert_eq!(page.messages[2].reply_to, "exact@example.test");
    assert!(!page.messages[2].header_limited);
    assert_eq!(
        current.rx.try_iter().collect::<Vec<_>>(),
        ["FETCH 2:4 (UID RFC822.SIZE BODY.PEEK[HEADER]<0.65536>)"]
    );
    assert!(matches!(
        mail.reply_draft("partial", 7, 40),
        Err("mail_invalid_reply")
    ));

    let older = fixture_with_headers(false, false, 4, 10, false, headers());
    let next = mail.sync(&older.adapter, "synthetic", page.next, 3).unwrap();
    older.thread.join().unwrap();
    assert_eq!(next.messages[0].uid, 10);
    assert_eq!(next.messages[0].reply_to, "reply@example.test");
    assert!(!next.messages[0].header_limited);

    let detail = fixture_with_headers(false, false, 4, 10, false, headers());
    let letter = mail.read(&detail.adapter, "synthetic", 7, 40).unwrap();
    detail.thread.join().unwrap();
    assert_eq!(letter.text.trim(), "你好");
    assert_eq!(letter.summary.subject, "Large header");
    assert!(letter.summary.header_limited);
    assert!(letter.summary.reply_to.is_empty());
    let cached = mail.cached_body(7, 40).unwrap();
    assert!(cached.summary.header_limited);
    assert!(cached.summary.reply_to.is_empty());
    assert!(detail
        .rx
        .try_iter()
        .next()
        .unwrap()
        .contains("BODY.PEEK[HEADER]<0.65536>"));
}
#[test]
fn same_uid_and_validity_have_independent_folder_bodies() {
    let mut db = database();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    for (folder, expected) in [("INBOX","你好"), ("Archive","Other")] {
        mail.select_folder(folder).unwrap();
        let f = fixture(false,false);
        mail.sync(&f.adapter,"synthetic",None,2).unwrap();
        f.thread.join().unwrap();
        let f = fixture(false,false);
        assert_eq!(mail.read(&f.adapter,"synthetic",7,30).unwrap().text,expected);
        f.thread.join().unwrap();
    }
    for (folder, expected) in [("Archive","Other"),("INBOX","你好")] {
        mail.select_folder(folder).unwrap();
        assert_eq!(mail.cached_body(7,30).unwrap().text,expected);
        let attachment=mail.cached_body(7,30).unwrap().attachments.remove(0);
        let f=fixture(false,false);
        let bytes=f.adapter.attachment(mail.address(),"synthetic",mail.folder(),7,30,&attachment).unwrap();
        f.thread.join().unwrap();
        assert_eq!(bytes,if folder=="Archive" {[66,66,66,66]} else {[0,255,1,2]});

        let wrong = if folder == "INBOX" { Some("Archive".into()) } else { None };
        assert!(matches!(mail.cached_page(Some(Cursor {folder:wrong,uid_validity:7,before:30}),2), Err("mail_inbox_changed")));
    }
}
#[test]
fn folders_survive_restart_decode_names_and_clear_with_the_account() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mail.sqlite3");
    {
        let mut db = Connection::open(&path).unwrap();
        seed(&db);
        let mail = Mailbox::open(&mut db, "one", "a").unwrap();
        assert!(mail.cached_folders().unwrap().is_empty());
        let f = fixture(false, false);
        let list = mail.folders(&f.adapter, "synthetic").unwrap();
        f.thread.join().unwrap();
        assert_eq!(f.rx.try_iter().count(), 1);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "INBOX");
        assert_eq!(list[1].id, "Parent/&bUuL1Q- &- Notes");
        assert_eq!(list[1].name, "Parent/测试 & Notes");
    }
    let mut db = Connection::open(path).unwrap();
    let mail = Mailbox::open(&mut db, "one", "a").unwrap();
    assert_eq!(mail.cached_folders().unwrap().len(), 2);
    let mut second = Connection::open(temp.path().join("mail.sqlite3")).unwrap();
    Mailbox::open(&mut second, "one", "a").unwrap().clear_cache().unwrap();
    let f = fixture(false, false);
    assert!(matches!(mail.folders(&f.adapter, "synthetic"), Err("mail_cache_changed")));
    f.thread.join().unwrap();
    assert!(mail.cached_folders().unwrap().is_empty());
}
#[test]
fn burst_of_new_mail_resumes_after_database_reopen_without_fetching_uncached_history() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mail.sqlite3");
    {
        let mut db = Connection::open(&path).unwrap();
        seed(&db);
        let mut mail = Mailbox::open(&mut db,"one","a").unwrap();
        let f = sized_fixture(false,false,5,10);
        assert!(!mail.sync(&f.adapter,"synthetic",None,2).unwrap().pending);
        f.thread.join().unwrap();
        let f = sized_fixture(false,false,12,10);
        let latest = mail.sync(&f.adapter,"synthetic",None,2).unwrap();
        f.thread.join().unwrap();
        assert!(latest.pending);
        assert_eq!(latest.messages.iter().map(|m|m.uid).collect::<Vec<_>>(),[120,110]);
        let f = sized_fixture(false,false,12,10);
        assert!(mail.catch_up(&f.adapter,"synthetic",2).unwrap());
        f.thread.join().unwrap();
    }
    let mut db = Connection::open(&path).unwrap();
    let mut mail = Mailbox::open(&mut db,"one","a").unwrap();
    // More mail arrived while the program was closed. A new refresh adds the
    // second interval and must retain the saved position in the first one.
    let f = sized_fixture(false,false,16,10);
    assert!(mail.sync(&f.adapter,"synthetic",None,2).unwrap().pending);
    f.thread.join().unwrap();
    for expect_pending in [true,true,true,false] {
        let f = sized_fixture(false,false,16,10);
        assert_eq!(mail.catch_up(&f.adapter,"synthetic",2).unwrap(),expect_pending);
        f.thread.join().unwrap();
    }
    let ids:Vec<_> = mail.cached_page(None,40).unwrap().messages.iter().map(|m|m.uid).collect();
    assert_eq!(ids,[160,150,140,130,120,110,100,90,80,70,60,50,40]);
}
#[test]
fn refresh_reconciles_removed_old_uids_without_fetching_old_headers() {
    let mut db = database();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    // Initially cache 10,20,30,40, including the body of 30.
    let f = sized_fixture(false,false,4,10);
    mail.sync(&f.adapter,"synthetic",None,4).unwrap();
    f.thread.join().unwrap();
    let f = fixture(false,false);
    mail.read(&f.adapter,"synthetic",7,30).unwrap();
    f.thread.join().unwrap();
    // New mailbox contains 20,40,60,80. Refreshing just two headers must
    // preserve surviving older UIDs and evict old cached bodies for 10 and 30.
    let failed = fixture_with_search(false,false,4,20,true);
    assert!(matches!(mail.sync(&failed.adapter,"synthetic",None,2), Err("mail_list_failed")));
    failed.thread.join().unwrap();
    assert_eq!(mail.cached_page(None,8).unwrap().messages[0].uid,40);
    assert!(mail.cached_body(7,30).is_ok());
    for _ in 0..2 {
        let f = sized_fixture(false,false,4,20);
        mail.sync(&f.adapter,"synthetic",None,2).unwrap();
        f.thread.join().unwrap();
        let commands: Vec<_> = f.rx.try_iter().collect();
        assert_eq!(commands.iter().filter(|c| c.contains("HEADER")).count(), 1);
        assert!(commands.iter().any(|c| c.starts_with("UID SEARCH UID ")));
        let ids: Vec<_> = mail.cached_page(None,8).unwrap().messages.iter().map(|m|m.uid).collect();
        assert_eq!(ids,[80,60,40,20]);
        assert!(matches!(mail.cached_body(7,30), Err("mail_cache_empty")));
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
                folder: None,
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
    db.execute_batch("CREATE TABLE accounts(scope TEXT,id TEXT,provider TEXT,address TEXT);CREATE TABLE drafts(scope TEXT,account TEXT,id TEXT,revision INTEGER,recipient TEXT,subject TEXT,body TEXT,PRIMARY KEY(scope,account,id));
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
    assert_eq!(
        l.html.as_deref().map(str::trim),
        Some("<p>HTML fixture</p>")
    );
    assert_eq!(l.summary.reply_to, "reply@example.test");
    let read_commands: Vec<_>=f.rx.try_iter().collect();
    assert!(read_commands.iter().any(|q|q.contains("BODYSTRUCTURE")));
    assert!(read_commands.iter().all(|q|!q.contains("BODY.PEEK[2]") && !q.contains("BODY.PEEK[3]") && !q.contains("BODY.PEEK[]")));
    assert_eq!(l.attachments[1].size,LARGE_ATTACHMENT);
    let large=fixture(false,false);
    let bytes=large.adapter.attachment(mail.address(),"synthetic","INBOX",7,30,&l.attachments[1]).unwrap();
    large.thread.join().unwrap();
    assert_eq!(bytes.len(),LARGE_ATTACHMENT);
    assert!(bytes.iter().all(|b|*b==b'Z'));
    let commands:Vec<_>=large.rx.try_iter().collect();
    assert_eq!(commands.len(),2);
    assert!(commands[1].contains("BODY.PEEK[3]"));
    let item=&l.attachments[0];
    assert_eq!((&item.name,item.size),(&"proof.bin".to_owned(),8));
    let f=fixture(false,false);
    assert_eq!(f.adapter.attachment(mail.address(),"synthetic","INBOX",7,30,item).unwrap(),[0,255,1,2]);
    f.thread.join().unwrap();
    assert!(matches!(
        mail.sync(
            &Alibaba::default(),
            "synthetic",
            Some(Cursor {
                folder: None,
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
    let cached = mail.cached_body(7, 30).unwrap();
    assert_eq!(cached.text.trim(), "你好");
    assert_eq!(cached.attachments[0].name,"proof.bin");
    assert_eq!(
        cached.html.as_deref().map(str::trim),
        Some("<p>HTML fixture</p>")
    );
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
        db.execute_batch(DRAFT_ATTACHMENT_SCHEMA).unwrap();
        db.execute("INSERT INTO draft_attachments VALUES('one','a','d','x','proof.bin',?)", [vec![0u8,255,13,10]]).unwrap();
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
        let parsed = mail_parser::MessageParser::new().parse(body.as_bytes()).unwrap();
        let files: Vec<_> = parsed.attachments().collect();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].decoded().as_ref(), &[0, 255, 13, 10]);
        assert_eq!(files[0].attachment_name(), Some("proof.bin"));
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

#[test]
fn saved_reply_keeps_original_message_id_after_database_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mail.sqlite3");
    let mut db = Connection::open(&path).unwrap();
    seed(&db);
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    let f = fixture(false, false);
    mail.sync(&f.adapter, "synthetic", None, 2).unwrap();
    f.thread.join().unwrap();
    let draft = mail.reply_draft("reply-draft", 7, 30).unwrap();
    assert_eq!(draft["recipient"], "reply@example.test");
    assert_eq!(draft["subject"], "Re: 测试");
    drop(mail);
    db.execute("UPDATE drafts SET body='written after reopening',revision=2 WHERE scope='one' AND account='a' AND id='reply-draft'",[]).unwrap();
    drop(db);
    let mut db = Connection::open(&path).unwrap();
    let mut mail = Mailbox::open(&mut db, "one", "a").unwrap();
    let f = fixture(true, false);
    assert_eq!(
        mail.send(&f.adapter, "synthetic", "reply-draft", 2, true, None)
            .unwrap(),
        "accepted"
    );
    f.thread.join().unwrap();
    let body = f.rx.recv().unwrap();
    assert!(body.contains("In-Reply-To: <original@example.test>"));
    db.execute("DELETE FROM drafts WHERE id='reply-draft'", [])
        .unwrap();
    let links: i32 = db
        .query_row("SELECT COUNT(*) FROM alibaba_reply", [], |r| r.get(0))
        .unwrap();
    assert_eq!(links, 0);
}

#[test]
fn disconnect_cache_rejects_stale_sync_and_preserves_drafts_and_journal() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("mail.sqlite3");
    let mut db = Connection::open(&file).unwrap();
    seed(&db);
    let mut old = Mailbox::open(&mut db, "one", "a").unwrap();
    let mut other = Connection::open(&file).unwrap();
    other.execute_batch("INSERT INTO alibaba_epoch(scope,account,epoch,folder) VALUES ('one','a',2,'INBOX'),('two','b',2,'INBOX');
        INSERT INTO alibaba_inbox(scope,account,epoch,uid,meta,body,folder) VALUES ('one','a',2,42,'{}','selected','INBOX'),('two','b',2,42,'{}','other','INBOX');
        INSERT INTO alibaba_send VALUES ('one','a','d',1,'unknown');").unwrap();
    Mailbox::open(&mut other, "one", "a")
        .unwrap()
        .clear_cache()
        .unwrap();
    let remote = fixture(false, false);
    assert_eq!(
        old.sync(&remote.adapter, "synthetic", None, 2)
            .err()
            .unwrap(),
        "mail_inbox_changed"
    );
    remote.thread.join().unwrap();
    drop(other);
    drop(db);
    let reopened = Connection::open(&file).unwrap();
    for (sql, expected) in [
        ("SELECT count(*) FROM alibaba_inbox WHERE scope='one'", 0),
        ("SELECT count(*) FROM alibaba_epoch WHERE scope='one'", 0),
        ("SELECT count(*) FROM alibaba_inbox WHERE scope='two'", 1),
        (
            "SELECT count(*) FROM drafts WHERE scope='one' AND account='a'",
            1,
        ),
        (
            "SELECT count(*) FROM alibaba_send WHERE status='unknown'",
            1,
        ),
    ] {
        assert_eq!(
            reopened
                .query_row(sql, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            expected
        );
    }
}
