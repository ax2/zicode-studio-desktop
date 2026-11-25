use super::{api, oauth, store};
use base64::Engine;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn loopback_state_pkce_wrong_state_replay_and_cancel() {
    let login = oauth::Login::bind().await.unwrap();
    let url = login.url("fixture", "me@example.test", false).unwrap();
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["scope"], oauth::READ);
    assert!(!url.as_str().contains(login.verifier.as_str()));
    assert_eq!(
        query["code_challenge"],
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(login.verifier.as_bytes()))
    );
    assert!(login
        .url("fixture", "me@example.test", true)
        .unwrap()
        .query_pairs()
        .any(|(k, v)| k == "scope" && v.contains(oauth::SEND)));
    let address = reqwest::Url::parse(&login.redirect)
        .unwrap()
        .socket_addrs(|| None)
        .unwrap()[0];
    let state = login.state.clone();
    let wait = tokio::spawn(async move { login.wait(&CancellationToken::new()).await });
    let request = |target: String, host: String| async move {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).await.unwrap();
        out
    };
    assert!(request(
        "/oauth2/callback?state=wrong&code=alpha".into(),
        address.to_string()
    )
    .await
    .contains("400 Bad Request"));
    assert!(request(
        format!("/oauth2/callback?state={state}&code=alpha"),
        "other.test".into()
    )
    .await
    .contains("400 Bad Request"));
    assert!(request(
        format!("/oauth2/callback?state={state}&state={state}&code=alpha"),
        address.to_string()
    )
    .await
    .contains("400 Bad Request"));
    assert!(request(
        format!("/oauth2/callback?state={state}&code=alpha"),
        address.to_string()
    )
    .await
    .contains("200 OK"));
    assert_eq!(wait.await.unwrap().unwrap().as_str(), "alpha");
    assert!(TcpStream::connect(address).await.is_err());
    let other = oauth::Login::bind().await.unwrap();
    let stop = CancellationToken::new();
    stop.cancel();
    assert_eq!(other.wait(&stop).await.unwrap_err(), "gmail_cancelled");
}

