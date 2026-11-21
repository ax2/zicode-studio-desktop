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
        .route("/me/messages",get(|Query(q):Query<HashMap<String,String>>,headers:axum::http::HeaderMap|async move{
            assert_eq!(headers["authorization"],"Bearer test-access");assert_eq!(q["labelIds"],"INBOX");assert_eq!(q["maxResults"],"5");assert_eq!(q["pageToken"],"second");
            Json(json!({"messages":[{"id":"ab23"}],"nextPageToken":"next"}))
        }))
        .route("/me/messages/{id}",get(|Path(id):Path<String>|async move{
            Json(json!({"id":id,"payload":{"headers":[{"name":"Subject","value":"fixture"}],"mimeType":"multipart/alternative","parts":[{"mimeType":"text/html","body":{"data":"dHJhY2tlcg"}},{"mimeType":"text/plain","body":{"data":"cGxhaW4"}},{"mimeType":"application/octet-stream","filename":"fixture.bin","body":{"attachmentId":"fixture_key","size":4}},{"filename":"small.bin","body":{"data":"AQI","size":2}}]}}))
        }))
        .route("/me/messages/{id}/attachments/fixture_key",get(|Path(id):Path<String>,headers:axum::http::HeaderMap|async move{
            assert_eq!(id,"ab23");assert_eq!(headers["authorization"],"Bearer test-access");Json(json!({"size":4,"data":"AP8BAg"}))
        }))
        .route("/me/messages/send",post(move|Json(m):Json<serde_json::Value>|{let count=count.clone();async move{
            count.fetch_add(1,Ordering::SeqCst);let msg=String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(m["raw"].as_str().unwrap()).unwrap()).unwrap();
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
    let page = api::list(&client, &base, &tok.access_token, Some("second"), 5)
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
    let raw = store::begin(&path, "w", "a", "me@example.test", "d", 1).unwrap();
    assert_eq!(
        store::delivery(&path, "w", "a", "d", 1).unwrap()["status"],
        "unknown"
    );
    let (status, id) = api::send(&client, &base, &tok.access_token, &raw).await;
    assert_eq!(status, "unknown");
    store::finish(&path, "w", "a", "d", 1, status, id.as_deref()).unwrap();
    assert!(store::begin(&path, "w", "a", "me@example.test", "d", 1).is_err());
    assert_eq!(sends.load(Ordering::SeqCst), 1);
    assert!(api::raw_message(
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
            "synthetic"
        )
        .await,
        ("accepted", Some("fixture123".into()))
    );
    assert_eq!(
        api::send(
            &c,
            &format!("{root}/rejected"),
            &a.access_token,
            "synthetic"
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