#[tokio::test]
async fn actual_local_http_refresh_pagination_plain_body_scoped_send_log() {
    use axum::{
        extract::{Path, Query},
        routing::{get, post},
        Json, Router,
    };
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };
    let sends = Arc::new(AtomicUsize::new(0));
    let count = sends.clone();
    let app=Router::new()
        .route("/token",post(|form:axum::Form<HashMap<String,String>>|async move{
            assert_eq!(form["grant_type"],"refresh_token");assert_eq!(form["refresh_token"],"local-refresh");
            Json(json!({"access_token":"test-access","scope":oauth::READ}))
        }))
        .route("/me/profile",get(||async{Json(json!({"emailAddress":"me@example.test"}))}))
        .route("/me/labels",get(||async{Json(json!({"labels":[{"id":"INBOX","name":"Inbox"},{"id":"Label_42","name":"Invoices"}]}))}))
        .route("/me/messages",get(|Query(q):Query<HashMap<String,String>>,headers:axum::http::HeaderMap|async move{
            assert_eq!(headers["authorization"],"Bearer test-access");assert!(matches!(q["labelIds"].as_str(),"INBOX"|"Label_42"));assert_eq!(q["maxResults"],"5");assert_eq!(q["pageToken"],if q["labelIds"]=="INBOX" {"second"} else {"invoice-page"});
            Json(json!({"messages":[{"id":"ab23"}],"nextPageToken":"next"}))
        }))
        .route("/me/messages/{id}",get(|Path(id):Path<String>|async move{
            Json(json!({"id":id,"labelIds":["INBOX","Label_42"],"payload":{"headers":[{"name":"Subject","value":"fixture"}],"mimeType":"multipart/alternative","parts":[{"mimeType":"text/html","body":{"data":"dHJhY2tlcg"}},{"mimeType":"text/plain","body":{"data":"cGxhaW4"}},{"mimeType":"application/octet-stream","filename":"fixture.bin","body":{"attachmentId":"fixture_key","size":4}},{"filename":"small.bin","body":{"data":"AQI","size":2}}]}}))
        }))
        .route("/me/messages/{id}/attachments/fixture_key",get(|Path(id):Path<String>,headers:axum::http::HeaderMap|async move{
            assert_eq!(id,"ab23");assert_eq!(headers["authorization"],"Bearer test-access");Json(json!({"size":4,"data":"AP8BAg"}))
        }))
        .route("/me/messages/send",post(move|Json(m):Json<serde_json::Value>|{let count=count.clone();async move{
            count.fetch_add(1,Ordering::SeqCst);let msg=String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(m["raw"].as_str().unwrap()).unwrap()).unwrap();
            assert!(m.get("threadId").is_none());
            assert!(msg.contains("proof.bin") && msg.contains("multipart/mixed"));
            assert!(msg.lines().any(|line| line == "AP8NCg=="));
            assert!(msg.contains("To: me@example.test\r\n"));axum::http::StatusCode::SERVICE_UNAVAILABLE
        }}));
    let l = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = l.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    let root = format!("http://{addr}");
    let base = format!("{root}/me");
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let cfg = oauth::Config {
        id: "fixture".into(),
        secret: zeroize::Zeroizing::new("desktop".into()),
    };
    let tok = oauth::tokens(
        &client,
        &format!("{root}/token"),
        &cfg,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", "local-refresh"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(
        api::profile(&client, &base, &tok.access_token)
            .await
            .unwrap(),
        "me@example.test"
    );
    let labels = api::labels(&client, &base, &tok.access_token).await.unwrap();
    assert_eq!(labels[1], json!({"id":"Label_42","name":"Invoices"}));
    let invoices = api::list(&client, &base, &tok.access_token, "Label_42", Some("invoice-page"), 5).await.unwrap();
    assert_eq!(invoices["items"][0]["id"], "ab23");
    let page = api::list(&client, &base, &tok.access_token, "INBOX", Some("second"), 5)
        .await
        .unwrap();
    assert_eq!(page["items"][0]["subject"], "fixture");
    assert_eq!(page["nextCursor"], "next");
    let msg = api::read(&client, &base, &tok.access_token, "ab23")
        .await
        .unwrap();
    assert_eq!(msg["plainText"], "plain");
    assert_eq!(msg["html"], "tracker");
    let listed=&msg["attachments"];
    assert_eq!(listed[0],json!({"id":0,"name":"fixture.bin","size":4}));
    assert_eq!(api::attachment(&client,&base,&tok.access_token,"ab23",0,&listed[0]).await.unwrap(),[0,255,1,2]);
    assert_eq!(api::attachment(&client,&base,&tok.access_token,"ab23",1,&listed[1]).await.unwrap(),[1,2]);
    assert!(api::attachment(&client,&base,&tok.access_token,"ab23",1,&listed[0]).await.is_err());
    let path = std::env::temp_dir().join(format!("gmail-test-{}.sqlite", uuid::Uuid::new_v4()));
    {
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE accounts(scope,id,provider,address);CREATE TABLE drafts(scope,account,id,revision INTEGER,recipient,subject,body,PRIMARY KEY(scope,account,id));
        INSERT INTO accounts VALUES('w','a','gmail','me@example.test');INSERT INTO accounts VALUES('w','b','alibaba','other@example.test');INSERT INTO drafts VALUES('w','a','d',1,'me@example.test','中文','草稿');").unwrap();
        db.execute_batch(studio_alibaba_mail::DRAFT_ATTACHMENT_SCHEMA).unwrap();
        db.execute("INSERT INTO draft_attachments VALUES('w','a','d','x','proof.bin',?)", [vec![0u8,255,13,10]]).unwrap();
    }
    assert!(store::address(&path, "w", "b").is_err());
    assert!(store::address(&path, "other", "a").is_err());
    store::cache(&path, "w", "a", 0, "body", "ab23", &msg).unwrap();
    assert!(store::cached(&path, "w", "b", "body", "ab23")
        .unwrap()
        .is_null());
    assert_eq!(store::cached(&path, "w", "a", "body", "ab23").unwrap(), msg);
    assert!(store::begin(&path, "w", "a", "me@example.test", "d", 2).is_err());
    let message = store::begin(&path, "w", "a", "me@example.test", "d", 1).unwrap();
    assert_eq!(
        store::delivery(&path, "w", "a", "d", 1).unwrap()["status"],
        "unknown"
    );
    let (status, id) = api::send(&client, &base, &tok.access_token, &message.raw, message.thread.as_deref()).await;
    assert_eq!(status, "unknown");
    store::finish(&path, "w", "a", "d", 1, status, id.as_deref()).unwrap();
    assert!(store::begin(&path, "w", "a", "me@example.test", "d", 1).is_err());
    assert_eq!(sends.load(Ordering::SeqCst), 1);
    assert!(api::mime_message(
        "me@example.test",
        "me@example.test\r\nBcc:x@y.z",
        "subject",
        "text"
    )
    .is_err());
    std::fs::remove_file(path).unwrap();
    server.abort();
}

#[tokio::test]
async fn cached_gmail_reply_preserves_thread_across_reopen_and_explicit_send() {
    use axum::{extract::Path, routing::{get, post}, Json, Router};
    let mut source = json!({
        "id":"ab23","threadId":"thread_1","labelIds":["INBOX"],
        "payload":{"mimeType":"text/plain","body":{"data":"cGxhaW4"},"headers":[
            {"name":"From","value":"Sender <sender@example.test>"},
            {"name":"Reply-To","value":"\"Sender, Support\" <reply@example.test>"},
            {"name":"Subject","value":"=?UTF-8?B?5rWL6K+V?="},
            {"name":"Message-ID","value":"<original@example.test>"},
            {"name":"References","value":"<earlier@example.test> <unsafe-extra>"}]}
    });
    let missing = json!({"id":"legacy","subject":"Old cache without reply metadata"});
    let app = Router::new()
        .route("/me/messages", get(|| async { Json(json!({"messages":[{"id":"ab23"}]})) }))
        .route("/me/messages/{id}", get({
            let valid = source.clone();
            let mut invalid = source.clone();
            invalid["id"] = json!("bad");
            invalid["payload"]["headers"][1]["value"] = json!("first@example.test, second@example.test");
            move |Path(id):Path<String>| {
                let body = if id == "bad" { invalid.clone() } else { valid.clone() };
                async move { Json(body) }
            }
        }))
        .route("/me/messages/send", post(|Json(proof):Json<serde_json::Value>| async move {
            let mime = String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(proof["raw"].as_str().unwrap()).unwrap()).unwrap();
            assert_eq!(proof["threadId"], "thread_1");
            assert!(mime.contains("In-Reply-To: <original@example.test>\r\n"));
            assert!(mime.contains("References: <earlier@example.test>\r\n <original@example.test>\r\n"));
            assert!(mime.contains("To: reply@example.test\r\n"));
            assert!(mime.contains("proof.bin") && !mime.contains("unsafe-extra"));
            Json(json!({"id":"publicfixture"}))
        }));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1",0)).await.unwrap();
    let base = format!("http://{}/me",listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener,app).await.unwrap() });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let page = api::list(&client,&base,"fixture","INBOX",None,10).await.unwrap();
    source = api::read(&client,&base,"fixture","bad").await.unwrap();
    assert_eq!(source["reply"], serde_json::Value::Null);

    let profile = tempfile::tempdir().unwrap();
    let path = profile.path().join("mail.sqlite3");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE accounts(scope,id,provider,address);
        CREATE TABLE drafts(scope,account,id,revision INTEGER,recipient,subject,body,PRIMARY KEY(scope,account,id));
        INSERT INTO accounts VALUES('w','a','gmail','me@example.test'),('w','b','gmail','other@example.test');").unwrap();
    db.execute_batch(studio_alibaba_mail::DRAFT_ATTACHMENT_SCHEMA).unwrap();
    drop(db);
    store::cache(&path,"w","a",0,"page","10:",&page).unwrap();
    store::cache(&path,"w","a",0,"body","legacy",&missing).unwrap();
    store::cache(&path,"w","a",0,"body","bad",&source).unwrap();
    assert_eq!(store::reply_draft(&path,"w","b","ab23").unwrap_err(),"gmail_reply_metadata_missing");
    assert_eq!(store::reply_draft(&path,"w","a","legacy").unwrap_err(),"gmail_reply_metadata_missing");
    assert_eq!(store::reply_draft(&path,"w","a","bad").unwrap_err(),"gmail_reply_unavailable");
    let draft = store::reply_draft(&path,"w","a","ab23").unwrap();
    let id = draft["id"].as_str().unwrap();
    assert_eq!(draft["recipient"], "reply@example.test");
    assert_eq!(draft["subject"], "测试");
    assert_eq!(draft["gmailReply"], true);
    assert!(store::delivery(&path,"w","a",id,1).unwrap().is_null());

    // The cache can be cleared before restarting. Draft metadata belongs to the saved draft.
    store::clear_cache(&path,"w","a").unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE drafts SET revision=2,body='Reply body' WHERE id=?", [id]).unwrap();
    db.execute("INSERT INTO draft_attachments VALUES('w','a',?,'file','proof.bin',?)",
        rusqlite::params![id,vec![1u8,2,3]]).unwrap();
    drop(db);
    assert!(store::begin(&path,"w","b","other@example.test",id,2).is_err());
    let message = store::begin(&path,"w","a","me@example.test",id,2).unwrap();
    assert_eq!(message.thread.as_deref(), Some("thread_1"));
    assert_eq!(api::send(&client,&base,"fixture",&message.raw,message.thread.as_deref()).await,
        ("accepted",Some("publicfixture".into())));
    assert!(store::begin(&path,"w","a","me@example.test",id,2).is_err());

    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE drafts SET revision=3,recipient='new@example.test' WHERE id=?", [id]).unwrap();
    drop(db);
    let separate = store::begin(&path,"w","a","me@example.test",id,3).unwrap();
    assert_eq!(separate.thread, None);
    let mime = String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(separate.raw).unwrap()).unwrap();
    assert!(!mime.contains("In-Reply-To:") && !mime.contains("References:"));
    server.abort();
}

#[tokio::test]
async fn google_denial_and_expired_grant_are_distinct_and_never_log_secrets() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let login = oauth::Login::bind().await.unwrap();
    let url = reqwest::Url::parse(&login.redirect).unwrap();
    let addr = url.socket_addrs(|| None).unwrap()[0];
    let state = login.state.clone();
    let waiter = tokio::spawn(async move { login.wait(&CancellationToken::new()).await });
    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream.write_all(format!("GET /oauth2/callback?state={state}&error=access_denied HTTP/1.1\r\nHost: {addr}\r\n\r\n").as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    assert!(!response.contains(&state));
    assert_eq!(
        waiter.await.unwrap().unwrap_err(),
        "gmail_authorization_denied"
    );
    use axum::{routing::post, Json, Router};
    let app = Router::new().route(
        "/token",
        post(|| async {
            (
                axum::http::StatusCode::BAD_REQUEST,
                Json(
                    json!({"error":"invalid_grant","error_description":"private fixture details"}),
                ),
            )
        }),
    );
    let l = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let endpoint = format!("http://{}/token", l.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    let cfg = oauth::Config {
        id: "fixture".into(),
        secret: zeroize::Zeroizing::new("synthetic".into()),
    };
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    assert_eq!(
        oauth::tokens(
            &client,
            &endpoint,
            &cfg,
            &[("grant_type", "refresh_token"), ("refresh_token", "old")]
        )
        .await
        .err(),
        Some("gmail_reauthorize")
    );
    server.abort();
}

#[tokio::test]
async fn exchange_uses_verifier_and_redirect_and_send_maps_definitive_outcomes() {
    use axum::{extract::Path, routing::post, Json, Router};
    use std::collections::HashMap;
    let app=Router::new()
       .route("/token",post(|f:axum::Form<HashMap<String,String>>|async move{
            assert_eq!(f["grant_type"],"authorization_code");assert_eq!(f["redirect_uri"],"http://127.0.0.1:43210/oauth2/callback");assert_eq!(f["code_verifier"],"fixture-verifier");assert_eq!(f["code"],"one-time");
            Json(json!({"access_token":"test-access","refresh_token":"test-refresh","scope":oauth::READ}))
       }))
       .route("/{status}/messages/send",post(|Path(s):Path<String>|async move{
           let status=if s=="accepted"{axum::http::StatusCode::OK}else{axum::http::StatusCode::BAD_REQUEST};
           (status,Json(json!({"id":"fixture123"})))
       }));
    let l = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let root = format!("http://{}", l.local_addr().unwrap());
    let service = tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    let cfg = oauth::Config {
        id: "fixture".into(),
        secret: zeroize::Zeroizing::new("synthetic".into()),
    };
    let c = reqwest::Client::builder()
        .no_proxy()
        .retry(reqwest::retry::never())
        .build()
        .unwrap();
    let a = oauth::tokens(
        &c,
        &format!("{root}/token"),
        &cfg,
        &[
            ("grant_type", "authorization_code"),
            ("redirect_uri", "http://127.0.0.1:43210/oauth2/callback"),
            ("code_verifier", "fixture-verifier"),
            ("code", "one-time"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(a.refresh_token.as_deref(), Some("test-refresh"));
    assert_eq!(
        api::send(
            &c,
            &format!("{root}/accepted"),
            &a.access_token,
            "synthetic",
            None,
        )
        .await,
        ("accepted", Some("fixture123".into()))
    );
    assert_eq!(
        api::send(
            &c,
            &format!("{root}/rejected"),
            &a.access_token,
            "synthetic",
            None,
        )
        .await,
        ("rejected", None)
    );
    service.abort();
}

#[test]
fn narrower_refresh_grant_is_persisted_even_without_token_rotation() {
    assert_eq!(
        super::consent_scope(oauth::READ, &format!("{} {}", oauth::SEND, oauth::READ)),
        oauth::READ
    );
    let prev = super::Saved {
        refresh: "old".into(),
        scope: format!("{} {}", oauth::READ, oauth::SEND),
        client_id: "fixture".into(),
    };
    let narrowed = super::updated_grant(&prev, None, oauth::READ).unwrap();
    assert_eq!(narrowed.refresh, "old");
    assert_eq!(super::perms(&narrowed.scope)["send"], false);
    assert!(super::updated_grant(&narrowed, None, oauth::READ).is_none());
    let rotated = super::updated_grant(&narrowed, Some("new".into()), oauth::READ).unwrap();
    assert_eq!(rotated.refresh, "new");
}

#[test]
fn disconnect_cache_keeps_scopes_and_rejects_late_gmail_writes() {
    let file = std::env::temp_dir().join(format!("mail-clear-{}.sqlite", uuid::Uuid::new_v4()));
    rusqlite::Connection::open(&file).unwrap();
    let initial = store::cache_generation(&file, "one", "a").unwrap();
    for (scope, id) in [("one", "a"), ("two", "a"), ("one", "b")] {
        store::cache(
            &file,
            scope,
            id,
            initial,
            "body",
            "42",
            &json!({"plainText":"fixture"}),
        )
        .unwrap();
    }
    store::clear_cache(&file, "one", "a").unwrap();
    assert_eq!(
        store::cache(&file, "one", "a", initial, "page", "old", &json!({})),
        Err("gmail_cancelled")
    );
    assert!(store::cached(&file, "one", "a", "body", "42")
        .unwrap()
        .is_null());
    for (scope, id) in [("two", "a"), ("one", "b")] {
        assert_eq!(
            store::cached(&file, scope, id, "body", "42").unwrap()["plainText"],
            "fixture"
        );
    }
    std::fs::remove_file(file).unwrap();
}

#[tokio::test]
async fn gmail_history_pages_reconcile_label_membership_and_recover_expiry() {
    use super::sync;
    use axum::{
        extract::{Path, Query},
        http::StatusCode,
        response::IntoResponse,
        routing::get,
        Json, Router,
    };
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };
    let phase = Arc::new(AtomicUsize::new(0));
    let profiles = phase.clone();
    let pages = phase.clone();
    let metadata = phase.clone();
    let history = phase.clone();
    let app=Router::new()
        .route("/profile",get(move ||async move { Json(json!({"historyId": if profiles.load(Ordering::SeqCst)==0 {"10"} else {"80"}})) }))
        .route("/messages",get(move |Query(q):Query<HashMap<String,String>>|async move {
            assert_eq!(q["labelIds"],"Label_A");
            let state=pages.load(Ordering::SeqCst);
            let id=if state==0 {"a"} else if state==3 && q.contains_key("pageToken") {"e"} else {"c"};
            if state==3 && !q.contains_key("pageToken") {Json(json!({"messages":[{"id":id}],"nextPageToken":"tail"}))}
            else {Json(json!({"messages":[{"id":id}]}))}
        }))
        .route("/messages/{id}",get(move |Path(id):Path<String>|async move {
            if id=="gone" {return StatusCode::NOT_FOUND.into_response()}
            Json(json!({"id":id,"internalDate":match id.as_str(){"a"=>"11","b"=>"22","c"=>"33","d"=>"44",_=>"5"},
                 "labelIds":if id=="a" && metadata.load(Ordering::SeqCst)>0 {vec!["Label_B"]} else {vec!["Label_A"]},
                 "payload":{"headers":[{"name":"Subject","value":id}]}})).into_response()
        }))
        .route("/history",get(move |Query(q):Query<HashMap<String,String>>|async move {
            let state=history.load(Ordering::SeqCst);
            if state==3 {return StatusCode::NOT_FOUND.into_response()}
            assert_eq!(q["startHistoryId"],"10");
            if q.contains_key("pageToken") {
                if state==1 {return StatusCode::SERVICE_UNAVAILABLE.into_response()}
                return Json(json!({"historyId":"50","history":[{"labelsAdded":[{"message":{"id":"d"},"labelIds":["Label_A"]}]}]})).into_response()
            }
            Json(json!({"historyId":"50","nextPageToken":"second","history":[{
                "messagesAdded":[{"message":{"id":"b"}}],"labelsRemoved":[{"message":{"id":"a"},"labelIds":["Label_A"]}],
                "messagesDeleted":[{"message":{"id":"gone"}}]}]})).into_response()
        }));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let path = std::env::temp_dir().join(format!("gmail-sync-{}.sqlite", uuid::Uuid::new_v4()));
    drop(rusqlite::Connection::open(&path).unwrap());
    let stop = tokio_util::sync::CancellationToken::new();
    let fetch = || {
        sync::fetch(
            &client,
            &base,
            "fixture",
            sync::CachedLabel {
                path: &path,
                scope: "w",
                account: "acct",
                label: "Label_A",
            },
            None,
            1,
            &stop,
        )
    };
    let save =
        |s: &sync::Snapshot| sync::apply(&path, "w", "acct", "Label_A", 0, "label:Label_A:1:", s);
    let offline = |cursor: Option<&str>| {
        sync::offline_page(&path, "w", "acct", "Label_A", cursor, 2, "legacy").unwrap()
    };
    store::cache(
        &path,
        "w",
        "acct",
        0,
        "page",
        "label:Label_B:1:",
        &json!({"items":[{"id":"a"},{"id":"gone"}]}),
    )
    .unwrap();
    save(&fetch().await.unwrap()).unwrap();
    assert_eq!(offline(None)["items"][0]["id"], "a");
    store::cache(&path, "w", "acct", 0, "body", "gone", &json!({"id":"gone"})).unwrap();
    phase.store(1, Ordering::SeqCst);
    assert!(fetch().await.is_err());
    assert_eq!(
        store::cached(&path, "w", "acct", "history", "Label_A").unwrap(),
        "10"
    );
    phase.store(2, Ordering::SeqCst);
    save(&fetch().await.unwrap()).unwrap();
    let head = offline(None);
    assert_eq!(head["items"][0]["id"], "d");
    assert_eq!(head["items"][1]["id"], "c");
    assert_eq!(offline(head["nextCursor"].as_str())["items"][0]["id"], "b");
    assert!(store::cached(&path, "w", "acct", "body", "gone")
        .unwrap()
        .is_null());
    assert_eq!(
        store::cached(&path, "w", "acct", "page", "label:Label_B:1:").unwrap()["items"],
        json!([{"id":"a"}])
    );
    phase.store(3, Ordering::SeqCst);
    save(&fetch().await.unwrap()).unwrap();
    assert_eq!(
        store::cached(&path, "w", "acct", "history", "Label_A").unwrap(),
        "80"
    );
    assert_eq!(
        offline(offline(None)["nextCursor"].as_str())["items"][1]["id"],
        "e"
    );
    let stale = fetch().await.unwrap();
    store::clear_cache(&path, "w", "acct").unwrap();
    assert!(save(&stale).is_err());
    assert!(offline(None).is_null());
    server.abort();
    std::fs::remove_file(path).unwrap();
}


#[tokio::test]
async fn cancelling_gmail_refresh_releases_account_during_expired_history_recovery() {
    use super::{sync, AccountGate};
    use axum::{
        extract::Query,
        http::{header::AUTHORIZATION, HeaderMap, StatusCode},
        routing::get,
        Json, Router,
    };
    use std::{collections::HashMap, sync::Arc, time::Duration};
    use tokio::sync::Notify;

    let paused = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let pages = {
        let paused = paused.clone();
        let release = release.clone();
        move |headers: HeaderMap, Query(query): Query<HashMap<String, String>>| {
            let paused = paused.clone();
            let release = release.clone();
            async move {
                if headers[AUTHORIZATION] == "Bearer previous" {
                    if query.get("pageToken").is_some_and(|token| token == "later") {
                        paused.notify_one();
                        release.notified().await;
                        return Json(json!({}));
                    }
                    return Json(json!({"nextPageToken":"later"}));
                }
                assert_eq!(headers[AUTHORIZATION], "Bearer fresh");
                assert!(!query.contains_key("pageToken"));
                Json(json!({"messages":[{"id":"saved"}]}))
            }
        }
    };
    let app = Router::new()
        .route("/history", get(|| async { StatusCode::NOT_FOUND }))
        .route(
            "/profile",
            get(|| async { Json(json!({"historyId":"80"})) }),
        )
        .route("/messages", get(pages))
        .route(
            "/messages/saved",
            get(|| async {
                Json(
                    json!({"id":"saved","internalDate":"33","labelIds":["INBOX"],
                "payload":{"headers":[{"name":"Subject","value":"Fresh subject"}]}}),
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let service = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let path =
        std::env::temp_dir().join(format!("gmail-cancel-sync-{}.sqlite", uuid::Uuid::new_v4()));
    drop(rusqlite::Connection::open(&path).unwrap());
    store::cache(&path, "w", "acct", 0, "history", "INBOX", &json!("10")).unwrap();
    let cached = json!({"items":[{"id":"saved","internalDate":33,"subject":"Saved subject"}]});
    store::cache(&path, "w", "acct", 0, "page", "member:saved", &cached).unwrap();

    let gate = AccountGate::default();
    let previous_stop = gate.state.lock().unwrap().stop.clone();
    let folder = || sync::CachedLabel {
        path: &path,
        scope: "w",
        account: "acct",
        label: "INBOX",
    };
    let previous = async {
        let _network = gate.network.lock().await;
        sync::fetch(
            &client,
            &base,
            "previous",
            folder(),
            None,
            1,
            &previous_stop,
        )
        .await
    };
    let cancel_and_retry = async {
        paused.notified().await;
        let fresh_stop = {
            let mut state = gate.state.lock().unwrap();
            state.invalidate();
            state.stop.clone()
        };
        let _network = gate.network.lock().await;
        assert_eq!(
            store::cached(&path, "w", "acct", "history", "INBOX").unwrap(),
            "10"
        );
        assert_eq!(
            store::cached(&path, "w", "acct", "page", "member:saved").unwrap(),
            cached
        );
        sync::fetch(&client, &base, "fresh", folder(), None, 1, &fresh_stop).await
    };
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(previous, cancel_and_retry)
    })
    .await;
    release.notify_one();
    service.abort();
    let (cancelled, fresh) =
        result.expect("cancelled Gmail refresh held the account's network lock");
    assert!(matches!(cancelled, Err("gmail_cancelled")));
    let fresh = fresh.unwrap();
    sync::apply(&path, "w", "acct", "INBOX", 0, "1:", &fresh).unwrap();
    assert_eq!(
        store::cached(&path, "w", "acct", "history", "INBOX").unwrap(),
        "80"
    );
    assert_eq!(
        sync::offline_page(&path, "w", "acct", "INBOX", None, 1, "1:").unwrap()["items"][0]
            ["subject"],
        "Fresh subject"
    );
    std::fs::remove_file(path).unwrap();
}

#[test]
fn disconnect_retries_cache_cleanup_with_the_original_revocation_credential() {
    use std::cell::{Cell, RefCell};

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mail.sqlite3");
    let writer = rusqlite::Connection::open(&path).unwrap();
    let letter = json!({"id":"test","plainText":"cached"});
    store::cache(&path, "one", "gmail", 0, "body", "test", &letter).unwrap();
    store::cache(&path, "two", "gmail", 0, "body", "test", &letter).unwrap();

    let saved = RefCell::new(Some("isolated-revocation-grant"));
    let removed = Cell::new(0);
    let disconnect = || {
        store::disconnect_local(
            || Ok(*saved.borrow()),
            || store::clear_cache(&path, "one", "gmail"),
            || {
                removed.set(removed.get() + 1);
                saved.borrow_mut().take();
                Ok(())
            },
        )
    };

    writer.execute_batch("BEGIN IMMEDIATE").unwrap();
    let blocked = disconnect();
    writer.execute_batch("ROLLBACK").unwrap();
    assert_eq!(blocked, Err("gmail_storage"));
    assert_eq!(store::cached(&path, "one", "gmail", "body", "test").unwrap(), letter);
    assert_eq!(store::cache_generation(&path, "one", "gmail").unwrap(), 0);
    assert_eq!(removed.get(), 0, "a failed cache transaction must preserve the grant for revocation");

    assert_eq!(disconnect(), Ok(Some("isolated-revocation-grant")));
    assert_eq!(removed.get(), 1);
    assert!(saved.borrow().is_none());
    assert_eq!(store::cache_generation(&path, "one", "gmail").unwrap(), 1);
    assert_eq!(store::cached(&path, "one", "gmail", "body", "test").unwrap(), json!(null));
    assert_eq!(store::cached(&path, "two", "gmail", "body", "test").unwrap(), letter);
}
